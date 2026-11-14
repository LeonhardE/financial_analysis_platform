# Consistent source reads

User retains its existing API responses and owner-keyed resource namespaces.
Independent content/version records now use one bounded BatchGet inside the same
Firestore transaction:

| Operation                                             | Documents in one batch |
| ----------------------------------------------------- | ---------------------- |
| One/two source metadata kinds                         | 2/4                    |
| Explicit initialization and original receipt recovery | 3                      |
| Channel follows read/replace                          | 2                      |
| Watchlist mutation                                    | 2                      |

Direct watchlist and FX reads remain single-document reads. No Market call is
introduced into list/metadata reads; only validation of a genuinely new stock
symbol uses the existing bounded Market boundary.

Results are matched by exact absolute document name, independently of response
order. Missing, duplicate, foreign or interrupted responses fail instead of being
interpreted as absent content. Found rows still pass the original content/version,
identity, digest, source epoch and initialization-receipt validators. A complete
confirmed missing document retains its existing uninitialized meaning.

Every conflict retry and subsequent request reads current rows again. No User
permission or document cache is added, and no-op/replay writes retain their old
behavior. SDK calls keep four-second bounds, no SDK retry chain, and the existing
two-attempt transaction lifecycle. Real SDK synthetic tests verify batches and
peer-update conflict recovery without cloud requests; production latency requires
a later authorized end-to-end measurement.

[Service entry](../README.md)
