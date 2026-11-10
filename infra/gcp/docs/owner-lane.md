# Independent Owner execution

The independent Owner lane is separate from the ordinary operator catalog. Source
merges do not register targets, create accounts/backends/triggers, enable execution,
submit authenticated plans, queue applies, build images or deploy workloads.
Each consumer needs its own reviewed administrator root and closed
`owner-lane.consumer.json` in its workload root. This foundation adopts no target.

`owner_lane.py inspect --target <target> --contract <private canonical JSON>` checks
public operator inputs and hashes exact source without credentials. It cannot
authorize deployment. The small recursive schema rejects unknown fields, including
private JWK members, rather than accepting arbitrary environment/variable maps.

The future plan/apply commands accept only build locators, never a caller's lane
file. They fetch the actual trigger's `_OWNER_LANE` and verify its canonical SHA,
project/target/source, independent phase account, exact source provenance and main
commit against both trigger and build. Apply additionally requires native approval,
a successful matching plan producer, a plan at most six hours old, current backend
generation, exact private artifact generations/digests, and the saved binary.
Terraform backend locking/lineage/serial remain enforced. Deletes are denied except
the source-registered local configuration controller, preserving its service.
VM replacement is refused unless a target's source explicitly registers its one
instance and launch-record addresses and the protected contract contains a fresh
`replacementReview` with the original numeric instance ID/current backend generation.
Only delete-before-create at the same project/name/zone/machine is permitted, with
protection already off in both the prior state and proposed instance. First apply
a separate protection-off full plan, then review a new replacement full plan, then
restore protection with another full plan. Both the producer plan and downloaded
saved binary enforce this guard. It never permits another resource deletion,
create-before-destroy, a second slot or key/state reset; runtime still must restore
the original identity under current Root authority. Never bypass with local apply,
empty state or `-target`.

`terraform/owner-lane-module` is a dormant reusable administrator module. Its
execution triggers default disabled. It creates separate private versioned state
and append-only plan/recovery access plus distinct keyless plan/apply accounts.
It grants no workload write, Root authority, KMS decrypt or ordinary operator
impersonation. Consumers must separately specify actual target read/write roles
and restricted submit/actAs/approval ownership; arbitrary custom builds under an
apply account remain trusted. No execution identity may provision its own admin
root. The administrator root itself uses an already reviewed Owner-only remote
backend, not an empty local-state bootstrap over existing resources.

No public inputs or examples select actual projects, approve spend or create Root
keys. Keep local instances/evidence ignored, review a complete plan per target,
and retain authoritative witness, original-key recovery state and required KMS
versions during later recovery/cleanup. Native scheduling and online attestation
are separate post-deployment acceptance.
