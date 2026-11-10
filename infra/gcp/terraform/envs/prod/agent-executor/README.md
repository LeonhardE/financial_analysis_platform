# Confidential Executor infrastructure source: INF-012 D2

Default `stage="none"` proposes no cloud resource or IAM grant. Merging source
neither selects a real project/billing account nor launches a VM. This root owns
only Executor identities, image repository, network/ingress, encrypted state and
the exact VM read grant consumed by the independent Policy. It creates no Policy
key/service/witness or ordinary KMS decrypt path. Actual apply and online
validation are separate and currently deferred.

## Ordered full plans

| Stage       | Proposed resources and behavior                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `none`      | Zero resources/grants; no image or launch configuration required                                                                                                                           |
| `resources` | Seven APIs, three keyless identities, build repository, private state/config buckets, network/TCP ingress and exact Policy VM-read IAM; no VM or invented image                            |
| `creation`  | Exactly one fixed-name production Confidential Space VM, creator identity, runtime/native off, three public Root/draft/permit sources; fresh Root creation authorization remains mandatory |
| `runtime`   | The same single VM slot under the distinct runtime identity, original-key recovery and explicit optional native pins; no creation source or initialization fallback                        |

Supply the explicit independent Executor project, region/zone, fixed instance
name, repository, three distinct account IDs and private /24 subnet from reviewed
operator input. `policy` contains only the independently reviewed D1 project and
runtime email; it must be different from the Executor project. No disposable
prototype project, credential, image, identity or approval is promoted by default.

Prepare a complete `resources` plan first. Build the registered Linux/amd64
`agent-executor-api` candidate with the existing build-only configuration, verify
successful exact main/source provenance and immutable digest independently, then
prepare a fresh full VM plan. No `-target`, mutable tag, placeholder image, debug
boot image or implicit source-trigger deployment is supported. Images must use a
numbered official production Confidential Space release supporting nonroot
containers (261001 or newer). Validate actual availability/quota/support before
any future apply; a source regex is not live evidence.

The ordinary operator catalog is intentionally unchanged. Use a separately
reviewed target-owned backend/protected saved-plan approval lane before live
work; do not use an empty local state or bypass the existing plan/source/digest,
locking, lineage/generation, age and final Owner approval gates. The example
backend is a placeholder, not a backend bootstrap or migration command. Scope
and budget approval precede any resource creation. User requested code completion
followed by a pause, without online validation.

## Original TLS reaches the TEE

The public global IPv4 address exposes TCP 443. A **target TCP proxy** forwards
the opaque stream to the only backend's original TLS listener on 8443. There is
no target SSL proxy, HTTPS terminator, managed server certificate, private TLS key,
HTTP header injection or plaintext analysis listener outside the TEE. Provider
mTLS still terminates inside the executor and inspects its actual client peer.
`proxy_header=NONE` preserves the expected TLS stream. This is explicit proxy
port selection; an ordinary passthrough forwarding rule would not translate
443 to 8443.

A custom VPC and explicit subnet have no broad inbound rule. Only Google's
classic proxy/health ranges `130.211.0.0/22` and `35.191.0.0/16` can reach 8443 on
these two exact workload service accounts. SSH, public direct backend ingress and
other ports are not granted. The VM has an outbound public IP for fixed Policy,
Hub and Google endpoints; this avoids an implicit NAT dependency and does not
open a firewall path. No flow/content/access log is enabled here.

The TCP-only health check establishes reachability, not TLS/provider/account,
attestation, key restoration or continuing permission. Creation does not serve
financial tools and may remain unhealthy to this probe. A healthy runtime still
needs every actual Policy/Root/provider check before new content use. Certificate
issuance uses the original CSR and exact public IP or reviewed DNS SAN. Obtain
and Root-approve a real chain before runtime recovery; never upload a private TLS
key or infer public certificate validity from mock plans.

## Fixed measured launch and a single replaceable host

The one instance is `n2d-standard-2`, AMD Milan, SEV, Secure Boot/vTPM/integrity
monitoring, a 10 GiB production boot disk, no display/IP forwarding, no startup
script and no extra disk/mount. The image's fixed command is
`python -m app.main`. Metadata selects only the operational variables accepted by
the image's closed launch policy. Nonroot user/network namespace mode is explicit;
CMD/mount/debug/log redirection/memory monitoring are absent or disabled. No API
accepts a free environment/metadata map, Docker command, machine class or URL.

`launch_review.operator_environment` is only the operator subset, **not** the full
OCI environment claim. Base image and launcher values such as HOSTNAME are also
measured. Observe/review the full bounded map and Root-approve it before actual
creation/runtime acceptance; do not replace it with this subset, widen variables
silently or treat a local descriptor as hardware proof. The public Root/source
pins and native config SHA must match the later actual Root enrollment exactly.

Image/mode/config changes trigger replacement in the same fixed instance slot,
with no create-before-destroy or autoscaling. The authoritative original keys,
epoch/head, encrypted outbox and receipts are recovered from live Policy-selected
state, never from the disposable boot disk or a local backup pointer. There is no
simultaneous second VM or replacement-identity generation.

Instance deletion protection defaults true. Planned replacement requires separate
full saved plans: disable protection on the current instance, re-plan/review its
replacement at the same name, then restore protection. Do not combine an old
saved plan with a new protection override, remove protected state or use `-target`.
Keep the applied resource stage after creation. Network, public address, repository
and state bucket retain prevent-destroy protection. Application restart/backup,
old-boot fencing and actual original-key/receipt continuity need later live proof.

## Least privilege and recovery storage

- Build gets only its exact repository writer plus log writer. It cannot deploy,
  impersonate workload identities, read state or administer Policy.
- Creator/runtime get exact repository reader and Confidential Space token
  generation. They receive no Policy project role, KMS decrypt, service-account
  impersonation, cloud key administration or witness permission.
- Runtime gets only immutable `executor-state/` object get/create and read-only
  `executor-config/` JSON in a separate public-metadata bucket. Creator additionally gets immutable enrollment
  get/create for its public pending/final offers and signed finalization inbox.
  No list, overwrite/update/delete, restore, bucket IAM or plaintext output grant.
- Policy gets only `compute.instances.get`, conditioned on this project's exact
  selected zone/name. The project binding plus full suffix handles ID/number
  aliases without exposing other VM names or administrative methods. The service
  separately checks actual current instance ID, RUNNING state and account.

The state bucket is private, uniform-access and public-access-prevented, versioned,
with seven-day soft delete and unlocked minimum retention. No lifecycle timer or
TTL deletes original keys, outbox, receipts or current ciphertext. Capacity/retention
needs explicit maintenance review; no authority reset or new identity is a cleanup
strategy. Public configuration lives in a separate private/versioned bucket without
a minimum-retention lock, so exact Root-approved certificate replacement can update
its stable URI without weakening immutable encrypted-state retention. Only approved
config readers are granted here; no writer is installed. Restore immutable digest-verified ciphertext, then ask the independent
live Policy for its current head. Missing/corrupt latest state stops; never select
an older generation as authority or erase an enrollment reservation to re-pair.

INF-011 D3 owns the narrowly scoped cross-project **creator Encrypt-only** grant,
Policy fixed-key sign/decrypt and live witness/snapshot permissions. Reviewed D2
public outputs are references, not authorization. Owner Root approval, original
key/certificate baseline, current state and actual workload/channel checks remain
independent. The runtime never receives an ordinary direct KMS decryption token.
Public configuration/finalization publication by an Owner broker requires its own
narrow reviewed binding; no such writer or Root secret is implicitly installed.

## Validation, budget and remaining acceptance

Pinned Terraform 1.16.7/provider 7.28.0 native tests run full provider-mocked
`plan` only. They cover inert defaults, build-before-VM, TCP forwarding/closed
firewall, immutable storage, exact Policy VM read, single production creation,
fixed recovery/native sources and invalid mode/image/project/source inputs. No
apply, credential or provisioner is used. CI validates all roots/modules and the
existing deployment ownership guards; root `npm run check` remains required.

Before later apply, review the actual independent backend/approval lane, current
build/boot image/region/quota, full workload environment, original public keys,
certificate/source bindings and Root approval. Record an explicit current cost
estimate, budget/alerts and stop/cleanup ownership. Compute, global TCP proxy,
public IPs, disk, storage versions/retention, registry and egress can bill while
some application gates are off. A single VM and closed scope are not a billing cap.
No spend or cleanup/destroy action is authorized by this source example.

INF-012 remains partial until actual deployment, provider/public TLS and wrong
image/debug/overrides/decrypt negatives, new-instance/encrypted-backup same-key and
original-receipt recovery, rollback/stop and cost reconciliation pass. VAL-008/003
owns later synthetic/private/native/offline/overnight acceptance. None is inferred
from a green plan/image/PR; online validation is paused as requested.

References: [Executor operation and public inputs](../../../../../../services/agent-executor-service/docs/operations.md),
[Policy base](../agent-policy/README.md),
[Google classic TCP proxy setup](https://docs.cloud.google.com/load-balancing/docs/tcp/setting-up-tcp),
[production metadata](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/reference/metadata-variables),
[pinned provider VM contract](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/website/docs/r/compute_instance.html.markdown).

## Owner administration and optional certificate challenge

The separate [Owner administrator root](../../../independent/agent-executor/README.md)
and closed public source marker opt this target into the protected saved-plan
lane. They do not register it with ordinary operators or activate any trigger.
Public enrollment/config publication has a separate narrow Owner identity.

`acme_http01_enabled=false` keeps HTTP80 and the token bucket absent. Explicitly
opting in later prepares a separate public-get-only bucket, no CDN, one-day token
cleanup and classic HTTP80 frontend on the same global Premium EXTERNAL IP as the
classic TCP443 frontend. Disjoint ports permit address sharing. The HTTP frontend
serves only public ACME token bytes; unknown keys return bucket errors. All objects
in this dedicated bucket are public by design, because `allUsers` cannot use IAM
conditions. Publishers are prefix restricted; no config, enrollment, state, private
key or financial endpoint belongs there. Organization public-access prevention may
block it; resolve that explicitly before activating, never weaken private buckets.
The original TLS443 stream still terminates only in the measured Executor.

Use the [Owner tool](../../../../../../services/agent-executor-service/docs/operations.md#owner-public-artifact-tools)
to prepare a CSR-only Certbot command and exact token hooks. No CA account, terms,
certificate request, cloud write, listener activation or renewal task runs on a
source merge. Every renewed chain needs original SPKI/SAN/trust validation and
fresh Root certificate approval before CAS publication. IP certificates are short
lived; repeat `certonly --csr` with the same original public CSR rather than
regenerating a key or assuming Certbot's ordinary lineage renewal manages it.

References: [forwarding address sharing](https://docs.cloud.google.com/load-balancing/docs/forwarding-rule-concepts),
[Storage IAM conditions](https://docs.cloud.google.com/storage/docs/access-control/iam),
[Certbot CSR/manual hooks](https://eff-certbot.readthedocs.io/en/stable/using.html),
[IP short-lived certificates](https://letsencrypt.org/2026/03/11/shorter-certs-certbot.html).
