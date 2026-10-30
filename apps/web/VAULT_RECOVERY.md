# Passkey replacement and independent recovery

The Web client consumes the existing Hub-owned `folioview.vault-lifecycle.v1` API through five
explicit, bounded owner BFF routes. Google login establishes the owner. Root signatures approve
archive changes. The service receives public bindings, signatures and ciphertext only.

## User flows

Settings → encrypted library offers three separate operations:

- Verify that the current Passkey still opens the existing library.
- Create and confirm a new Passkey, then replace the encrypted key archive. The original root,
  recovery and eligible local device keys are retained. The library locks after success; the user
  unlocks using the new Passkey. Credentials in a password manager are never deleted automatically.
- Export an independent encrypted recovery file and a separate random recovery code. Store them
  separately. While locked, the same Google owner can import both, create and confirm a new
  Passkey, and approve the exact archive replacement. A new device needs explicit registration
  before writing; recovery does not revive revoked devices or agent grants.

Replacement uses a fresh opaque WebAuthn user handle to avoid overwriting the old discoverable
credential before the encrypted archive is saved. A second assertion against the exact new
credential verifies its PRF before a signed change is prepared. Browser PRF buffers are cleared
and secrets are transferred to the existing isolated Worker.

Private JWKs stay in the Worker. Recovery files use AES-GCM with a random 256-bit recovery code,
not a user-chosen password. Public owner/vault/root bindings and saved registry/lifecycle pins
are authenticated as associated data. Neither the code nor plaintext key material is sent to
the BFF, stored in IndexedDB or put in logs. The code is transient user-visible export material;
locking, logout and account changes remove it from the UI and terminate private sessions.
JavaScript strings cannot promise physical erasure from browser memory.

## Durable operations and local state

Before sending any archive mutation, retain the exact signed request and encrypted candidate in
IndexedDB. A routine replacement retains a candidate sealed under both old and new PRF material;
independent recovery can use only the new PRF. If the browser reloads while the server still has
the old archive, the unfinished-update action verifies the candidate's root signature before
requesting the new Passkey. Retries reuse the original operation, ciphertext and authorization.

Read the original receipt and the current signed lifecycle history before promoting a candidate.
A receipt for an earlier operation never authorizes reinstalling its archive over a later one.
Pin the complete signed-input fingerprint prefix and archive boundary, so authorization-only
forks and deletion of known history fail closed. Ordinary vault acceptance remains archive-strict.

The current device's encrypted key seal is rewrapped while preserving its identifiers. Unresolved
PRF-encrypted device operations, agent operations and task drafts block a new replacement; finish
or explicitly discard them using their existing workflows first. They are never silently deleted.
An atomic IndexedDB fence prevents other tabs from creating private records during a transition;
the persisted archive binding rejects writes from sessions using the previous Passkey afterward.
Public ciphertext outboxes do not need PRF rewrapping.

## Limits

Changing a Passkey does not change the root or re-encrypt all historical resources. Anyone who
already retained an old archive and its working Passkey, or an independent recovery file and
code, may still possess the same root. Root renewal, historical-data rekey and cryptographic
revocation of exported recovery material need separate contracts and are not represented as done.

Recovery requires an existing independent root-capable copy. Google login, an administrator or
an authorization identifier cannot recreate a lost private root. Recovery files do not back up
local task drafts or pending agent/device operations. Their pins establish a minimum known state;
a new device cannot detect every complete backend rollback after that saved point.

The producer retains at most 32 lifecycle operations and recovery approval lasts at most five
minutes. Unknown outcomes retain the original request. Expiry alone is not a safe reason to erase
an unresolved operation or generate a replacement request. Explicit cancellation first revokes
the matching approval, or signs an authorization/revocation witness pair that advances the
server's lifecycle without changing the archive. Only a verified higher-version history that
excludes the original operation permits deleting its local candidate. Cancellation requests are
retained before HTTP as well. Capacity is reserved before starting a new change; an exhausted
history or bounded cancellation-attempt budget fails closed and preserves the encrypted packet.

The opaque replacement handle follows the authenticator's discoverable-credential mapping in
the [WebAuthn specification](https://www.w3.org/TR/webauthn-3/).

This delivery uses synthetic resources and simulated authenticator material. Native platform
Passkey compatibility and production recovery acceptance remain separate evidence. No Hub,
Portfolio, IAM, cloud configuration or cloud resource is changed by this Web-only delivery.
