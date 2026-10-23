"""Validate the HTTP service boundary without a Market Python dependency."""

import asyncio
import json
import os
import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from app.market_client import MAX_RESPONSE_BYTES, MarketResolver, get_market_resolver


def instrument(symbol="NFLX", **overrides):
    return {
        "symbol": symbol,
        "name": "Netflix",
        "instrumentType": "stock",
        "currency": "USD",
        **overrides,
    }


class Body(httpx.AsyncByteStream):
    def __init__(self, *chunks):
        self.chunks = chunks

    async def __aiter__(self):
        for chunk in self.chunks:
            yield chunk


def response(payload, *, status=200, headers=None):
    return httpx.Response(
        status,
        headers={"content-type": "application/json", **(headers or {})},
        stream=Body(json.dumps(payload).encode()),
    )


class MarketBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    async def resolve(self, upstream, symbol="NFLX"):
        resolver = MarketResolver(
            "https://market.example", transport=httpx.MockTransport(lambda request: upstream)
        )
        return await resolver.resolve(symbol)

    async def assert_unavailable(self, upstream):
        with self.assertRaises(HTTPException) as context:
            await self.resolve(upstream)
        self.assertEqual(context.exception.status_code, 503)
        self.assertEqual(context.exception.detail, "Stock validation is temporarily unavailable")

    async def test_exact_public_instrument_is_resolved_without_identity_or_redirects(self):
        requests = []

        def handle(request):
            requests.append(request)
            return response({"stocks": [instrument("NFLX1"), instrument()]})

        resolver = MarketResolver("https://market.example/", transport=httpx.MockTransport(handle))
        result = await resolver.resolve("NFLX")
        self.assertEqual(result.public(), instrument())
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(request.method, "GET")
        self.assertEqual(str(request.url), "https://market.example/api/stocks/search?q=NFLX")
        self.assertNotIn("authorization", request.headers)
        self.assertNotIn("cookie", request.headers)
        self.assertEqual(request.headers["accept-encoding"], "identity")
        self.assertTrue(all(timeout == 4 for timeout in request.extensions["timeout"].values()))

    async def test_unknown_symbol_or_upstream_404_is_not_found(self):
        for upstream in (
            response({"stocks": []}),
            response({"stocks": [instrument("NFLX1")]}),
            response({}, status=404),
        ):
            with self.subTest(upstream=upstream), self.assertRaises(HTTPException) as context:
                await self.resolve(upstream)
            self.assertEqual(context.exception.status_code, 404)
            self.assertEqual(context.exception.detail, "US stock symbol not found")

    async def test_redirects_auth_errors_rate_limits_and_server_failures_are_sanitized(self):
        for status in (301, 302, 307, 401, 403, 429, 500, 503):
            with self.subTest(status=status):
                await self.assert_unavailable(
                    response(
                        {"detail": "private upstream detail"},
                        status=status,
                        headers={"location": "https://attacker.example"},
                    )
                )

    async def test_malformed_or_untrusted_instrument_data_cannot_be_persisted(self):
        payloads = (
            None,
            [],
            {},
            {"stocks": {}},
            {"stocks": [instrument()] * 11},
            {"stocks": [instrument(), instrument()]},
            {"stocks": [instrument(currency="CAD")]},
            {"stocks": [instrument(instrumentType="crypto")]},
            {"stocks": [instrument(instrumentType="index")]},
            {"stocks": [instrument(name="")]},
            {"stocks": [instrument(name=" ")]},
            {"stocks": [instrument(email="secret@example.com")]},
            {"stocks": [instrument(symbol="bad!")]},
            {"stocks": [instrument(symbol="nflx")]},
        )
        for payload in payloads:
            with self.subTest(payload=payload):
                await self.assert_unavailable(response(payload))

    async def test_invalid_json_encoded_or_oversize_bodies_are_rejected(self):
        for upstream in (
            httpx.Response(200, stream=Body(b"not-json")),
            response({"stocks": [instrument()]}, headers={"content-encoding": "gzip"}),
            response({}, headers={"content-length": str(MAX_RESPONSE_BYTES + 1)}),
            response({}, headers={"content-length": "invalid"}),
            httpx.Response(200, stream=Body(b" " * MAX_RESPONSE_BYTES, b"x")),
        ):
            with self.subTest(upstream=upstream):
                await self.assert_unavailable(upstream)

    async def test_network_failures_and_slow_streams_are_bounded_and_sanitized(self):
        for exception in (httpx.ConnectError("private endpoint"), httpx.ReadTimeout("private")):

            def fail(request, exception=exception):
                raise exception

            resolver = MarketResolver("https://market.example", transport=httpx.MockTransport(fail))
            with self.assertRaises(HTTPException) as context:
                await resolver.resolve("NFLX")
            self.assertEqual(context.exception.status_code, 503)
            self.assertNotIn("private", context.exception.detail)

        class SlowBody(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b"{"
                await asyncio.sleep(10)
                yield b"}"

        resolver = MarketResolver(
            "https://market.example",
            transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=SlowBody())),
        )
        with patch("app.market_client.VALIDATION_SECONDS", 0.01):
            with self.assertRaises(HTTPException) as context:
                await resolver.resolve("NFLX")
        self.assertEqual(context.exception.status_code, 503)

    async def test_market_origin_is_server_configuration_and_invalid_origins_fail_closed(self):
        for origin in (
            "",
            "ftp://market.example",
            "https://user:secret@market.example",
            "https://market.example/path",
            "https://market.example?query=secret",
            "https://market.example#fragment",
        ):
            with self.subTest(origin=origin):
                resolver = MarketResolver(origin)
                with self.assertRaises(HTTPException) as context:
                    await resolver.resolve("NFLX")
                self.assertEqual(context.exception.status_code, 503)
        self.assertEqual(get_market_resolver().base_url, "http://127.0.0.1:8000")
        with patch.dict(os.environ, {"K_SERVICE": "user-api"}):
            self.assertEqual(get_market_resolver().base_url, "")
            with self.assertRaises(HTTPException) as context:
                await MarketResolver("http://market.example").resolve("NFLX")
            self.assertEqual(context.exception.status_code, 503)
