# Holdings facts, valuation and display preferences

The opt-in `folioview_shared.valuation` module packages closed schemas and pure validation,
Decimal arithmetic and preference composition. It registers no routes, opens no database,
fetches no market data and changes no existing consumer. Installations include
`valuation_schemas.json`; `load_valuation_schema(name)` returns a detached Draft2020-12 document.
Use the semantic validators, not schema acceptance alone, for cross-field relationships.

## Compatible private holdings facts

`HoldingsFactsContent` keeps the existing resource-content envelope fields (`state`, `coverage`,
`sourceAsOf`, `fetchedAt`, `freshness`, `data`), with the distinct nested profile
`folioview.holdings-facts.v2`. Data contains a snapshot ID, `editKind` (`import`, `manual`, `edit`),
nullable report date, original import/previous snapshot references, accounts, cash and exclusions.
A reference is `{snapshotId, sourceRevision}` within the same independently verified source.
An import refers to itself; an edit refers to an earlier snapshot, retaining its import reference.
Manual sources have no fabricated import reference. Every edit is a new source revision; valuation
never writes a source revision. Existing snapshots and imported values remain historical facts.

Each position retains a stable asset ID, nullable original broker asset ID/name, type, instrument
(`symbol`, MIC `market`, native `currency`), decimal-string quantity, nullable unit cost, native
book cost and CAD book cost. Unknown identities use a null symbol or `UNKNOWN` market; they are
unresolved, never automatically matched to a US security. Other syntactically valid four-character
MIC values are retained even when the current provider cannot support them; syntax is not market
registry verification or provider coverage. Manual entry can select canonical market
identity through ticker search while presenting ticker, unit cost, quantity and currency.

Each of the instrument, quantity and three cost fields has explicit provenance: `origin`
(`import`, `manual`, `derived`, `legacy`, `unknown`), `recordedAt`, `sourceDate`, `lastEditedAt`.
Unknown cost remains null. Manual edits carry their actual edit time; unknown provenance has no
invented times. Unit/native book-cost currency must match the instrument; CAD book cost is CAD.
Nullable `reportedValues` separately retains imported unit price, market value and unrealized
return (including their reported currencies and signed amounts). These remain historical import
values tied to `importSnapshot`, never live valuation inputs. Manual-only positions have none.
Reported book costs are independent source facts, not tax costs or reverse calculations from
market value. A derived unit cost must be labeled derived; keep its original book value rather
than replacing it with a rounded reconstruction. Current edits do not erase the original import.

`validate_holdings_facts(..., snapshot_id=..., revision=...)` checks identity, unique accounts/
positions/cash currencies, source-history ordering, cost units, provenance times and the existing
196608-byte private budget (at most20 accounts/1000 positions, also subject to bytes).
`validate_holdings_private(value, context=..., persistent=...)` is an explicit reader for this new
nested format, binding it to the caller's already verified P1/persistent context. P1 container
version2 and persistent container version1 remain unchanged. The original frozen schemas and
old private validators remain strict and keep reading old payloads; they do not silently become
supersets. Signature, decryption and current resource authorization must precede these checks.
Deploy compatible Hub/trusted-client readers before enabling any new Web writer. This foundation
performs no migration and enables no new writer or Agent access.

## Public bounded snapshots

Requests contain only public identities: `QuoteRequest.instruments` (1–50) or `FxRequest.pairs`
(1–20). No quantities, costs, financial account IDs or private source IDs are accepted. Duplicate
request identities are removed in first-occurrence order; response identities must be unique and
can be checked against the exact requested set. A ticker query can itself reveal an interest in
that security; this boundary does not conceal every holding member.

`QuoteBatch` and `FxBatch` use `contractVersion=folioview.valuation.v1`, a distinct profile and
snapshot ID, fetch time and bounded items. Each item has explicit `available`, `stale`, `missing`
or `unsupported` status, source, actual `sourceAsOf` or daily `sourceDate`, fetch time and fixed
nullable reason. Valid values are positive bounded decimal strings, not JSON numbers or scientific
notation. Missing/unsupported values are null, never zero. Quote identity includes MIC and actual
native currency; mismatch is not an implicit currency conversion. Price availability requires a
known observation time. No provider access or redistribution license follows from schema validity.

FX means **1 base = rate quote**. For Bank of Canada daily reference rates, each leg is one foreign
unit in CAD. Direct/inverse/cross routes are explicit; a cross is CAD-per-base / CAD-per-quote.
Nonidentity legs and all available items in one FX snapshot must have the same observation date.
Same-currency identity is1 with no fabricated provider observation. `cross_rate` uses Decimal,
half-even to18 decimal places; an invalid, nonpositive or out-of-range result is unavailable.
A date-only observation does not invent an intraday timestamp. Daily reference data is not a
real-time or executable trading rate. See the Bank's [publication methodology](https://www.bankofcanada.ca/rates/exchange/background-information-on-foreign-exchange-rates/),
[API caching guidance](https://www.bankofcanada.ca/valet-api-how-to/) and [reuse terms](https://www.bankofcanada.ca/terms/).
Provider/caching/budget decisions belong in the Market consumer; no paid feed or cloud resource is
provisioned here. Existing Yahoo personal-mode access is not a public redistribution license;
[provider terms/coverage](https://help.yahoo.com/kb/finance-for-web/SLN2310.html?locale=en_CA) must be considered separately.

`value_holdings` is a reference **trusted-client** calculation, not an endpoint accepting holdings.
Use one holdings snapshot, one quote batch and one FX batch. Multiply quantity × native price ×
FX with120-digit Decimal precision, sum before presentation rounding, and exclude cash from the
position subtotal. Missing rows have null value and an explicit reason. Coverage, weights and
pie/bar inputs use the same valued subset; a zero subtotal has no meaningful weights. Empty holdings and zero-share rows
need no fabricated quote/FX observation; an empty response batch is valid only for an empty
expected set. Requests themselves remain nonempty. Stale
values remain visibly stale. `round_display_amount` rounds only at presentation (half-even; JPY
zero minor units, other supported currencies two). Stock quote pages remain native.
`display_currencies` returns the account default first, then only this source's position currencies,
deduplicated. CNY default with USD/CAD positions produces CNY/USD/CAD; other sources and FX follows
do not add choices. Callers reset a temporary choice when it is no longer in that set.

## Independent preferences and FX follows

Strict v1 UI preferences retain exactly `theme`, `language`, `defaultChartRange`; no new field is
added to old read/write bodies. Currency uses the separate `folioview.currency-preferences.v2`
namespace with `{defaultPortfolioCurrency}`, CAS `version` and `currencyGeneration`. Absence has
null preferences/version0/generation0. Every accepted save advances CAS, including identical
values, so late requests cannot commit across a confirmed save. Only an actual currency change
advances the semantic generation. An old v1 PUT must never replace the currency namespace.

`resolve_preferences` fills absent namespaces with USD/en/light/1m, preserving every saved explicit
v1 value. A malformed saved response is an error, not a new-user default and never a reason to
write a replacement. Currency affects holdings valuation/charts, not native quotes, imported
facts or historical reports. Each consumer persists under the server-verified Owner partition.

`folioview.fx-preferences.v1` stores an ordered, deduplicated manual list (at most12 nonidentity
pairs) and optional `{currency,currencyGeneration}` default suppression. Whole-list CAS failure
keeps the previous document. Following means in-app display, not a notification subscription.
`effective_fx_pairs` adds USD/default only when nonUSD and unsuppressed. Manual pairs win duplicate
identity and persist when the default changes. Dismissal survives devices and identical currency
saves; a genuinely changed default has a new generation. If Config is unavailable, no stored
manual list is erased or rewritten. Readers keep the last verified preference for stale display.
Config never writes User. Client-supplied display composition is not an authorization credential.
