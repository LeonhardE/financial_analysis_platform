"""Fixed-memory per-process admission; not a project-wide spending limit."""

import math
import os
import time
from contextlib import contextmanager
from functools import lru_cache
from threading import Lock

from fastapi.routing import APIRoute
from starlette.responses import JSONResponse

# Environment tuning cannot exceed these versioned safety ceilings or disable
# admission. Process restarts/new instances get their own initial capacities.
SETTINGS = (
    ("MARKET_REQUESTS_PER_MINUTE", 600, 1200),
    ("MARKET_STORAGE_OPERATIONS_PER_MINUTE", 180, 600),
    ("MARKET_MAX_INFLIGHT_REQUESTS", 8, 16),
)


class MarketLimited(Exception):
    def __init__(self, retry_after: int):
        self.retry_after = max(1, min(60, retry_after))
        super().__init__("Market requests are temporarily limited.")


class CostConfigurationUnavailable(Exception):
    def __init__(self):
        super().__init__("Market request controls are temporarily unavailable.")


class TokenBudget:
    """A thread-safe constant-size bucket, charging before expensive work."""

    def __init__(self, capacity: int, *, clock=time.monotonic):
        self.capacity = capacity
        self.clock = clock
        self.tokens = float(capacity)
        self.updated = clock()
        self.lock = Lock()

    def charge(self, units: int = 1):
        if type(units) is not int or units < 1:
            raise CostConfigurationUnavailable
        if units > self.capacity:
            raise MarketLimited(60)
        with self.lock:
            now = self.clock()
            self.tokens = min(
                self.capacity,
                self.tokens + max(0, now - self.updated) * self.capacity / 60,
            )
            self.updated = max(self.updated, now)
            if self.tokens < units:
                raise MarketLimited(math.ceil((units - self.tokens) * 60 / self.capacity))
            self.tokens -= units


class CostControls:
    def __init__(
        self, request_limit=600, storage_limit=180, max_inflight=8, *, clock=time.monotonic
    ):
        values = (request_limit, storage_limit, max_inflight)
        if any(
            type(value) is not int or not 1 <= value <= setting[2]
            for value, setting in zip(values, SETTINGS, strict=True)
        ):
            raise CostConfigurationUnavailable
        self.requests = TokenBudget(request_limit, clock=clock)
        self.storage = TokenBudget(storage_limit, clock=clock)
        self.max_inflight = max_inflight
        self.inflight = 0
        self.lock = Lock()

    @contextmanager
    def admit(self):
        with self.lock:
            if self.inflight >= self.max_inflight:
                raise MarketLimited(1)
            self.requests.charge()
            self.inflight += 1
        try:
            yield
        finally:
            with self.lock:
                self.inflight -= 1


@lru_cache(maxsize=4)
def configured_controls(configuration: tuple[str, ...]) -> CostControls:
    try:
        values = tuple(int(value) for value in configuration)
    except (ValueError, TypeError):
        raise CostConfigurationUnavailable from None
    return CostControls(*values)


def get_cost_controls() -> CostControls:
    return configured_controls(
        tuple(os.getenv(name, str(default)) for name, default, _ in SETTINGS)
    )


class MarketCostRoute(APIRoute):
    """Inside existing CORS middleware; reject before dependencies or SDK calls."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def limited_handler(request):
            if not request.url.path.startswith("/api/"):
                return await handler(request)
            try:
                with get_cost_controls().admit():
                    return await handler(request)
            except MarketLimited as error:
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": "Market requests are temporarily limited. Try again shortly."
                    },
                    headers={
                        "Retry-After": str(error.retry_after),
                        "Cache-Control": "no-store",
                        "Access-Control-Expose-Headers": "Retry-After",
                    },
                )
            except CostConfigurationUnavailable:
                return JSONResponse(
                    status_code=503,
                    content={"detail": "Market request controls are temporarily unavailable."},
                    headers={
                        "Retry-After": "60",
                        "Cache-Control": "no-store",
                        "Access-Control-Expose-Headers": "Retry-After",
                    },
                )

        return limited_handler
