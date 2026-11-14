# Account preferences

Config continues to require the existing server-verified Google identity and private/no-store
responses. Requests cannot choose a different Owner. It does not call User or Market, publish
resource facts, renew credentials, or change portfolio/native quote data.

## Independent contracts

`GET/PUT /api/v1/preferences` keeps its strict three-field preference shape (`theme`, `language`,
`defaultChartRange`) and existing optimistic version fence. Extra fields such as display currency
remain invalid. Existing explicit values, including `system` appearance, are preserved.

`GET/PUT /api/v2/preferences/currency` adds the FND-013 `folioview.currency-preferences.v2` profile.
A read returns `contractVersion`, `profile`, nullable `preferences`, `version` and
`currencyGeneration`. The preference contains only `defaultPortfolioCurrency`. A write is:

```json
{ "defaultPortfolioCurrency": "CNY", "expectedVersion": 0 }
```

Supported currencies match FND-013: USD, CAD, CNY, EUR, GBP, JPY, HKD, AUD, CHF, NZD, SGD and TWD.
Writes retain the existing1KiB/five-second body bound and strict type/extra-field validation.
Each accepted save advances `version`, even for an identical currency, fencing late timed-out
writes. `currencyGeneration` advances only when the actual selected currency changes. Identical
saves and UI preference edits do not recreate the semantic context for a dismissed automatic FX
follow. CAS conflicts return409; storage or malformed saved state returns private503.

An unknown save outcome is resolved by reading the current snapshot, not sending a new candidate
with an old expected version. A read can confirm current values/fence; it does not prove which
request committed. A later edit uses the fresh version. There is no automatic retry with a newer
version or overwrite of a conflicting save.

## Absence and defaults

Absent currency data returns `preferences: null`, `version:0`, `currencyGeneration:0`, with no
write. Absent UI and currency namespaces resolve at read time to USD, English, light appearance
and one month. The [shared resolution contract](../../common/docs/valuation.md) preserves explicitly
saved UI values and resolves the independent currency default. Malformed saved documents are not
new users and are never silently overwritten with defaults. A stored null/zero snapshot is not
accepted as an absent document.

The Web consumer applies these defaults in its own ordered release; this backend producer does
not reset an already open or older client's appearance. Display currency affects portfolio
valuation/allocation only, not native stock quotes, imported facts or historical reports. Config
does not create FX follows: consumers combine this snapshot and the Owner's User preference list
at read time.

## Existing storage and isolation

Currency uses `currency.v2:<owner hash>` inside the existing `user_preferences` collection/table.
The legacy v1 document retains its original key and complete-document writer. Old PUT requests
therefore cannot remove new currency data; the two version fences are independent. Reads do no
migration or default writes. Only an explicit future save creates a currency record. No database,
collection provisioning, IAM, cloud resource, dependency, capacity or production migration is added.

SQLite uses its existing immediate transactions. Firestore reuses the existing client, four-second
SDK/lifecycle bounds and two-attempt transaction policy, always re-reading the current fence inside
the transaction. No private per-user server response cache is introduced.

## Verification

Offline tests cover actual authentication/HTTP/private headers, legacy compatibility, Owner
isolation, semantic generation, identical saves, simultaneous writers, malformed state and unknown
commit recovery. Real user preference changes and UI/latency acceptance remain deferred.
