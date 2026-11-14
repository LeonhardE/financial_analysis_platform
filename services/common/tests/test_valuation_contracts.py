"""Synthetic facts/rates only; no provider, credentials, cloud or consumer adoption."""

import copy
import json
import subprocess
import unittest
from decimal import Decimal
from pathlib import Path

from test_encrypted_schema import context_for, wrapper
from test_persistent_content import PersistentContentFixture

from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.persistent_content import (
    CONTENT_PROFILE,
    validate_persistent_private,
)
from folioview_shared.encrypted.private import validate_private_payload
from folioview_shared.valuation import (
    CURRENCY_PROFILE,
    DEFAULT_PREFERENCES,
    FX_PREFERENCES_PROFILE,
    HOLDINGS_FACTS_PROFILE,
    VALUATION_CONTRACT,
    ValuationError,
    cross_rate,
    currency_snapshot,
    display_currencies,
    effective_fx_pairs,
    fx_request,
    load_valuation_schema,
    next_currency_snapshot,
    next_fx_preferences_snapshot,
    quote_request,
    resolve_preferences,
    round_display_amount,
    validate_fx_batch,
    validate_holdings_facts,
    validate_holdings_private,
    validate_quote_batch,
    validate_valuation_schema,
    value_holdings,
)

NOW = "2026-11-13T22:00:00Z"
DAY = "2026-11-13"


def provenance(origin="import"):
    return {
        "origin": origin,
        "recordedAt": NOW if origin != "unknown" else None,
        "sourceDate": DAY if origin == "import" else None,
        "lastEditedAt": NOW if origin == "manual" else None,
    }


def instrument(symbol="SYNTH", market="XNAS", currency="USD"):
    return {"symbol": symbol, "market": market, "currency": currency}


def position(asset="asset_1", currency="USD", quantity="2"):
    return {
        "assetId": asset,
        "brokerAssetId": "synthetic_asset",
        "instrument": instrument(currency=currency),
        "name": "Synthetic",
        "assetType": "stock",
        "quantity": quantity,
        "unitCost": {"currency": currency, "amount": "10"},
        "bookCost": None,
        "bookCostCad": None,
        "reportedValues": {
            "unitPrice": {"currency": currency, "amount": "12"},
            "marketValue": {"currency": "CAD", "amount": "9999"},
            "unrealizedReturn": {"currency": "CAD", "amount": "-5"},
        },
        "provenance": {
            field: provenance("unknown" if field in {"bookCost", "bookCostCad"} else "import")
            for field in ["instrument", "quantity", "unitCost", "bookCost", "bookCostCad"]
        },
    }


def facts(snapshot="snapshot_1"):
    return {
        "state": "ready",
        "coverage": {"state": "unknown", "issues": []},
        "sourceAsOf": None,
        "fetchedAt": NOW,
        "freshness": "unknown",
        "data": {
            "kind": "holdings",
            "profile": HOLDINGS_FACTS_PROFILE,
            "snapshotId": snapshot,
            "editKind": "import",
            "reportDate": DAY,
            "importSnapshot": {"snapshotId": snapshot, "sourceRevision": 1},
            "previousSnapshot": None,
            "accounts": [
                {
                    "accountId": "account_1",
                    "displayName": "Synthetic account",
                    "balances": [{"currency": "CAD", "cashBalance": "123.45", "buyingPower": None}],
                    "positions": [position()],
                }
            ],
            "excludedAssets": [],
        },
    }


def meta(status="available"):
    return {
        "status": status,
        "sourceAsOf": NOW,
        "sourceDate": DAY,
        "fetchedAt": NOW,
        "reason": None,
    }


def quote(symbol="SYNTH", market="XNAS", currency="USD", price="20"):
    return {
        "instrument": instrument(symbol, market, currency),
        "price": price,
        "source": "yahoo_finance",
        **meta(),
    }


def batch(kind, items):
    return {
        "contractVersion": VALUATION_CONTRACT,
        "profile": f"folioview.{kind}-batch.v1",
        "snapshotId": f"synthetic_{kind}_snapshot",
        "fetchedAt": NOW,
        "items": items,
    }


def fx(base="USD", quote="CNY", a="1.4", b="0.2"):
    if base == quote:
        return {
            "base": base,
            "quote": quote,
            "rate": "1",
            "source": "identity",
            "route": {"kind": "identity", "via": None, "legs": []},
            **meta(),
            "sourceAsOf": None,
            "sourceDate": None,
        }

    def leg(currency, rate):
        return {"base": currency, "quote": "CAD", "rate": rate, "sourceDate": DAY}

    route = (
        {"kind": "direct", "via": None, "legs": [leg(base, a)]}
        if quote == "CAD"
        else (
            {"kind": "inverse", "via": None, "legs": [leg(quote, b)]}
            if base == "CAD"
            else {"kind": "cross", "via": "CAD", "legs": [leg(base, a), leg(quote, b)]}
        )
    )
    return {
        "base": base,
        "quote": quote,
        "rate": cross_rate("1" if base == "CAD" else a, "1" if quote == "CAD" else b),
        "source": "bank_of_canada",
        "route": route,
        **meta(),
        "sourceAsOf": None,
    }


def currency_empty():
    return {
        "contractVersion": VALUATION_CONTRACT,
        "profile": CURRENCY_PROFILE,
        "preferences": None,
        "version": 0,
        "currencyGeneration": 0,
    }


def fx_empty():
    return {
        "contractVersion": VALUATION_CONTRACT,
        "profile": FX_PREFERENCES_PROFILE,
        "preferences": None,
        "version": 0,
    }


class ValuationContractTests(unittest.TestCase):
    def test_closed_facts_keep_unknown_costs_and_independent_import_and_edit_history(self):
        source = facts()
        result = validate_holdings_facts(source, snapshot_id="snapshot_1", revision=1)
        result["data"]["accounts"][0]["positions"][0]["unitCost"]["amount"] = "99"
        self.assertEqual(source["data"]["accounts"][0]["positions"][0]["unitCost"]["amount"], "10")
        edited = copy.deepcopy(source)
        edited["data"].update(
            snapshotId="snapshot_2",
            editKind="edit",
            previousSnapshot={"snapshotId": "snapshot_1", "sourceRevision": 1},
        )
        p = edited["data"]["accounts"][0]["positions"][0]
        p["quantity"] = "3.000000000001"
        p["provenance"]["quantity"] = provenance("manual")
        self.assertEqual(
            validate_holdings_facts(edited, revision=2)["data"]["importSnapshot"]["snapshotId"],
            "snapshot_1",
        )
        self.assertIsNone(p["bookCostCad"])
        self.assertEqual(p["reportedValues"]["marketValue"], {"currency": "CAD", "amount": "9999"})
        for change in [
            lambda v: v["data"].update(profile="unknown"),
            lambda v: v["data"].update(
                previousSnapshot={"snapshotId": "snapshot_2", "sourceRevision": 2}
            ),
            lambda v: v["data"]["accounts"].append(v["data"]["accounts"][0]),
            lambda v: v["data"]["accounts"][0]["positions"][0]["unitCost"].update(currency="CAD"),
            lambda v: v["data"]["accounts"][0]["positions"][0]["provenance"]["quantity"].update(
                lastEditedAt=None
            ),
            lambda v: v.update(fetchedAt="2026-02-30T00:00:00Z"),
        ]:
            bad = copy.deepcopy(edited)
            change(bad)
            with self.assertRaises(ValuationError):
                validate_holdings_facts(bad, revision=2)

    def test_original_private_schemas_remain_strict_and_both_new_opt_in_readers_bind_context(self):
        context = context_for("holdings_snapshot")
        old = wrapper(context)
        self.assertEqual(validate_private_payload(old, context=context), old)
        new = copy.deepcopy(old)
        new["payload"] = facts(context["objectId"])
        with self.assertRaises(ContractError):
            validate_private_payload(new, context=context)
        self.assertEqual(validate_holdings_private(new, context=context), new)
        bad = copy.deepcopy(new)
        bad["binding"]["resourceRef"]["incarnation"] = "foreign"
        with self.assertRaises(ValuationError):
            validate_holdings_private(bad, context=context)
        f = PersistentContentFixture()
        pc = f.content_context("holdings_snapshot")
        payload = {
            "privateSchemaVersion": 1,
            "profile": CONTENT_PROFILE,
            "objectId": pc["objectId"],
            "objectType": "holdings_snapshot",
            "revision": 1,
            "payload": facts(pc["objectId"]),
        }
        with self.assertRaises(ContractError):
            validate_persistent_private(payload, context=pc)
        self.assertEqual(validate_holdings_private(payload, context=pc, persistent=True), payload)
        for field, value in [
            ("revision", True),
            ("objectId", "foreign"),
            ("privateSchemaVersion", 2),
        ]:
            bad = copy.deepcopy(payload)
            bad[field] = value
            with self.assertRaises(ValuationError):
                validate_holdings_private(bad, context=pc, persistent=True)

    def test_requests_are_bounded_deduplicated_and_never_accept_private_holdings_fields(self):
        a, b = instrument(), instrument("SECOND", "XTSE", "CAD")
        self.assertEqual(quote_request({"instruments": [a, b, a]})["instruments"], [a, b])
        self.assertEqual(
            fx_request({"pairs": [{"base": "USD", "quote": "CNY"}] * 2})["pairs"],
            [{"base": "USD", "quote": "CNY"}],
        )
        for value in [
            {"instruments": [{**a, "quantity": "5"}]},
            {"instruments": [a] * 51},
            {"instruments": []},
            {"instruments": [a], "accountId": "private"},
            {"instruments": [{**a, "symbol": "https://arbitrary"}]},
        ]:
            with self.assertRaises(ValuationError):
                quote_request(value)

    def test_positive_decimals_actual_currency_and_time_are_not_inferred_or_floated(self):
        for price in ["0", "NaN", "Infinity", "1e4", "-1", 0.5, True, "01"]:
            with self.assertRaises(ValuationError):
                validate_quote_batch(batch("quote", [quote(price=price)]))
        q = quote()
        value = batch("quote", [q])
        self.assertEqual(validate_quote_batch(value, requested=[instrument()]), value)
        with self.assertRaises(ValuationError):
            validate_quote_batch(value, requested=[instrument(currency="CAD")])
        for change in [
            lambda v: v["items"][0].update(sourceAsOf="2026-11-14T00:00:00Z"),
            lambda v: v["items"].append(v["items"][0]),
            lambda v: v["items"][0].update(sourceAsOf=None),
            lambda v: v["items"][0].update(status="missing"),
        ]:
            bad = copy.deepcopy(value)
            change(bad)
            with self.assertRaises(ValuationError):
                validate_quote_batch(bad)

    def test_fx_direction_inverse_and_cross_require_same_observation_snapshot(self):
        for item in [fx(), fx("USD", "CAD"), fx("CAD", "USD", b="1.4"), fx("CAD", "CAD")]:
            self.assertEqual(validate_fx_batch(batch("fx", [item]))["items"][0], item)
        self.assertEqual(cross_rate("1.4", "0.2"), "7")
        self.assertEqual(cross_rate("1", "3"), "0.333333333333333333")
        for change in [
            lambda v: v["items"][0].update(rate="0"),
            lambda v: v["items"][0].update(rate="0.142857"),
            lambda v: v["items"][0]["route"]["legs"][1].update(sourceDate="2026-11-12"),
            lambda v: v["items"][0]["route"].update(via="EUR"),
            lambda v: v["items"][0].update(rate="NaN"),
        ]:
            bad = batch("fx", [fx()])
            change(bad)
            with self.assertRaises(ValuationError):
                validate_fx_batch(bad)
        a, b = fx(), fx("USD", "CAD")
        b["sourceDate"] = "2026-11-12"
        b["route"]["legs"][0]["sourceDate"] = "2026-11-12"
        with self.assertRaises(ValuationError):
            validate_fx_batch(batch("fx", [a, b]))

    def test_client_values_sum_before_rounding_and_missing_rows_do_not_become_zero_or_full_coverage(
        self,
    ):
        holdings = facts()
        positions = holdings["data"]["accounts"][0]["positions"]
        positions[0]["quantity"] = "1"
        positions.append(position("asset_2", "CAD", "1"))
        positions[1]["instrument"] = instrument("SECOND", "XTSE", "CAD")
        quotes = batch("quote", [quote(price="0.005"), quote("SECOND", "XTSE", "CAD", "0.005")])
        rates = batch("fx", [fx("USD", "CAD", a="1"), fx("CAD", "CAD")])
        valuation = value_holdings(holdings, quotes, rates, "CAD")
        self.assertEqual(valuation["subtotal"], "0.01")
        self.assertEqual(round_display_amount(valuation["subtotal"], "CAD"), "0.01")
        self.assertEqual([r["weightPercent"] for r in valuation["rows"]], ["50", "50"])
        self.assertNotIn("123.45", valuation["subtotal"], "cash is not silently included")
        quotes["items"][1].update(status="missing", price=None, reason="upstream_unavailable")
        partial = value_holdings(holdings, quotes, rates, "CAD")
        self.assertFalse(partial["complete"])
        self.assertEqual(partial["valuedCount"], 1)
        self.assertIsNone(partial["rows"][1]["value"])
        self.assertEqual(partial["rows"][0]["weightPercent"], "100")
        quotes["items"][0].update(status="stale")
        self.assertTrue(value_holdings(holdings, quotes, rates, "CAD")["stale"])
        rates["items"][0].update(status="missing", rate=None, route=None, reason="missing_leg")
        missing = value_holdings(holdings, quotes, rates, "CAD")
        self.assertEqual(missing["valuedCount"], 0)
        self.assertIsNone(missing["subtotal"])

    def test_empty_and_zero_quantity_holdings_need_no_fake_quote_or_fx_observation(self):
        holdings = facts()
        holdings["data"]["accounts"][0]["positions"] = []
        empty = value_holdings(holdings, batch("quote", []), batch("fx", []), "CNY")
        self.assertTrue(empty["complete"])
        self.assertEqual(empty["subtotal"], "0")
        holdings["data"]["accounts"][0]["positions"] = [position(quantity="0")]
        zero = value_holdings(holdings, batch("quote", []), batch("fx", []), "CNY")
        self.assertEqual(zero["rows"][0]["value"], "0")
        self.assertIsNone(zero["rows"][0]["weightPercent"])
        self.assertTrue(zero["complete"])
        with self.assertRaises(ValuationError):
            validate_quote_batch(batch("quote", []), requested=[instrument()])

    def test_large_quantities_and_fx_are_exact_and_currency_choices_are_local_to_current_source(
        self,
    ):
        holdings = facts()
        p = holdings["data"]["accounts"][0]["positions"][0]
        p["quantity"] = "9007199254740993.000000000001"
        quotes = batch("quote", [quote(price="1")])
        rates = batch("fx", [fx()])
        result = value_holdings(holdings, quotes, rates, "CNY")
        self.assertEqual(result["subtotal"], "63050394783186951.000000000007")
        self.assertEqual(display_currencies(holdings, "CNY"), ["CNY", "USD"])
        holdings["data"]["accounts"][0]["positions"].append(position("asset_2", "CAD"))
        self.assertEqual(display_currencies(holdings, "CNY"), ["CNY", "USD", "CAD"])
        self.assertEqual(Decimal(cross_rate("1.4", "0.2")), Decimal(7))
        self.assertEqual(round_display_amount("2.5", "JPY"), "2")
        self.assertEqual(round_display_amount("3.5", "JPY"), "4")

    def test_independent_defaults_preserve_old_explicit_preferences_and_strict_v1_shape(self):
        ui = {"preferences": None, "version": 0}
        currency = currency_empty()
        self.assertEqual(resolve_preferences(ui, currency), dict(DEFAULT_PREFERENCES))
        old = {
            "preferences": {"theme": "dark", "language": "zh", "defaultChartRange": "1y"},
            "version": 7,
        }
        selected = next_currency_snapshot(
            currency, {"defaultPortfolioCurrency": "CNY", "expectedVersion": 0}
        )
        resolved = resolve_preferences(old, selected)
        self.assertEqual(resolved, {**old["preferences"], "defaultPortfolioCurrency": "CNY"})
        validate_valuation_schema("UiPreferencesSnapshotV1", old)
        with self.assertRaises(ValuationError):
            validate_valuation_schema("UiPreferencesV1", resolved)
        for bad in [
            {"preferences": {"theme": "dark"}, "version": 1},
            {"preferences": None, "version": 1},
        ]:
            with self.assertRaises(ValuationError):
                resolve_preferences(bad, selected)
        self.assertEqual(old["version"], 7)
        unresolved_market = facts()
        unresolved_market["data"]["accounts"][0]["positions"][0]["instrument"]["market"] = "XHKG"
        self.assertEqual(
            validate_holdings_facts(unresolved_market)["data"]["accounts"][0]["positions"][0][
                "instrument"
            ]["market"],
            "XHKG",
        )

    def test_identical_currency_saves_advance_cas_without_resetting_default_suppression(
        self,
    ):
        a = next_currency_snapshot(
            currency_empty(), {"defaultPortfolioCurrency": "CNY", "expectedVersion": 0}
        )
        b = next_currency_snapshot(a, {"defaultPortfolioCurrency": "CNY", "expectedVersion": 1})
        self.assertEqual(b["version"], 2)
        self.assertEqual(b["currencyGeneration"], 1)
        with self.assertRaisesRegex(ValuationError, "version_conflict"):
            next_currency_snapshot(b, {"defaultPortfolioCurrency": "CAD", "expectedVersion": 1})
        c = next_currency_snapshot(b, {"defaultPortfolioCurrency": "CAD", "expectedVersion": 2})
        d = next_currency_snapshot(c, {"defaultPortfolioCurrency": "CNY", "expectedVersion": 3})
        self.assertEqual(d["currencyGeneration"], 3)
        malformed = {**a, "currencyGeneration": 0}
        with self.assertRaises(ValuationError):
            currency_snapshot(malformed)

    def test_fx_manual_order_dedup_defaults_suppression_and_preference_failure_never_write_or_erase(
        self,
    ):
        current = next_currency_snapshot(
            currency_empty(), {"defaultPortfolioCurrency": "CNY", "expectedVersion": 0}
        )
        prefs = fx_empty()
        self.assertEqual(
            effective_fx_pairs(prefs, current),
            [{"base": "USD", "quote": "CNY", "origin": "default"}],
        )
        pairs = [{"base": "CAD", "quote": "USD"}, {"base": "USD", "quote": "CNY"}]
        saved = next_fx_preferences_snapshot(
            prefs,
            {"preferences": {"pairs": pairs, "suppressedDefault": None}, "expectedVersion": 0},
        )
        self.assertEqual(
            [p["origin"] for p in effective_fx_pairs(saved, current)], ["manual", "manual"]
        )
        self.assertEqual(len(effective_fx_pairs(saved, None)), 2)
        suppressed = next_fx_preferences_snapshot(
            saved,
            {
                "preferences": {
                    "pairs": [pairs[0]],
                    "suppressedDefault": {"currency": "CNY", "currencyGeneration": 1},
                },
                "expectedVersion": 1,
            },
        )
        self.assertEqual(len(effective_fx_pairs(suppressed, current)), 1)
        same = next_currency_snapshot(
            current, {"defaultPortfolioCurrency": "CNY", "expectedVersion": 1}
        )
        self.assertEqual(len(effective_fx_pairs(suppressed, same)), 1)
        changed = next_currency_snapshot(
            same, {"defaultPortfolioCurrency": "CAD", "expectedVersion": 2}
        )
        back = next_currency_snapshot(
            changed, {"defaultPortfolioCurrency": "CNY", "expectedVersion": 3}
        )
        self.assertEqual(len(effective_fx_pairs(suppressed, back)), 2)
        usd = next_currency_snapshot(
            back, {"defaultPortfolioCurrency": "USD", "expectedVersion": 4}
        )
        self.assertEqual(len(effective_fx_pairs(suppressed, usd)), 1)
        for bad_pairs in [[pairs[0], pairs[0]], [{"base": "USD", "quote": "USD"}], pairs * 7]:
            with self.assertRaises(ValuationError):
                next_fx_preferences_snapshot(
                    saved,
                    {
                        "preferences": {"pairs": bad_pairs, "suppressedDefault": None},
                        "expectedVersion": 1,
                    },
                )
        self.assertEqual(saved["version"], 1)

    def test_schema_copies_dates_and_limits_do_not_mutate_the_packaged_validator(self):
        changed = load_valuation_schema("Currency")
        changed["$defs"]["Currency"]["enum"].append("BAD")
        with self.assertRaises(ValuationError):
            validate_valuation_schema("Currency", "BAD")
        huge = facts()
        huge["data"]["excludedAssets"] = [
            {"brokerAssetId": "x" * 180, "reason": "y" * 64} for _ in range(1000)
        ]
        with self.assertRaisesRegex(ValuationError, "payload_too_large"):
            validate_holdings_facts(huge)
        for value in [float("nan"), {}, [], None]:
            with self.assertRaises(ValuationError):
                validate_valuation_schema("Currency", value)


class IntlRoundingReferenceTests(unittest.TestCase):
    def test_currency_minor_units_and_half_even_match_independent_native_intl(self):
        currencies = load_valuation_schema("Currency")["$defs"]["Currency"]["enum"]
        values = ["1.005", "1.015", "2.5", "3.5", "-0.005", "9007199254740993.000000000001"]
        rows = json.loads(
            subprocess.check_output(
                ["node", str(Path(__file__).parent / "interop" / "valuation_intl.mjs")],
                input=json.dumps({"currencies": currencies, "values": values}),
                text=True,
                timeout=20,
            )
        )
        for row in rows:
            with self.subTest(currency=row["currency"], value=row["value"]):
                self.assertEqual(row["digits"], 0 if row["currency"] == "JPY" else 2)
                self.assertEqual(
                    round_display_amount(row["value"], row["currency"]), row["rounded"]
                )
