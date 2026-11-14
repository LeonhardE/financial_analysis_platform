"""Opt-in holdings facts, public valuation and independent preference contracts.

Pure validation/arithmetic only: no provider, storage, authentication or decryption.
Frozen encrypted schemas and existing consumers are deliberately unchanged.
"""

import copy
import json
import re
from datetime import date, datetime
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation, localcontext
from functools import lru_cache
from importlib.resources import files
from types import MappingProxyType

from jsonschema import Draft202012Validator, FormatChecker

from .encrypted.constants import MAX_READ_BYTES, PRIVATE_BYTE_LIMITS
from .encrypted.jsonutil import canonical_json

VALUATION_CONTRACT = "folioview.valuation.v1"
HOLDINGS_FACTS_PROFILE = "folioview.holdings-facts.v2"
CURRENCY_PROFILE = "folioview.currency-preferences.v2"
FX_PREFERENCES_PROFILE = "folioview.fx-preferences.v1"
MAX_REVISION = 9_007_199_254_740_991
MAX_FACTS_BYTES = PRIVATE_BYTE_LIMITS["holdings_snapshot"]
DEFAULT_PREFERENCES = MappingProxyType(
    {
        "defaultPortfolioCurrency": "USD",
        "language": "en",
        "theme": "light",
        "defaultChartRange": "1m",
    }
)
_FORMATS = FormatChecker()
_DECIMAL = re.compile(r"^(0|[1-9][0-9]{0,19})(\.[0-9]{1,18})?$")


class ValuationError(ValueError):
    """Fixed diagnostics; consumers choose their own HTTP framing."""

    def __init__(self, code="invalid_input"):
        self.code = (
            code
            if code in {"invalid_input", "version_conflict", "payload_too_large"}
            else "invalid_input"
        )
        super().__init__(self.code)


def _need(condition):
    if not condition:
        raise ValuationError


@_FORMATS.checks("date-time")
def _timestamp(value):
    if not isinstance(value, str):
        return True
    try:
        return (
            value.endswith("Z") and datetime.fromisoformat(value).utcoffset().total_seconds() == 0
        )
    except (ValueError, AttributeError):
        return False


@_FORMATS.checks("date")
def _date(value):
    if not isinstance(value, str):
        return True
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


@lru_cache(maxsize=1)
def _document():
    value = json.loads(files(__package__).joinpath("valuation_schemas.json").read_text())
    Draft202012Validator.check_schema(value)
    return value


def load_valuation_schema(name):
    _need(isinstance(name, str) and name in _document()["$defs"])
    result = copy.deepcopy(_document())
    result["$ref"] = "#/$defs/" + name
    return result


@lru_cache(maxsize=64)
def _validator(name):
    return Draft202012Validator(load_valuation_schema(name), format_checker=_FORMATS)


def validate_valuation_schema(name, value):
    try:
        if len(canonical_json(value)) > (
            MAX_FACTS_BYTES if name == "HoldingsFactsContent" else MAX_READ_BYTES
        ):
            raise ValuationError("payload_too_large")
        _need(next(_validator(name).iter_errors(value), None) is None)
        return copy.deepcopy(value)
    except ValuationError:
        raise
    except (ValueError, TypeError, KeyError, RecursionError):
        raise ValuationError from None


def _unique(values):
    _need(len(values) == len(set(values)))


def _instrument(value):
    return value["symbol"], value["market"], value["currency"]


def _pair(value):
    return value["base"], value["quote"]


def quote_request(value):
    result = validate_valuation_schema("QuoteRequest", value)
    result["instruments"] = list({_instrument(i): i for i in result["instruments"]}.values())
    return result


def fx_request(value):
    result = validate_valuation_schema("FxRequest", value)
    result["pairs"] = list({_pair(i): i for i in result["pairs"]}.values())
    return result


def _decimal(value, *, positive=False):
    _need(type(value) is str and bool(_DECIMAL.fullmatch(value)))
    number = Decimal(value)
    _need(not positive or number > 0)
    return number


def _plain(value):
    text = format(value, "f")
    return (text.rstrip("0").rstrip(".") if "." in text else text) if value else "0"


def cross_rate(cad_per_base, cad_per_quote):
    """One base unit in quote units, half-even to at most18 decimals; never a float."""
    a, b = _decimal(cad_per_base, positive=True), _decimal(cad_per_quote, positive=True)
    try:
        with localcontext() as context:
            context.prec = 120
            result = _plain((a / b).quantize(Decimal("1e-18"), rounding=ROUND_HALF_EVEN))
        _decimal(result, positive=True)
        return result
    except InvalidOperation:
        raise ValuationError from None


def validate_holdings_facts(value, *, snapshot_id=None, revision=None):
    result = validate_valuation_schema("HoldingsFactsContent", value)
    if revision is not None:
        _need(type(revision) is int and 1 <= revision <= MAX_REVISION)
    data = result["data"]
    if snapshot_id is not None:
        _need(data["snapshotId"] == snapshot_id)
    _unique([a["accountId"] for a in data["accounts"]])
    _need(sum(len(a["positions"]) for a in data["accounts"]) <= 1000)
    at = result["fetchedAt"]
    _need(result["sourceAsOf"] is None or _time(result["sourceAsOf"]) <= _time(at))
    _need(data["reportDate"] is None or data["reportDate"] <= at[:10])
    for previous, original in [(data["previousSnapshot"], False), (data["importSnapshot"], True)]:
        if previous is None:
            continue
        if revision is not None:
            _need(type(revision) is int and 1 <= revision <= MAX_REVISION)
            _need(
                previous["sourceRevision"] <= revision
                if original
                else previous["sourceRevision"] < revision
            )
            _need(
                (previous["sourceRevision"] == revision)
                == (previous["snapshotId"] == data["snapshotId"])
                if original
                else previous["snapshotId"] != data["snapshotId"]
            )
    if data["editKind"] == "import":
        _need(data["importSnapshot"] is not None)
        if revision is not None:
            _need(
                data["importSnapshot"]
                == {"snapshotId": data["snapshotId"], "sourceRevision": revision}
            )
    if data["editKind"] == "manual":
        _need(data["importSnapshot"] is None)
    if data["editKind"] == "edit":
        _need(data["previousSnapshot"] is not None)
    for account in data["accounts"]:
        _unique([b["currency"] for b in account["balances"]])
        _unique([p["assetId"] for p in account["positions"]])
        for position in account["positions"]:
            native = position["instrument"]["currency"]
            _need(data["importSnapshot"] is not None or position["reportedValues"] is None)
            for field in ("unitCost", "bookCost", "bookCostCad"):
                money = position[field]
                _need(
                    money is None
                    or money["currency"] == ("CAD" if field == "bookCostCad" else native)
                )
            for field, provenance in position["provenance"].items():
                recorded, edited = provenance["recordedAt"], provenance["lastEditedAt"]
                _need(recorded is None or _time(recorded) <= _time(at))
                _need(edited is None or (recorded is not None and _time(edited) <= _time(recorded)))
                _need(provenance["sourceDate"] is None or provenance["sourceDate"] <= at[:10])
                if provenance["origin"] == "manual":
                    _need(recorded is not None and edited == recorded)
                if provenance["origin"] == "unknown":
                    _need(recorded is None and edited is None and provenance["sourceDate"] is None)
                if field in {"unitCost", "bookCost", "bookCostCad"} and position[field] is not None:
                    _need(provenance["origin"] != "unknown")
    return result


def validate_holdings_private(value, *, context, persistent=False):
    """Explicit v2-facts reader only; caller first verifies encryption and trusted context.

    Container wire versions remain frozen. Nested data.profile selects the new facts
    format. Old private validators continue rejecting it until consumers opt in.
    """
    try:
        if len(canonical_json(value)) > MAX_FACTS_BYTES:
            raise ValuationError("payload_too_large")
        if persistent:
            from .encrypted.persistent_content import validate_content_context

            context = validate_content_context(context)
            keys = {
                "privateSchemaVersion",
                "profile",
                "objectId",
                "objectType",
                "revision",
                "payload",
            }
            _need(type(value) is dict and set(value) == keys)
            _need(value["privateSchemaVersion"] == 1 and type(value["privateSchemaVersion"]) is int)
            _need(value["profile"] == "folioview.persistent-content.v1")
            reference = context["ref"]
        else:
            from .encrypted.schema import validate_schema

            context = validate_schema("Context", context)
            keys = {
                "privateSchemaVersion",
                "objectId",
                "objectType",
                "revision",
                "binding",
                "payload",
            }
            _need(type(value) is dict and set(value) == keys)
            _need(value["privateSchemaVersion"] == 2 and type(value["privateSchemaVersion"]) is int)
            _need(value["binding"] == context["binding"])
            reference = context["binding"]["resourceRef"]
        _need(context["objectType"] == value["objectType"] == "holdings_snapshot")
        _need(reference["kind"] == "holdings" and reference["sourceService"] == "portfolio")
        _need(
            value["objectId"] == context["objectId"]
            and type(value["revision"]) is int
            and value["revision"] == context["revision"]
        )
        validate_holdings_facts(
            value["payload"], snapshot_id=value["objectId"], revision=value["revision"]
        )
        return copy.deepcopy(value)
    except ValuationError:
        raise
    except (TypeError, KeyError, ValueError):
        raise ValuationError from None


def _time(value):
    return datetime.fromisoformat(value)


def _item_time(item, batch):
    _need(_time(item["fetchedAt"]) <= _time(batch["fetchedAt"]))
    _need(item["sourceAsOf"] is None or _time(item["sourceAsOf"]) <= _time(item["fetchedAt"]))
    _need(item["sourceDate"] is None or item["sourceDate"] <= item["fetchedAt"][:10])


def validate_quote_batch(value, *, requested=None):
    result = validate_valuation_schema("QuoteBatch", value)
    _unique([_instrument(i["instrument"]) for i in result["items"]])
    if requested is not None:
        _need(
            {_instrument(i["instrument"]) for i in result["items"]}
            == {_instrument(i) for i in quote_request({"instruments": requested})["instruments"]}
        )
    for item in result["items"]:
        _item_time(item, result)
        if item["status"] in {"available", "stale"}:
            _decimal(item["price"], positive=True)
            _need(
                item["source"] == "yahoo_finance"
                and item["sourceAsOf"] is not None
                and item["reason"] is None
            )
            _need(item["instrument"]["market"] != "UNKNOWN")
        else:
            _need(item["price"] is None and item["reason"] is not None)
    return result


def validate_fx_batch(value, *, requested=None):
    result = validate_valuation_schema("FxBatch", value)
    _unique([_pair(i) for i in result["items"]])
    if requested is not None:
        _need(
            {_pair(i) for i in result["items"]}
            == {_pair(i) for i in fx_request({"pairs": requested})["pairs"]}
        )
    dates = set()
    for item in result["items"]:
        _item_time(item, result)
        if item["status"] not in {"available", "stale"}:
            _need(item["rate"] is None and item["route"] is None and item["reason"] is not None)
            continue
        rate = _decimal(item["rate"], positive=True)
        route = item["route"]
        _need(route is not None and item["reason"] is None)
        base, quote = _pair(item)
        if base == quote:
            _need(rate == 1 and item["source"] == "identity" and item["status"] == "available")
            _need(route == {"kind": "identity", "via": None, "legs": []})
            _need(item["sourceDate"] is None and item["sourceAsOf"] is None)
            continue
        _need(item["source"] == "bank_of_canada" and item["sourceDate"] is not None)
        dates.add(item["sourceDate"])
        legs = route["legs"]
        for leg in legs:
            _decimal(leg["rate"], positive=True)
            _need(
                leg["sourceDate"] == item["sourceDate"]
                and leg["quote"] == "CAD"
                and leg["base"] != "CAD"
            )
        if quote == "CAD":
            _need(
                route["kind"] == "direct"
                and route["via"] is None
                and len(legs) == 1
                and legs[0]["base"] == base
            )
            expected = cross_rate(legs[0]["rate"], "1")
        elif base == "CAD":
            _need(
                route["kind"] == "inverse"
                and route["via"] is None
                and len(legs) == 1
                and legs[0]["base"] == quote
            )
            expected = cross_rate("1", legs[0]["rate"])
        else:
            _need(
                route["kind"] == "cross"
                and route["via"] == "CAD"
                and len(legs) == 2
                and [leg["base"] for leg in legs] == [base, quote]
            )
            expected = cross_rate(legs[0]["rate"], legs[1]["rate"])
        _need(rate == Decimal(expected))
    _need(len(dates) <= 1)
    return result


def _snapshot(value, schema):
    result = validate_valuation_schema(schema, value)
    absent = result["preferences"] is None
    _need((result["version"] == 0) == absent)
    return result


def currency_snapshot(value):
    result = _snapshot(value, "CurrencyPreferencesSnapshot")
    generation = result["currencyGeneration"]
    _need((generation == 0) == (result["preferences"] is None))
    _need(generation <= result["version"])
    return result


def next_currency_snapshot(current, update):
    current = currency_snapshot(current)
    update = validate_valuation_schema("CurrencyPreferencesUpdate", update)
    if update["expectedVersion"] != current["version"]:
        raise ValuationError("version_conflict")
    _need(current["version"] < MAX_REVISION)
    preferences = {"defaultPortfolioCurrency": update["defaultPortfolioCurrency"]}
    changed = current["preferences"] != preferences
    result = {
        **current,
        "preferences": preferences,
        "version": current["version"] + 1,
        "currencyGeneration": current["currencyGeneration"] + int(changed),
    }
    return currency_snapshot(result)


def resolve_preferences(ui, currency):
    """Only absent namespaces receive defaults; malformed saved values are errors."""
    ui = _snapshot(ui, "UiPreferencesSnapshotV1")
    currency = currency_snapshot(currency)
    return {
        **DEFAULT_PREFERENCES,
        **(ui["preferences"] or {}),
        **(currency["preferences"] or {}),
    }


def fx_preferences(value):
    result = validate_valuation_schema("FxPreferences", value)
    pairs = result["pairs"]
    _unique([_pair(p) for p in pairs])
    _need(all(p["base"] != p["quote"] for p in pairs))
    if result["suppressedDefault"] is not None:
        _need(result["suppressedDefault"]["currency"] != "USD")
    return result


def fx_preferences_snapshot(value):
    result = _snapshot(value, "FxPreferencesSnapshot")
    if result["preferences"] is not None:
        fx_preferences(result["preferences"])
    return result


def next_fx_preferences_snapshot(current, update):
    current = fx_preferences_snapshot(current)
    update = validate_valuation_schema("FxPreferencesUpdate", update)
    if update["expectedVersion"] != current["version"]:
        raise ValuationError("version_conflict")
    _need(current["version"] < MAX_REVISION)
    result = {
        **current,
        "preferences": fx_preferences(update["preferences"]),
        "version": current["version"] + 1,
    }
    return fx_preferences_snapshot(result)


def effective_fx_pairs(preferences, currency):
    """Read composition only; no implicit User write or Config-to-User coupling.

    A missing Config response adds no automatic pair; callers retain their last
    verified display preference during a refresh failure, never save a fallback.
    """
    current = fx_preferences_snapshot(preferences)["preferences"] or {
        "pairs": [],
        "suppressedDefault": None,
    }
    manual = [{**p, "origin": "manual"} for p in current["pairs"]]
    if currency is None:
        return manual
    selection = currency_snapshot(currency)
    code = (selection["preferences"] or DEFAULT_PREFERENCES)["defaultPortfolioCurrency"]
    hidden = {"currency": code, "currencyGeneration": selection["currencyGeneration"]}
    if code == "USD" or current["suppressedDefault"] == hidden:
        return manual
    automatic = {"base": "USD", "quote": code, "origin": "default"}
    if any(_pair(p) == _pair(automatic) for p in manual):
        return manual
    return [automatic, *manual]


def display_currencies(holdings, default_currency):
    checked = validate_holdings_facts(holdings)
    validate_valuation_schema("Currency", default_currency)
    result = [default_currency]
    for account in checked["data"]["accounts"]:
        for position in account["positions"]:
            code = position["instrument"]["currency"]
            if code not in result:
                result.append(code)
    return result


def value_holdings(holdings, quotes, fx, display_currency):
    """Reference client arithmetic. Services must not send holdings to Market.

    Sum full-precision values first; cash stays separate. Coverage and weights
    use exactly the same valued set. A zero subtotal has no meaningful weight.
    """
    holdings = validate_holdings_facts(holdings)
    quotes, fx = validate_quote_batch(quotes), validate_fx_batch(fx)
    validate_valuation_schema("Currency", display_currency)
    prices = {_instrument(i["instrument"]): i for i in quotes["items"]}
    rates = {_pair(i): i for i in fx["items"]}
    rows = []
    with localcontext() as context:
        context.prec = 120
        subtotal = Decimal(0)
        for account in holdings["data"]["accounts"]:
            for position in account["positions"]:
                instrument = position["instrument"]
                quote = prices.get(_instrument(instrument))
                rate = rates.get((instrument["currency"], display_currency))
                same = instrument["currency"] == display_currency
                status = (
                    "unresolved"
                    if instrument["market"] == "UNKNOWN"
                    or instrument["symbol"] is None
                    or position["assetType"] == "unsupported"
                    else "missing_quote"
                    if not quote or quote["status"] not in {"available", "stale"}
                    else "missing_fx"
                    if not same and (not rate or rate["status"] not in {"available", "stale"})
                    else "valued"
                )
                value = None
                stale = False
                zero = _decimal(position["quantity"]) == 0
                if zero:
                    status, value = "valued", "0"
                elif status == "valued":
                    amount = (
                        _decimal(position["quantity"])
                        * _decimal(quote["price"], positive=True)
                        * (Decimal(1) if same else _decimal(rate["rate"], positive=True))
                    )
                    subtotal += amount
                    value = _plain(amount)
                    stale = quote["status"] == "stale" or (not same and rate["status"] == "stale")
                rows.append(
                    {
                        "accountId": account["accountId"],
                        "assetId": position["assetId"],
                        "status": status,
                        "value": value,
                        "weightPercent": None,
                        "stale": stale,
                    }
                )
        for row in rows:
            if row["value"] is not None and subtotal:
                row["weightPercent"] = _plain(
                    (Decimal(row["value"]) / subtotal * 100).quantize(
                        Decimal("1e-6"), rounding=ROUND_HALF_EVEN
                    )
                )
        valued = sum(row["value"] is not None for row in rows)
        return {
            "currency": display_currency,
            "subtotal": _plain(subtotal) if valued or not rows else None,
            "complete": valued == len(rows),
            "valuedCount": valued,
            "positionCount": len(rows),
            "stale": any(row["stale"] for row in rows),
            "quoteSnapshotId": quotes["snapshotId"],
            "fxSnapshotId": fx["snapshotId"],
            "rows": rows,
        }


def round_display_amount(value, currency):
    """Presentation only, after summation. JPY has zero minor-unit decimals."""
    validate_valuation_schema("Currency", currency)
    _need(
        type(value) is str
        and len(value) <= 200
        and re.fullmatch(r"-?(0|[1-9][0-9]{0,79})(\.[0-9]{1,60})?", value) is not None
    )
    try:
        with localcontext() as context:
            context.prec = 160
            rounded = Decimal(value).quantize(
                Decimal("1") if currency == "JPY" else Decimal("0.01"),
                rounding=ROUND_HALF_EVEN,
            )
            return format(abs(rounded) if rounded == 0 else rounded, "f")
    except InvalidOperation:
        raise ValuationError from None


def initial_currency_snapshot():
    return {
        "contractVersion": VALUATION_CONTRACT,
        "profile": CURRENCY_PROFILE,
        "preferences": None,
        "version": 0,
        "currencyGeneration": 0,
    }


def initial_fx_preferences_snapshot():
    return {
        "contractVersion": VALUATION_CONTRACT,
        "profile": FX_PREFERENCES_PROFILE,
        "preferences": None,
        "version": 0,
    }
