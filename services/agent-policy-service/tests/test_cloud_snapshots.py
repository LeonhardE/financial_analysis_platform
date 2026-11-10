"""Immutable GCS generation preconditions and bounded digest verification."""

import unittest
from types import SimpleNamespace

from google.api_core.exceptions import PreconditionFailed

from app.contracts import Unavailable, digest
from app.store import GCSSnapshots


class CloudSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.objects = {}
        self.calls = []
        self.bad = False
        case = self

        class Blob:
            def __init__(self, name):
                self.name = name
                self.generation = None
                self.size = None

            def reload(self, **kwargs):
                case.calls.append(("reload", kwargs))
                raw, generation = case.objects[self.name]
                self.generation = generation
                self.size = len(raw)

            def download_as_bytes(self, **kwargs):
                case.calls.append(("read", kwargs))
                raw, generation = case.objects[self.name]
                if kwargs["if_generation_match"] != generation:
                    raise PreconditionFailed("Synthetic newer generation")
                return b"{}" if case.bad else raw

            def upload_from_string(self, raw, **kwargs):
                case.calls.append(("write", kwargs))
                if self.name in case.objects:
                    raise PreconditionFailed("Immutable already exists")
                if kwargs["if_generation_match"] != 0:
                    raise AssertionError("Missing create-only condition")
                case.objects[self.name] = (raw, 123)

        bucket = SimpleNamespace(blob=lambda name: Blob(name))
        self.adapter = GCSSnapshots(
            "synthetic-policy-snapshots", client=SimpleNamespace(bucket=lambda name: bucket)
        )

    def test_create_only_snapshot_round_trip_uses_exact_generation_and_crc(self):
        value = {"synthetic": "public policy metadata"}
        key = self.adapter.put(value)
        self.assertEqual(key, digest(value))
        self.assertEqual(self.adapter.put(value), key)
        self.assertEqual(self.adapter.read(key), value)
        for method, request in self.calls:
            self.assertEqual(request["timeout"], 4)
            self.assertIsNone(request["retry"])
            if method in {"read", "write"}:
                self.assertEqual(request["checksum"], "crc32c")
        self.assertTrue(
            any(
                method == "read" and req["if_generation_match"] == 123 for method, req in self.calls
            )
        )

    def test_older_or_modified_snapshot_cannot_satisfy_latest_digest(self):
        key = self.adapter.put({"state": "latest"})
        self.bad = True
        with self.assertRaises(Unavailable):
            self.adapter.read(key)
        with self.assertRaises(Unavailable):
            self.adapter.put({"state": "latest"})

    def test_oversized_cloud_object_is_rejected_before_download(self):
        key = "a" * 64
        self.objects["policy-state/" + key + ".json"] = (b"x" * 524289, 123)
        with self.assertRaises(Unavailable):
            self.adapter.read(key)
        self.assertFalse(any(method == "read" for method, kw in self.calls))
