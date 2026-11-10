# Executor Owner administrator preparation

This separate root owns only Executor's Owner execution lane and public-artifact
publishers. Default `enabled=false` creates no resource or grant. It is outside
the ordinary operator catalog. Select a new independently controlled project,
existing source connection and pre-existing Owner-only administrator GCS backend
before later use. Do not run this root as a workload plan/apply identity or use
empty state over existing resources. Project/billing/API/backend bootstrap and
budget approval are separate administrator events.

Prepare administrator resources with all access/execution flags false. Review
metadata-only plan access and trusted Owner apply access before explicitly enabling
`workload_access_enabled`. The apply role controls selected-project infrastructure
and project IAM, including VM replacement; this is trusted Owner power inside the
dedicated Executor project, not isolation from a malicious Owner. It has no direct
KMS decrypt/sign, object-data read, token minting or Cloud Build submit/trigger edit
permission, and no role in the Policy project. Restrict actual submit/actAs/approval
rights; routine Hub or workload operators cannot be administrators.

After the actual runtime/creator accounts exist, separately enable
`workload_act_as_enabled` for only those exact accounts. Review a canonical public
contract with the target's closed `owner_lane.consumer.json` schema, then separately
enable execution. Replacement needs the source-registered fixed VM/launch slot,
original numeric instance ID and current state generation, and three full saved
plans: protection off, reviewed same-name replacement, protection restored.
Original-key recovery and Root/Policy authority still apply.

`publisher_access_enabled` grants only `fv-owner-publish` public enrollment reads,
create-only `*-finalization.json`, and CAS replacement of `executor-config/` in
the separate private config bucket. It cannot read/write encrypted runtime state,
replace reservations/offers, list objects or operate Policy KMS. Config overwrites
need Storage's delete permission, scoped only to that config prefix. Do not copy
private material or business content there. Enable only after the workload buckets
exist. `publisher_operators` is an explicit list of Owner users who may impersonate
these exact public publishers; no keys are created and the default list is empty.

`challenge_access_enabled` separately grants `fv-acme-publish` only public token
get/create/delete under `.well-known/acme-challenge/` in the separate ACME bucket.
It cannot read config/enrollment/state. The workload's `acme_http01_enabled` is an
independent false-by-default opt-in for that bucket and HTTP80 frontend. Confirm
organization public-access policy permits this public-token bucket before future
activation; do not weaken the private buckets or organization policy to proceed.
No public CA request or renewal schedule is made by Terraform.

Keep every gate off during preparation-only work. See the
[Owner lane](../../../docs/owner-lane.md),
[Executor workload](../../envs/prod/agent-executor/README.md) and
[public-artifact tools](../../../../../services/agent-executor-service/docs/operations.md#owner-public-artifact-tools).
Pinned provider-mocked full plans validate inert defaults, separate gates and
publisher boundaries without credentials. Actual inherited IAM, supported custom
roles, source connections and recovery require later authorized cloud evidence.
