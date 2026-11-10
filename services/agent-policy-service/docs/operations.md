# State, recovery and release operations

## Latest authority is independent of backups

Production uses a named Firestore database for a small, strongly read live pointer, and a
separate GCS bucket of immutable content-addressed policy snapshots. The Root-approved domain
pins the exact project/database/bucket and configuration. Each pointer contains domain,
sequence, snapshot digest and prior digest. Every authorization rereads it; there is no cached
permission or fallback to a local file, old generation, earlier snapshot or empty initial state.

A mutation prepares an immutable snapshot with `ifGenerationMatch=0`, then compares and swaps
the live pointer using an actual Firestore transaction. Conflicts reread all current authority
and retry at most three times. Orphan prepared snapshots cannot select themselves as current.
Read-only decisions also confirm their witness observation. Producer/Google/KMS I/O cannot
bypass a raced revocation; authority and challenge state are rechecked before the successful CAS.
Only successful committed decisions are returned.

Snapshot reads verify the digest against the independently live pointer, with a generation
precondition. Replacing a snapshot with an old backup, missing the latest snapshot, losing the
witness, changing its configured resource or failing to read current state stops issuance and key
release. A restore copies only immutable, digest-verified snapshot objects; it never imports or
rewinds the witness. Whole-witness rollback by an administrator who controls that separate trust
anchor is outside this personal trusted-owner model. INF-011 must exclude it from ordinary
restore and deny executor/Hub operators witness/deployment/KMS administration.

The snapshot contains public approvals/keys, hashes of access/code/refresh credentials, signed
opaque refresh-generation metadata, challenges, encrypted recovery responses, state-head and
receipt metadata, and a bounded audit tail. It contains no Root/Passkey/owner recovery secrets,
financial input/report plaintext or raw executor private keys. Immutable snapshot lineage retains
past audit evidence; the live pointer selects only the latest state. Snapshot inventory alone is
not authority. Enforce retention, access and cost limits independently during provisioning.

Local SQLite witness plus filesystem snapshots is for synthetic/local development only. The
witness file is separate from snapshot backups. Snapshot files are published atomically after
complete writes, with mode 0600 and filesystem synchronization. Cloud Run refuses local storage
and Firestore emulator configuration. This local backend does not claim isolation from its host
administrator.

## Explicit first initialization

The HTTP application never initializes missing authority. After the independent resources and
Root public configuration are reviewed, an authorized operator can run:

```bash
PYTHONPATH=services/common:services/agent-policy-service \
  services/market-data-service/.venv/bin/python -m app.bootstrap --root-command /approved/root-bootstrap.json
```

The command contains a fresh Root control for action `bootstrap`, connection `policy`, expected
version 0/head null and `parametersDigest=SHA256(canonical({domain: <configuration digest>}))`.
The pointer must be absent; an existing live authority cannot be overwritten. This CLI creates
no cloud resource, key or IAM permission and does not enable service gates. Local development
explicitly creates its SQLite storage during this offline step.

A lost or untrusted witness is an incident. Do not run bootstrap as recovery or reuse an old
state epoch to make an old backup current. Preserve evidence, independently establish the latest
authority and use a separately reviewed Root migration/new authority epoch if it cannot be
recovered. Permanent original-key loss requires explicit Root identity migration; service restart
never generates replacement Agent/TLS keys, recreates grants or clears a revocation.

## Runtime and release boundary

The signer uses one fixed ES256 KMS version. It verifies the public key, resource names,
CRC32C checks and the produced signature. Key release decrypts only the Root-selected stored
ciphertext with the configured recovery CryptoKey and identity-bound AAD. The plaintext is
exactly 32 bytes and is immediately encrypted to the attested boot recipient; Root secrets and
analysis are never passed to KMS by this service. Measured startup can restore a locked keyring
before native HTTPS is available, under the bounded Root boot window or current account grant;
it never opens financial execution without normal current OAuth and policy checks. No endpoint exposes general signing/decryption.

The service deployment and independent KMS/witness domain belong to the trusted personal owner.
Everyday executor/Hub identities must be unable to deploy policy code, change its pins/gates,
write/restore its witness or invoke its sign/decrypt keys. Separate actual IAM, wrong-caller,
wrong-image, replay, key-possession, original-instance recovery and outage tests precede private
resource activation. Passing fixtures or merging a PR does not establish those cloud facts.

`infra/gcp/cloudbuild.agent-policy.yaml` builds and pushes an image only. Registry release mode
is `build_only`; there is no deployment step, trigger, policy key, database, bucket or IAM
provisioning in this implementation. INF-011 must supply reviewed outputs before deployment.
Scope/code changes require new Root approvals/transitions. Existing Hub/native routes and Web
remain independently deployable and unchanged.

## Limits and failures

- Owner domain: 8 terminal-or-active connections, 8 OAuth clients, 4 callbacks per client.
- Pending OAuth requests: 16 live requests; authorization codes: 64 retained until their 300-second
  absolute deadline. Families: 64; current unexpired access tokens: 128.
- Per connection: 16 challenges, swept after their 120-second deadline; 256 immutable operation
  receipts. Root control receipts: 256. Audit tail: 32, with immutable prior snapshots retained.
- Policy snapshot: 512 KiB; Root/lease control objects: shared executor-trust budget. HTTP JSON:
  64 KiB; OAuth forms: 24 KiB. Financial content is not an accepted payload category.
- Limits stop new mutations; they never evict revocation tombstones, reset trust, extend an old
  grant or silently move authority to a new connection. Review capacity before sustained rollout.
- Google, KMS, GCS and Firestore calls have bounded requests and no implicit application retry;
  only CAS contention is retried. Missing latest state fails closed. No credentials, claims or
  submitted private markers appear in error bodies or access logs.

## First-key and certificate public reviews

The Owner uses the authenticated public review routes in the
[protocol guide](protocol.md#owner-original-enrollment-and-certificate-reviews)
after explicit Root bootstrap. They are safe to expose while issuance/release
remain off, subject to the configured Owner authentication and actual service
reachability policy. They read the current witness and fixed Google/current-VM
metadata and sign only closed review receipts. No Root private key, plaintext
analysis, secret unwrapping or state mutation is part of a review.

Keep the Owner client unlocked through the bounded ceremony: verify the pending
review immediately, obtain the original CSR's public CA chain while creation
waits, finalize the original keys, then obtain/verify the final review with that
chain before signing registration. Do not backdate a receipt or trust an unsigned
local success report. Losing or expiring the ceremony never permits reservation
removal or silent key regeneration. Future renewal uses the current connection's
certificate review plus a fresh purpose-limited Root certificate control.
No review, bootstrap, CA request or deployment is executed by merging this source.
