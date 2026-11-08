# Persistent owner Worker operations

The persistent owner operations compose the shared browser contracts inside `VaultCore`. They use
the existing ordinary owner session and nonextractable Root/device/recovery handles. They expose no
generic signing, key import, key export or caller-selected network operation. The current UI and
backend feature gates remain unchanged until subsequent consumer work.

Each request independently selects a connection and client. Enrollment checks the actual nonce-bound
key offer; registration does not grant content access. Continuing resource approval remains explicit,
and publication derives its content from a verified saved task or owner resource. Task reassignment
requires an explicit review flag. Historical report reads pin the requested result ID, the owner's
Root chain and the original signed Run bindings; later permission withdrawal does not erase history.

`EncryptedVaultSession` reuses the ordinary Worker and stores one unresolved operation per
connection. A caller must load and recover an existing operation before preparing another. The
original packet is sealed with the owner's wrapping key before transport, and a concurrent insert
loser cannot replace it. Read-only lists expose public locators only. Receipt verification precedes
compare-and-delete. Key renewal and archive changes retain the same atomic pending-operation fence.

Publication callers should first read the operation receipt and submit the original packet only
when no receipt exists. A receipt read includes its original encrypted envelope. For the same logical
publication, the Worker independently checks its Root proof, payload digest, business bindings and
issuance directory, allowing an already committed publication to be recognized after local retry
state has been cleared. Producer idempotency and immutable ciphertext are unchanged.

The checked Web build includes `packages/encrypted-workspace`, and the shared integrity manifest is
part of owner Worker compatibility. The ordinary server receives no decrypted content or owner key.

## Closed owner transport

The Web BFF admits only the named persistent identity/consent/publication/setup,
connection history/revocation, plan history and encrypted Inbox endpoints. Bodies
and responses use closed structural DTOs from the shared contract; Root and Agent
signatures remain Worker checks. Persistent Inbox cursors use their producer's
opaque page ID plus bounded offset, independently of legacy Inbox pagination.

Native account OAuth approval is deliberately absent from the BFF. A branded,
source/origin/request/nonce-bound MessageChannel to the original Hub window permits
only `pending` and `approve` with a vault locator. It severs the opener before a
transient Google credential is sent, preserves AuthProvider session-generation
checks, and never returns an OAuth code, token, callback URL or financial grant to
the Web consumer or model. This transport prerequisite does not enable feature
gates or grant any real account access.

## Persistent workspace consumer

The workspace owns one persistent orchestration hook alongside its existing shared
vault session. It never creates another vault session or automatically asks for a
Passkey. Native account linking and one-time runtime enrollment lead to an explicit
review of selected tasks and their logical resource inputs. Continuing permission
includes future versions of those same resources; changing source incarnation,
epoch or task inputs requires review. Task reassignment is a separate explicit
choice. Connection IDs and key fingerprints live in expandable details.

When the signed-in page is visible and unlocked, reconciliation checks current
Root consent and task assignment, encrypts current approved resource versions and
updates already-assigned task authority. It neither grants another resource nor
assigns a new task automatically. Manual-resource operation IDs exclude retrieval
timestamps, so an unchanged version recovers its original ciphertext receipt
instead of creating a fresh publication each poll. New versions can only be
published while owner keys are available; native execution can continue with
already synchronized, approved versions after sign-out.

One pending operation per connection is restored before any new mutation. Registry
registration distinguishes an already-applied directory from a conflicting one;
identity, consent and publication recovery read original receipts before sending
original bytes. Account change, lock and visibility changes fence in-flight work
and immediately mask private views. No recovery path silently replaces keys or
approves resources.

Persistent reports share the Inbox route with expandable foreground report history.
The existing Worker verifies historical Root/Agent issuance, frozen Run and receipt
before decrypting; state changes use a separate closed device-signed operation.
Unknown state updates retain their exact pending command while the view remains
open. Report sources use the existing safe Markdown/link renderer.

Requested schedules, independently verified Agent statements and Hub run/result
observations have separate labels. A report receipt never claims Muse installed a
native schedule. All activation flags remain off pending owner-approved real Muse,
restart and cross-day acceptance.
