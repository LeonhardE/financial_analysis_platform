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
