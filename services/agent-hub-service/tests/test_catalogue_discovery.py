"""Combined producer acceptance keeps exact refs, lifecycle and failure semantics."""

import copy
import json
import unittest

import httpx
from fixtures import SOURCE, UID
from test_catalogue import PORTFOLIO, STAMP, CatalogueFixture

from folioview_shared.encrypted.constants import CONTRACT_VERSION


class CatalogueDiscoveryTests(CatalogueFixture, unittest.TestCase):
    def add_source(self, serial):
        source, operation = (
            f"holdings_discovery_{serial}",
            f"synthetic_discovery_source_{serial:04d}",
        )
        return self.vaults.create_source(
            UID,
            self.fixture.vault,
            source,
            self.fixture.control(source, operation),
            operation,
            self.fixture.kid("device_sig"),
        )["source"]["resourceRef"]

    def portfolio_calls(self):
        return [call for call in self.calls if call[1].startswith(PORTFOLIO)]

    def test_one_two_ten_refs_make_one_combined_call_with_unchanged_catalogue(self):
        for count in (1, 2, 10):
            with self.subTest(count=count):
                if count > 1:
                    for serial in range(1 if count == 2 else 2, count):
                        self.add_source(serial)
                self.calls.clear()
                self.token_calls.clear()
                result = self.read()
                holdings = result["groups"][0]
                self.assertEqual(holdings["status"], "available")
                self.assertEqual(len(holdings["items"]), count)
                self.assertTrue(
                    all(row["snapshotId"] == self.snapshot for row in holdings["items"])
                )
                calls = self.portfolio_calls()
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0][0], "POST")
                self.assertTrue(calls[0][1].endswith("/internal/v2/resources/discovery/read"))
                self.assertEqual(len(json.loads(calls[0][2])["refs"]), count)
                self.assertEqual(self.token_calls.count(PORTFOLIO), 1)

    def test_exact_envelope_and_inner_dtos_refuse_unknown_or_wrong_profile_fields(self):
        changes = (
            lambda value: value.update(profile="folioview.other.v1"),
            lambda value: value.update(contractVersion="wrong"),
            lambda value: value.update(private="DO_NOT_REFLECT"),
            lambda value: value.pop("states"),
            lambda value: value["states"].update(profile="unexpected"),
            lambda value: value["states"].update(contractVersion="wrong"),
            lambda value: value["states"].update(items=[]),
            lambda value: value["projections"].update(contractVersion="wrong"),
            lambda value: value["projections"].update(items=None),
            lambda value: value["projections"].update(extra="DO_NOT_REFLECT"),
        )
        for change in changes:
            with self.subTest(change=change):
                self.calls.clear()
                self.discovery_change = change
                result = self.read()
                self.assertEqual(result["groups"][0]["status"], "unavailable")
                self.assertEqual(result["groups"][1]["status"], "available")
                self.assertEqual(len(self.portfolio_calls()), 1)
                self.assertNotIn("DO_NOT_REFLECT", json.dumps(result))

    def test_duplicate_extra_foreign_or_nonactive_projections_fail_whole_batch(self):
        self.add_source(1)

        def duplicate(value):
            value["projections"]["items"][1] = value["projections"]["items"][0]

        def extra(value):
            value["projections"]["items"].append(copy.deepcopy(value["projections"]["items"][0]))

        def foreign(value):
            value["projections"]["items"][0]["ref"]["incarnation"] = "foreign_incarnation"

        def nonactive(value):
            value["states"]["items"][0]["state"] = "revoking"

        for change in (duplicate, extra, foreign, nonactive):
            with self.subTest(change=change):
                self.calls.clear()
                self.discovery_change = change
                result = self.read()
                self.assertEqual(result["groups"][0]["status"], "unavailable")
                self.assertEqual(len(self.portfolio_calls()), 1)

    def test_missing_active_projection_and_mismatched_revision_remain_source_failure(self):
        self.add_source(1)
        for mode in ("missing", "revision", "epoch"):
            with self.subTest(mode=mode):

                def change(value, mode=mode):
                    if mode == "missing":
                        value["projections"]["items"].pop(0)
                    else:
                        value["projections"]["items"][0][
                            "revision" if mode == "revision" else "sourceEpoch"
                        ] += 1

                self.discovery_change = change
                rows = self.read()["groups"][0]
                self.assertEqual(rows["status"], "partial")
                self.assertEqual([row["state"] for row in rows["items"]], ["unavailable", "active"])
                self.assertEqual(rows["items"][0]["encryptedEvidence"], "not_checked")

    def test_nonactive_states_and_empty_active_source_keep_original_meaning(self):
        for state in ("revoking", "disconnected", "deleted"):
            with self.subTest(state=state):
                self.lifecycle = state
                row = self.read()["groups"][0]["items"][0]
                self.assertEqual(row["state"], state)
                self.assertIsNone(row["snapshotId"])
                self.assertEqual(row["sourceEpoch"], 1)
        self.lifecycle, self.snapshot = "active", None
        row = self.read()["groups"][0]["items"][0]
        self.assertEqual(
            (row["state"], row["snapshotId"], row["encryptedEvidence"]),
            ("active", None, "not_prepared"),
        )

    def test_source_isolation_uses_only_combined_endpoint_and_one_current_credential(self):
        self.add_source(1)
        self.fail_source = SOURCE
        result = self.read()
        self.assertEqual(result["groups"][0]["status"], "partial")
        self.assertEqual(len(self.portfolio_calls()), 3)
        self.assertTrue(all(call[1].endswith("discovery/read") for call in self.portfolio_calls()))
        self.assertEqual(self.token_calls.count(PORTFOLIO), 1)
        self.assertEqual(
            [row["state"] for row in result["groups"][0]["items"]], ["unavailable", "active"]
        )

    def test_old_uncombined_body_and_unsupported_producer_fail_without_legacy_fallback(self):
        old = {
            "contractVersion": CONTRACT_VERSION,
            "items": [
                {
                    "ref": self.source,
                    "revision": 1,
                    "sourceEpoch": 1,
                    "state": "active",
                    "observedAt": STAMP,
                }
            ],
        }
        for status, body in ((200, old), (404, {"private": "DO_NOT_REFLECT"})):
            with self.subTest(status=status):
                self.calls.clear()

                def handle(request, status=status, body=body):
                    response = self.handle(request)
                    return (
                        httpx.Response(status, json=body)
                        if request.url.host == "portfolio.synthetic.example"
                        else response
                    )

                result = self.read(sources=self.make_sources(transport=httpx.MockTransport(handle)))
                self.assertEqual(result["groups"][0]["status"], "unavailable")
                self.assertEqual(len(self.portfolio_calls()), 1)
                self.assertNotIn("DO_NOT_REFLECT", json.dumps(result))
