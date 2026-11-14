"""Regenerate public synthetic parity vectors from the independent Python implementation."""

import copy
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path[:0] = [str(ROOT / "services/common"), str(ROOT / "services/common/tests")]
from test_valuation_contracts import batch, facts, fx, position, quote  # noqa: E402
from folioview_shared.valuation import (  # noqa: E402
    cross_rate,
    round_display_amount,
    value_holdings,
)

holdings = facts()
quotes = batch("quote", [quote()])
rates = batch("fx", [fx()])
cases = []
for name, h, q, f, currency in [
    ("reference", holdings, quotes, rates, "CNY"),
    ("missing_quote", holdings, batch("quote", []), rates, "CNY"),
    ("missing_fx", holdings, quotes, batch("fx", []), "CNY"),
    ("native_currency", holdings, quotes, rates, "USD"),
]:
    cases.append(
        dict(
            name=name,
            holdings=h,
            quotes=q,
            fx=f,
            currency=currency,
            expected=value_holdings(h, q, f, currency),
        )
    )
h = copy.deepcopy(holdings)
h["data"]["accounts"][0]["positions"] += [
    position("asset_2", "USD", "0.000000000001"),
    position("asset_3", "CAD", "0"),
]
q = batch("quote", [quote(price="0.123456789012345678")])
q["items"][0]["status"] = "stale"
cases.append(
    dict(
        name="precision_stale_zero",
        holdings=h,
        quotes=q,
        fx=rates,
        currency="CNY",
        expected=value_holdings(h, q, rates, "CNY"),
    )
)
h = copy.deepcopy(holdings)
h["data"]["accounts"][0]["positions"][0]["instrument"]["market"] = "UNKNOWN"
cases.append(
    dict(
        name="unresolved",
        holdings=h,
        quotes=quotes,
        fx=rates,
        currency="CNY",
        expected=value_holdings(h, quotes, rates, "CNY"),
    )
)
h = copy.deepcopy(holdings)
h["data"]["accounts"][0]["positions"] = []
cases.append(
    dict(
        name="empty",
        holdings=h,
        quotes=quotes,
        fx=rates,
        currency="CNY",
        expected=value_holdings(h, quotes, rates, "CNY"),
    )
)
h = copy.deepcopy(holdings)
h["data"]["accounts"][0]["positions"][0]["quantity"] = "99999999999999999999.999999999999"
q = batch("quote", [quote(price="99999999999999999999.999999999999999999")])
cases.append(
    dict(
        name="large_exact",
        holdings=h,
        quotes=q,
        fx=rates,
        currency="CNY",
        expected=value_holdings(h, q, rates, "CNY"),
    )
)
crosses = [
    [a, b, cross_rate(a, b)]
    for a, b in [
        ("1.4", "0.2"),
        ("1", "3"),
        ("1", "6"),
        ("0.000000000000000001", "2"),
        ("0.000000000000000003", "2"),
    ]
    if a != "0.000000000000000001"
]
rounds = [
    [amount, code, round_display_amount(amount, code)]
    for amount, code in [
        ("1.005", "USD"),
        ("1.015", "USD"),
        ("-0.005", "CAD"),
        ("2.5", "JPY"),
        ("3.5", "JPY"),
        ("999999999999999999999999.999", "CNY"),
    ]
]
(HERE / "reference-vectors.json").write_text(
    json.dumps(dict(cases=cases, crosses=crosses, rounds=rounds), indent=2) + "\n"
)
