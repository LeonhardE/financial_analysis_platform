# Persistent runtime core

This additive 1.0.0 browser foundation implements the persistent Agent/content/resource
consent contracts. It does not change or reissue any legacy helper release. It has no
HTTP endpoints, OAuth token holder, model-facing RPC, automatic enrollment or permissions.
It is shipped as an independently checked producer prerequisite; the fixed runtime
Worker and owner Web consumers follow separately. Production gates remain off.

## Authority

- Root-signed append-only registry pages, original device-signed identity bindings,
  current Agent certificates and pinned checkpoint digests are independently checked.
- Original signed resource controls and producer source observations reconstruct the
  exact consent aggregate. Current/future version approval is scoped to a logical
  resource/incarnation/epoch; revocation is terminal for that permission ID. A new
  explicit approval uses a new ID. Lower/forked known consent versions are rejected.
- Root task/resource publications and Agent reports bind exact JWE AAD, ciphertext
  digest, signer, recipients, business fields and immutable Run inputs. Structure or
  successful decryption alone is not authority. Historical owner reads are a trusted
  client operation with issuance expectations, never a model-selected HTTP purpose.
- Request proofs bind one fixed HTTPS origin/path/method/body and a fresh 120-second
  nonce window. They do not replace the server's current fences and operation CAS.

## Storage and host boundary

`RuntimeStorage` persists ECDSA/ECDH private **CryptoKey objects with extractable=false**,
public identity/checkpoint pins and original encrypted outbox carriers. It checks both
key pairs after restore. Concurrent first initialization is create-only, and missing
keys cause an explicit lost-profile state instead of silently generating a replacement.
Root/owner keys, CEKs and plaintext task/resource/report content are not persisted.

The eventual closed Worker owns these handles. Internal primitives accept key handles
for composition and are not a public arbitrary-sign/decrypt/storage API. Native client
confirmation is not protected-host attestation. Real Muse isolation, browser/profile
lifecycle and cross-day acceptance remain required before production enablement.

## Reproduce

Use the exact runtime package lock and `npm ci`, then `npm run build` in `runtime/`.
Build-time AJV compilation emits standalone validators; checked browser bundles need
no installed packages, dynamic code generation or CDN modules. `integrity.json` pins
all source, schema, lockfile and bundle bytes. The bundled schemas are a collision-checked
snapshot of the four corresponding shared schema documents at this release.

The Hub tests verify live Python↔Node encryption/signatures for all five content types,
original approval/revocation/reapproval chains, current proof binding, storage restart,
concurrent initialization, nonexportability, immutable encrypted retry and isolated
bundle import. No real account data or private key fixtures are stored in the repository.
