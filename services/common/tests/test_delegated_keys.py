"""Synthetic trusted-JWKS failures, rotation and bounded refresh behavior."""

import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request

from cryptography.hazmat.primitives.asymmetric import rsa

from folioview_shared.delegated_keys import (
    MAX_JWKS_BYTES,
    InvalidTokenKey,
    KeyCache,
    KeyUnavailable,
    UnknownKey,
    _NoRedirects,
    fetch_jwks,
)
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode

URL = "https://trusted.example.test/.well-known/jwks.json"


def key(kid):
    numbers = rsa.generate_private_key(65537, 2048).public_key().public_numbers()
    return {
        "kty": "RSA",
        "n": b64url_encode(numbers.n.to_bytes(256, "big")),
        "e": b64url_encode(numbers.e.to_bytes(3, "big")),
        "kid": kid,
        "use": "sig",
        "alg": "RS256",
    }


def jwks(*keys):
    return json.dumps({"keys": list(keys)}).encode()


class Clock:
    def __init__(self):
        self.value = 100.0

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += seconds


class Transport:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, url, *, timeout_seconds, max_bytes):
        self.calls.append((url, timeout_seconds, max_bytes))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class Response:
    def __init__(self, body, *, status=200, headers=None):
        self.body, self.status = body, status
        self.headers = headers or {}
        self.read_sizes = []

    def read(self, size):
        self.read_sizes.append(size)
        return self.body[:size]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None


class DelegatedKeyCacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.first = key("kms_version_1")
        cls.second = key("kms_version_2")

    def cache(self, *responses, **kwargs):
        self.clock = Clock()
        self.transport = Transport(*responses)
        return KeyCache(URL, transport=self.transport, clock=self.clock, **kwargs)

    def test_configured_url_is_fixed_https_and_cannot_smuggle_credentials_or_redirect_parameters(
        self,
    ):
        for invalid in (
            "http://trusted.example.test/keys",
            "https://user:pass@trusted.example.test/keys",
            "https://trusted.example.test:444/keys",
            "https://trusted.example.test/keys?issuer=x",
            "https://trusted.example.test/keys#keys",
            "https://trusted.example.test/keys?",
            "https://trusted.example.test/keys#",
            "https://trusted.example.test/\\attacker",
            "https://trusted.example.test/keys\n",
            "/keys",
            "",
            None,
        ):
            with self.subTest(url=invalid), self.assertRaises(ValueError):
                KeyCache(invalid)
        self.assertEqual(KeyCache(URL).url, URL)

    def test_cache_and_socket_timeout_limits_cannot_be_disabled_or_unbounded(self):
        for values in (
            {"ttl_seconds": 301},
            {"ttl_seconds": 0},
            {"ttl_seconds": True},
            {"refresh_interval_seconds": 0},
            {"refresh_interval_seconds": 301},
            {"timeout_seconds": 3.1},
            {"timeout_seconds": float("nan")},
            {"timeout_seconds": float("inf")},
            {"clock": None},
            {"transport": "token supplied URL"},
        ):
            with self.subTest(values=values), self.assertRaises(ValueError):
                KeyCache(URL, **values)

    def test_known_keys_are_cached_and_returned_as_independent_public_copies(self):
        first = {**self.first, "key_ops": ["verify"]}
        cache = self.cache(jwks(first))
        returned = cache.get_key(first["kid"])
        returned["n"] = "changed"
        returned["key_ops"].append("sign")
        self.clock.advance(299)
        self.assertEqual(cache.get_key(first["kid"]), first)
        self.assertEqual(self.transport.calls, [(URL, 3, MAX_JWKS_BYTES)])

    def test_malformed_token_kid_is_rejected_without_fetching_any_address(self):
        cache = self.cache(jwks(self.first))
        for kid in (None, "", "x" * 129, "https://attacker.test/keys", "kid\n", "kid key"):
            with self.subTest(kid=kid), self.assertRaises(InvalidTokenKey):
                cache.get_key(kid)
        self.assertEqual(self.transport.calls, [])

    def test_unknown_key_refreshes_after_cooldown_and_replaces_rotated_set_atomically(self):
        cache = self.cache(jwks(self.first), jwks(self.second))
        cache.get_key(self.first["kid"])
        self.clock.advance(31)
        self.assertEqual(cache.get_key(self.second["kid"]), self.second)
        with self.assertRaises(UnknownKey):
            cache.get_key(self.first["kid"])
        self.assertEqual(len(self.transport.calls), 2)

    def test_many_unknown_ids_share_one_bounded_refresh_cooldown(self):
        cache = self.cache(jwks(self.first), jwks(self.first))
        for sequence in range(1000):
            with self.assertRaises(UnknownKey):
                cache.get_key(f"unknown_{sequence}")
        self.assertEqual(len(self.transport.calls), 1)
        self.clock.advance(30)
        with self.assertRaises(UnknownKey):
            cache.get_key("another_unknown")
        self.assertEqual(len(self.transport.calls), 2)
        self.assertEqual(cache.get_key(self.first["kid"]), self.first)

    def test_unknown_refresh_outage_does_not_revoke_fresh_known_keys(self):
        cache = self.cache(jwks(self.first), TimeoutError("SyntheticSecret request detail"))
        cache.get_key(self.first["kid"])
        self.clock.advance(31)
        with self.assertRaises(KeyUnavailable) as error:
            cache.get_key(self.second["kid"])
        self.assertNotIn("SyntheticSecret", str(error.exception))
        self.assertEqual(cache.get_key(self.first["kid"]), self.first)
        with self.assertRaises(KeyUnavailable):
            cache.get_key("yet_another_unknown")
        self.assertEqual(len(self.transport.calls), 2)

    def test_expired_key_never_falls_back_to_stale_public_material_during_outage(self):
        cache = self.cache(jwks(self.first), OSError("SyntheticSecret network failure"))
        cache.get_key(self.first["kid"])
        self.clock.advance(300)
        with self.assertRaises(KeyUnavailable):
            cache.get_key(self.first["kid"])
        with self.assertRaises(KeyUnavailable):
            cache.get_key(self.first["kid"])
        self.assertEqual(len(self.transport.calls), 2)

    def test_failed_initial_fetch_is_rate_limited_and_can_recover(self):
        cache = self.cache(TimeoutError("SyntheticSecret"), jwks(self.first))
        for _ in range(20):
            with self.assertRaises(KeyUnavailable):
                cache.get_key(self.first["kid"])
        self.assertEqual(len(self.transport.calls), 1)
        self.clock.advance(30)
        self.assertEqual(cache.get_key(self.first["kid"]), self.first)

    def test_invalid_rotation_does_not_replace_still_fresh_previous_keys(self):
        cache = self.cache(jwks(self.first), jwks(self.second, self.second))
        cache.get_key(self.first["kid"])
        self.clock.advance(31)
        with self.assertRaises(KeyUnavailable):
            cache.get_key(self.second["kid"])
        self.assertEqual(cache.get_key(self.first["kid"]), self.first)

    def test_invalid_key_material_and_embedded_locators_are_unavailable_not_trusted(self):
        alternatives = [
            {**self.first, "d": "private"},
            {**self.first, "x5u": "https://attacker.test"},
            {**self.first, "x5c": []},
            {**self.first, "jku": "https://attacker.test"},
            {**self.first, "alg": "HS256"},
            {**self.first, "kty": "oct"},
            {**self.first, "use": "enc"},
            {**self.first, "key_ops": ["sign", "verify"]},
            {**self.first, "e": "Aw"},
            {**self.first, "n": self.first["n"] + "="},
            {**self.first, "n": b64url_encode(b"\x00" + b64url_decode(self.first["n"]))},
            {**self.first, "n": b64url_encode(b"\xff" * 128)},
            {**self.first, "n": b64url_encode(b"\xff" * 1024)},
            {k: v for k, v in self.first.items() if k != "use"},
            {**self.first, "kid": "https://attacker.test/key"},
        ]
        for value in alternatives:
            with self.subTest(fields=sorted(value)), self.assertRaises(KeyUnavailable):
                self.cache(jwks(value)).get_key(self.first["kid"])

    def test_invalid_or_oversized_keysets_and_duplicate_json_never_enter_cache(self):
        duplicate = jwks(self.first).replace(b'"kid": "kms_version_1"', b'"kid":"a","kid":"b"')
        inputs = (
            b'{"keys":[],"keys":[]}',
            duplicate,
            jwks(),
            jwks(self.first, self.first),
            jwks(*[{**self.first, "kid": f"key_{i}"} for i in range(9)]),
            json.dumps({"keys": [self.first], "extra": "SyntheticSecret"}).encode(),
            b'{"keys":"wrong"}',
            b"\xff",
            b"{" * (MAX_JWKS_BYTES + 1),
            {"keys": [self.first]},
        )
        for raw in inputs:
            with self.subTest(type=type(raw).__name__), self.assertRaises(KeyUnavailable):
                self.cache(raw).get_key(self.first["kid"])

    def test_monotonic_clock_failures_are_closed_even_for_cached_keys(self):
        cache = self.cache(jwks(self.first))
        cache.get_key(self.first["kid"])
        for now in (99, float("nan"), float("inf"), 1e308, True, None):
            self.clock.value = now
            with self.subTest(now=now), self.assertRaises(KeyUnavailable):
                cache.get_key(self.first["kid"])

    def test_concurrent_known_key_requests_do_not_stampede_authority(self):
        cache = self.cache(jwks(self.first))
        with ThreadPoolExecutor(max_workers=16) as pool:
            values = list(pool.map(cache.get_key, [self.first["kid"]] * 64))
        self.assertTrue(all(value == self.first for value in values))
        self.assertEqual(len(self.transport.calls), 1)


class BoundedJwksFetchTests(unittest.TestCase):
    def test_public_transport_cannot_bypass_size_or_socket_timeout_caps(self):
        for timeout, maximum in (
            (0, 1024),
            (4, 1024),
            (None, 1024),
            (True, 1024),
            (3, 0),
            (3, MAX_JWKS_BYTES + 1),
            (3, True),
        ):
            with self.subTest(timeout=timeout, maximum=maximum):
                with patch("folioview_shared.delegated_keys.build_opener") as build:
                    with self.assertRaises(ValueError):
                        fetch_jwks(URL, timeout_seconds=timeout, max_bytes=maximum)
                    build.assert_not_called()

    def test_fetch_pins_configured_address_timeout_and_read_budget_without_credentials(self):
        response = Response(b'{"keys":[]}')
        with patch("folioview_shared.delegated_keys.build_opener") as build:
            build.return_value.open.return_value = response
            self.assertEqual(fetch_jwks(URL, timeout_seconds=3, max_bytes=1024), response.body)
        request = build.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, URL)
        self.assertIsInstance(build.call_args.args[0], _NoRedirects)
        self.assertEqual(build.return_value.open.call_args.kwargs, {"timeout": 3})
        self.assertEqual(request.header_items(), [("Accept", "application/json")])
        self.assertEqual(response.read_sizes, [1025])

    def test_redirect_handler_never_accepts_a_second_destination(self):
        with self.assertRaises(HTTPError):
            _NoRedirects().redirect_request(
                Request(URL), None, 302, "redirect", {}, "https://attacker.test"
            )
        with patch("folioview_shared.delegated_keys.build_opener") as build:
            build.return_value.open.side_effect = HTTPError(URL, 302, "SyntheticSecret", {}, None)
            with self.assertRaises(KeyUnavailable) as error:
                fetch_jwks(URL, timeout_seconds=3, max_bytes=1024)
        self.assertNotIn("SyntheticSecret", str(error.exception))
        self.assertEqual(build.return_value.open.call_count, 1)

    def test_response_status_encoding_length_and_actual_bytes_are_bounded(self):
        for response in (
            Response(b"{}", status=503),
            Response(b"{}", headers={"Content-Encoding": "gzip"}),
            Response(b"{}", headers={"Content-Length": "1025"}),
            Response(b"{}", headers={"Content-Length": "not-a-number"}),
            Response(b"x" * 1025),
        ):
            with self.subTest(status=response.status, headers=response.headers):
                with patch("folioview_shared.delegated_keys.build_opener") as build:
                    build.return_value.open.return_value = response
                    with self.assertRaises(KeyUnavailable):
                        fetch_jwks(URL, timeout_seconds=3, max_bytes=1024)


if __name__ == "__main__":
    unittest.main()
