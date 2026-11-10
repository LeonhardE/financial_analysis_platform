# Dormant independent Owner lane module

This foundation owns no deployed instance. Each independent target later invokes
it from a separate Owner administrator root, with its own project/backend/source.
It defaults both execution triggers disabled and grants no workload permissions.
Do not invoke it from the ordinary repository administrator root or let a workload
apply account administer this module. See [execution contract](../../docs/owner-lane.md).

Credential-free validation uses the pinned Terraform toolchain, `init -backend=false
-lockfile=readonly`, `validate`, and provider-mocked `test` plans. Source tests do
not create buckets, identities, IAM or triggers. Real bootstrap/activation still
requires independently reviewed actual inputs, budget and an Owner-controlled
remote administrator backend; examples never authorize a local-state apply.
