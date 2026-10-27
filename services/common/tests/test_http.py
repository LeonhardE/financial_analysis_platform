"""Shared infrastructure behavior, independent from service business modules."""

import unittest

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from folioview_shared.http import PrivateRoute, create_app
from folioview_shared.identity import owner_key


class PrivateHTTPTests(unittest.TestCase):
    def setUp(self):
        app = create_app("Test Config", private=True, methods=("GET", "PUT"))
        router = APIRouter(route_class=PrivateRoute)

        @router.get("/api/v1/example/{count}")
        def example(count: int):
            if count == 1:
                raise HTTPException(401, "Sign in")
            if count == 2:
                raise RuntimeError("secret SDK details must not escape")
            return {"count": count}

        app.include_router(router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_private_success_auth_validation_failure_and_missing_route_are_never_cached(self):
        for path, status in (
            ("/api/v1/example/0", 200),
            ("/api/v1/example/1", 401),
            ("/api/v1/example/2", 503),
            ("/api/v1/example/not-a-number", 422),
            ("/api/v1/missing", 404),
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertNotIn("secret SDK", response.text)

    def test_cors_keeps_private_failures_uncacheable_and_respects_service_methods(self):
        for method, status in (("PUT", 200), ("DELETE", 400)):
            response = self.client.options(
                "/api/v1/example/0",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": method,
                    "Access-Control-Request-Headers": "authorization,content-type",
                },
            )
            self.assertEqual(response.status_code, status)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertNotIn("access-control-allow-credentials", response.headers)

    def test_private_app_default_routes_sanitize_unexpected_failures(self):
        app = create_app("Default private route", private=True)

        @app.get("/api/v1/me")
        def fail():
            raise RuntimeError("private SDK implementation details")

        with TestClient(app) as client:
            response = client.get("/api/v1/me")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("SDK", response.text)

    def test_default_private_prefix_preserves_internal_and_public_response_headers(self):
        app = create_app("Existing service", private=True)

        @app.get("/internal/v1/example")
        @app.get("/health")
        def existing_response():
            return JSONResponse({"status": "ok"}, headers={"Cache-Control": "public, max-age=60"})

        with TestClient(app) as client:
            for path in ("/internal/v1/example", "/health"):
                with self.subTest(path=path):
                    response = client.get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["cache-control"], "public, max-age=60")
            self.assertNotIn("cache-control", client.get("/internal/v1/missing").headers)

    def test_internal_prefix_opt_in_protects_all_private_responses_and_preflight(self):
        app = create_app(
            "Internal service",
            private=True,
            private_prefixes=("/api/", "/internal/"),
            methods=("GET", "POST"),
        )

        @app.get("/api/v1/example/{count}")
        @app.get("/internal/v1/example/{count}")
        def private_response(count: int):
            if count in (401, 403, 503):
                raise HTTPException(count, "Private failure", headers={"Cache-Control": "public"})
            if count == 500:
                raise RuntimeError("private provider details")
            return JSONResponse({"count": count}, headers={"Cache-Control": "public, max-age=60"})

        @app.get("/internality/v1/example")
        @app.get("/health")
        def public_response():
            return JSONResponse({"status": "ok"}, headers={"Cache-Control": "public, max-age=60"})

        with TestClient(app) as client:
            for prefix in ("/api/", "/internal/"):
                for path, method, status in (
                    ("v1/example/0", "GET", 200),
                    ("v1/example/401", "GET", 401),
                    ("v1/example/403", "GET", 403),
                    ("v1/example/503", "GET", 503),
                    ("v1/example/500", "GET", 503),
                    ("v1/missing", "GET", 404),
                    ("v1/example/0", "DELETE", 405),
                    ("v1/example/not-a-number", "GET", 422),
                ):
                    with self.subTest(prefix=prefix, path=path, method=method):
                        response = client.request(method, prefix + path)
                        self.assertEqual(response.status_code, status)
                        self.assertEqual(response.headers.get_list("cache-control"), ["no-store"])
                        self.assertNotIn("provider details", response.text)
                for method, status in (("POST", 200), ("DELETE", 400)):
                    with self.subTest(prefix=prefix, preflight=method):
                        response = client.options(
                            prefix + "v1/example/0",
                            headers={
                                "Origin": "http://localhost:3000",
                                "Access-Control-Request-Method": method,
                                "Access-Control-Request-Headers": (
                                    "authorization,x-folioview-delegation"
                                ),
                            },
                        )
                        self.assertEqual(response.status_code, status)
                        self.assertEqual(response.headers.get_list("cache-control"), ["no-store"])
            for path in ("/health", "/internality/v1/example"):
                response = client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["cache-control"], "public, max-age=60")

    def test_opaque_ownership_stays_compatible_and_path_safe(self):
        self.assertEqual(
            owner_key("user"),
            "04f8996da763b7a969b1028ee3007569eaf3a635486ddab211d512c85b9df8fb",
        )
        self.assertRegex(owner_key("../opaque/user"), r"^[a-f0-9]{64}$")
        self.assertNotEqual(owner_key("user"), owner_key("other-user"))
