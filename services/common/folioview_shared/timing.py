"""Numeric processing evidence only; never identity, data, or authorization state."""

import math
import time
from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from threading import Lock

from starlette.types import ASGIApp, Message, Receive, Scope, Send


@dataclass
class _Measurements:
    clock: Callable[[], float]
    started: float
    firebase_seconds: float = 0
    valid: bool = True
    lock: Lock = field(default_factory=Lock, repr=False)

    def record_firebase(self, elapsed):
        with self.lock:
            if not math.isfinite(elapsed) or elapsed < 0:
                self.valid = False
            else:
                self.firebase_seconds += elapsed

    def header(self):
        elapsed = self.clock() - self.started
        with self.lock:
            if not self.valid or not math.isfinite(elapsed) or elapsed < 0:
                return None
            return (
                f"fv_app;dur={elapsed * 1000:.3f}, "
                f"fv_firebase;dur={self.firebase_seconds * 1000:.3f}"
            ).encode("ascii")


_current: ContextVar[_Measurements | None] = ContextVar("folioview_processing", default=None)


@contextmanager
def measure_firebase_verification():
    current = _current.get()
    if current is None:
        yield
        return
    started = current.clock()
    try:
        yield
    finally:
        current.record_firebase(current.clock() - started)


class ProcessingTimings:
    """Measure headers-ready processing around the final ASGI middleware stack.

    The mutable request-local state is copied by reference into AnyIO workers;
    requests get independent instances. No request fields, extra logs or caches.
    Body transfer and process/container startup are not measured by these headers.
    """

    def __init__(self, app: ASGIApp, *, clock=time.perf_counter):
        self.app, self.clock = app, clock

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        current = _Measurements(self.clock, self.clock())
        token = _current.set(current)

        async def measured_send(message: Message):
            if message["type"] == "http.response.start":
                value = current.header()
                if value is not None:
                    message = {
                        **message,
                        "headers": [*message.get("headers", []), (b"server-timing", value)],
                    }
            await send(message)

        try:
            await self.app(scope, receive, measured_send)
        finally:
            _current.reset(token)
