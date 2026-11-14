"""Processing boundaries, worker propagation and request isolation without network."""

import asyncio
import re
import unittest
from contextvars import ContextVar
from importlib.util import find_spec
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request

from folioview_shared import timing
from folioview_shared.http import create_app
from folioview_shared.timing import ProcessingTimings, measure_firebase_verification

# Public market consumers intentionally do not install the private identity SDK.
if find_spec("firebase_admin") is not None:
    from folioview_shared import auth
else:
    auth = None


class Clock:
    def __init__(self):
        self.value = 0.0

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += seconds


def scope(token="private_token", *, kind="http"):
    return {
        "type": kind,
        "method": "GET",
        "path": "/api/private/secret_owner",
        "query_string": b"private=secret",
        "headers": [(b"authorization", ("Bearer " + token).encode())],
    }


async def receive():
    return {"type": "http.request", "body": b"", "more_body": False}


async def response(send, *, status=200, headers=()):
    await send({"type": "http.response.start", "status": status, "headers": list(headers)})
    await send({"type": "http.response.body", "body": b"{}"})


def header(messages):
    first = next(m for m in messages if m["type"] == "http.response.start")
    return dict(first["headers"])[b"server-timing"].decode()


class ProcessingTimingTests(unittest.TestCase):
    def test_nested_request_restores_outer_measurements_without_double_counting_auth(self):
        clock, outer_sent, inner_sent = Clock(), [], []

        async def inner(_scope, _receive, send):
            with measure_firebase_verification():
                clock.advance(0.010)
            await response(send)

        async def outer(_scope, _receive, send):
            original = timing._current.get()
            with measure_firebase_verification():
                clock.advance(0.005)
            await ProcessingTimings(inner, clock=clock)(scope(), receive, self.collect(inner_sent))
            self.assertIs(timing._current.get(), original)
            with measure_firebase_verification():
                clock.advance(0.005)
            await response(send)

        asyncio.run(
            ProcessingTimings(outer, clock=clock)(scope(), receive, self.collect(outer_sent))
        )
        self.assertEqual(header(outer_sent), "fv_app;dur=20.000, fv_firebase;dur=10.000")
        self.assertEqual(header(inner_sent), "fv_app;dur=10.000, fv_firebase;dur=10.000")

    def test_processing_stops_at_headers_and_preserves_all_existing_response_data(self):
        clock, sent = Clock(), []

        async def app(_scope, _receive, send):
            with measure_firebase_verification():
                clock.advance(0.005)
            clock.advance(0.015)
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"cache-control", b"no-store")],
                }
            )
            clock.advance(5)  # body transfer is deliberately outside header timing
            await send({"type": "http.response.body", "body": b"original body"})

        async def run():
            await ProcessingTimings(app, clock=clock)(scope(), receive, self.collect(sent))
            self.assertIsNone(timing._current.get())

        asyncio.run(run())
        self.assertEqual(header(sent), "fv_app;dur=20.000, fv_firebase;dur=5.000")
        self.assertEqual(sent[-1]["body"], b"original body")
        self.assertIn((b"cache-control", b"no-store"), sent[0]["headers"])
        for private in ("secret_owner", "private_token", "private=secret", "original body"):
            self.assertNotIn(private, header(sent))

    @staticmethod
    def collect(messages):
        async def send(message):
            messages.append(message)

        return send

    @unittest.skipIf(auth is None, "Private identity consumers supply the Firebase SDK")
    def test_actual_live_verifier_in_worker_contributes_without_waiving_revocation(self):
        clock, sent = Clock(), []
        app_instance = object()

        def verify(token, *, app, check_revoked):
            self.assertEqual(token, "private_token")
            self.assertIs(app, app_instance)
            self.assertIs(check_revoked, True)
            clock.advance(0.010)
            return {"uid": "secret_owner", "firebase": {"sign_in_provider": "google.com"}}

        async def app(s, _receive, send):
            user = await run_in_threadpool(
                auth.require_google_user,
                Request(s),
                HTTPAuthorizationCredentials(scheme="Bearer", credentials="private_token"),
            )
            self.assertEqual(user.uid, "secret_owner")
            clock.advance(0.015)
            await response(send)

        with (
            patch.object(auth, "_get_firebase_app", return_value=app_instance),
            patch.object(auth.auth, "verify_id_token", side_effect=verify) as sdk,
        ):
            asyncio.run(ProcessingTimings(app, clock=clock)(scope(), receive, self.collect(sent)))
        sdk.assert_called_once()
        self.assertEqual(header(sent), "fv_app;dur=25.000, fv_firebase;dur=10.000")

    @unittest.skipIf(auth is None, "Private identity consumers supply the Firebase SDK")
    def test_failed_verification_is_measured_and_keeps_the_existing_private_error(self):
        clock, sent = Clock(), []

        def verify(*_args, **_kwargs):
            clock.advance(0.008)
            raise ValueError("secret SDK diagnostics")

        async def app(s, _receive, send):
            try:
                await run_in_threadpool(
                    auth.require_google_user,
                    Request(s),
                    HTTPAuthorizationCredentials(scheme="Bearer", credentials="private_token"),
                )
            except HTTPException as error:
                self.assertEqual(error.detail, "Sign-in is temporarily unavailable")
                await response(send, status=error.status_code)

        with (
            patch.object(auth, "_get_firebase_app", return_value=object()),
            patch.object(auth.auth, "verify_id_token", side_effect=verify),
        ):
            asyncio.run(ProcessingTimings(app, clock=clock)(scope(), receive, self.collect(sent)))
        self.assertEqual(sent[0]["status"], 503)
        self.assertEqual(header(sent), "fv_app;dur=8.000, fv_firebase;dur=8.000")
        self.assertNotIn("secret", header(sent))

    def test_concurrent_requests_keep_independent_worker_and_processing_measurements(self):
        case = ContextVar("synthetic_case")
        clocks = {"a": Clock(), "b": Clock()}
        sent = {"a": [], "b": []}

        async def run():
            entered = {name: asyncio.Event() for name in clocks}

            async def app(s, _receive, send):
                name = s["case"]

                def worker():
                    with measure_firebase_verification():
                        clocks[name].advance(0.01 if name == "a" else 0.02)

                await run_in_threadpool(worker)
                entered[name].set()
                await entered["b" if name == "a" else "a"].wait()
                clocks[name].advance(0.03 if name == "a" else 0.05)
                await response(send)

            measured = ProcessingTimings(app, clock=lambda: clocks[case.get()]())

            async def one(name):
                token = case.set(name)
                try:
                    await measured({**scope(), "case": name}, receive, self.collect(sent[name]))
                    self.assertIsNone(timing._current.get())
                finally:
                    case.reset(token)

            await asyncio.gather(one("a"), one("b"))

        asyncio.run(run())
        self.assertEqual(header(sent["a"]), "fv_app;dur=40.000, fv_firebase;dur=10.000")
        self.assertEqual(header(sent["b"]), "fv_app;dur=70.000, fv_firebase;dur=20.000")

    def test_late_error_middleware_and_framework_errors_are_inside_the_boundary(self):
        app = create_app("Synthetic errors")

        @app.get("/api/fail")
        def fail():
            raise RuntimeError("secret request details")

        class LateErrors:
            def __init__(self, app):
                self.app = app

            async def __call__(self, scope, receive, send):
                try:
                    await self.app(scope, receive, send)
                except RuntimeError:
                    await JSONResponse({"code": "unavailable"}, status_code=503)(
                        scope, receive, send
                    )

        app.add_middleware(LateErrors)
        with TestClient(app) as client:
            result = client.get("/api/fail")
        self.assertEqual(result.status_code, 503)
        self.assertRegex(
            result.headers["server-timing"], r"^fv_app;dur=\d+\.\d{3}, fv_firebase;dur=0\.000$"
        )
        self.assertEqual(result.json(), {"code": "unavailable"})
        framework = create_app("Synthetic framework")
        framework.get("/fail")(fail)
        with TestClient(framework, raise_server_exceptions=False) as client:
            result = client.get("/fail")
        self.assertEqual(result.status_code, 500)
        self.assertIn("server-timing", result.headers)
        self.assertNotIn("secret", result.text)

    def test_non_http_and_invalid_clock_never_create_misleading_metrics(self):
        sent = []

        async def app(_scope, _receive, send):
            await response(send)

        def forbidden():
            raise AssertionError("Non-HTTP must not be timed")

        asyncio.run(
            ProcessingTimings(app, clock=forbidden)(
                scope(kind="websocket"), receive, self.collect(sent)
            )
        )
        self.assertNotIn(b"server-timing", dict(sent[0]["headers"]))
        sent.clear()
        asyncio.run(
            ProcessingTimings(app, clock=lambda: float("nan"))(scope(), receive, self.collect(sent))
        )
        self.assertNotIn(b"server-timing", dict(sent[0]["headers"]))
        self.assertIsNone(timing._current.get())
        with measure_firebase_verification():
            pass  # Standalone verification has no implicit request/cache.

    def test_cancellation_restores_context_and_existing_timing_headers_are_preserved(self):
        clock, sent = Clock(), []

        async def cancelled(_scope, _receive, _send):
            raise asyncio.CancelledError

        async def run():
            with self.assertRaises(asyncio.CancelledError):
                await ProcessingTimings(cancelled, clock=clock)(
                    scope(), receive, self.collect(sent)
                )
            self.assertIsNone(timing._current.get())

            async def app(_scope, _receive, send):
                await response(send, headers=[(b"server-timing", b"existing;dur=1")])

            await ProcessingTimings(app, clock=clock)(scope(), receive, self.collect(sent))
            self.assertIsNone(timing._current.get())

        asyncio.run(run())
        values = [v for k, v in sent[0]["headers"] if k == b"server-timing"]
        self.assertEqual(values[0], b"existing;dur=1")
        self.assertTrue(
            re.fullmatch(rb"fv_app;dur=\d+\.\d{3}, fv_firebase;dur=\d+\.\d{3}", values[1])
        )
