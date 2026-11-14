# Account FX follows

`GET/PUT /api/v1/fx-follows` stores the authenticated Owner's display preferences for currency
pairs. A follow means showing a rate in the market UI; it does not create an email, push,
scheduler, Agent grant or new resource kind. No Config or Market request occurs in this handler.
Existing Google identity checks and private/no-store response headers are retained.

A GET returns the FND-013 `folioview.fx-preferences.v1` snapshot with `contractVersion`, `profile`,
nullable `preferences` and `version`. Absence is `preferences:null, version:0` without any write.
A PUT uses this shape:

```json
{
  "expectedVersion": 0,
  "preferences": { "pairs": [{ "base": "CAD", "quote": "USD" }], "suppressedDefault": null }
}
```

Manual pairs are ordered, unique, nonidentity pairs from the supported contract currency set,
with at most12 entries. They are stored without fetching rates or guessing a quote. An explicit
empty preference is a saved value, distinct from absence. Each accepted CAS save advances the
version, including identical values, so an older timed-out save cannot overwrite a newer fence.
Conflicts return409; corrupt state or unavailable storage returns private503. Unknown outcomes
are checked with a fresh read before another edit; reads do not prove which request committed.

## Default composition

The shared `effective_fx_pairs` reader combines this snapshot with the independently loaded
Config currency snapshot. There are no automatic cross-service writes:

- Non-USD defaults add `USD/defaultCurrency`, displayed as one USD in that currency. USD adds
  no automatic entry. Defaults never remove manually followed pairs or reorder manual entries.
- A manual pair matching the automatic one wins the duplicate and remains manual when the
  default changes. The reader adds only the current default's automatic entry.
- Dismissing the default pair stores `suppressedDefault:{currency,currencyGeneration}`. It
  persists across devices and unchanged-currency saves, whose Config generation stays stable.
  A changed default selection has a new semantic generation and can introduce its new pair.
- If Config is unavailable, manual pairs remain available; a client retains its last verified
  context rather than saving a fallback or erasing the list. A loading/failure response is not
  an empty preference. The ordered Web consumer implements this read composition separately.

The supported currency codes are USD, CAD, CNY, EUR, GBP, JPY, HKD, AUD, CHF, NZD, SGD and TWD.
The market producer can still explicitly report a missing/stale rate for a followed pair.

## Existing storage

The `fx.v1:<owner hash>` key reuses the existing `user_watchlists` collection/table and client.
The original stock-watchlist key, writer and separate resource-version record are untouched.
FX saves do not initialize or advance stock/channel resource versions and cannot become an Agent
projection. Old stock writers cannot erase FX preferences. These preferences remain in User's
existing plaintext account domain, with verified-identity isolation and no private response cache.

SQLite uses the existing immediate transaction. Firestore reads inside the existing bounded
transaction with four-second RPC/lifecycle timeouts and at most two attempts. PUT JSON is bounded
to4KiB and a five-second body read, uses strict duplicate-member parsing, and validates the closed
FND-013 update before storage writes. No migration, database, IAM, dependency, capacity or cloud
resource is added. An explicit future user save is the only operation creating a preference.

## Verification

Offline tests cover HTTP/auth/private headers, Owner isolation, fixed body limits, exact ordered
manual follows, semantic default suppression, concurrent CAS, unknown outcomes, corrupt state,
Firestore transaction seams and unchanged stock-watchlist/resource metadata. No production
preference, real feed or native-host acceptance is performed.
