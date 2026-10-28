# Adopted Portfolio deployment configuration

Portfolio already has its private Cloud Run service, keyless runtime identity,
named database and isolated state. This change migrates existing instance
values into the selected operator projection; it does not repeat first
provisioning or enable normal execution. The Portfolio catalog remains
`enabled=false`, its source release mode remains `build_only`, and the image
trigger keeps `_DEPLOY_SERVICE=false`. Hub stays at its existing unprovisioned
stage. Fresh-install work is separate and is not implemented here.

## Explicit inputs

The runtime's verified `target-instance-v1` projection supplies one typed
`deployment` object: `project_id`, `region`, `artifact_repository`,
`runtime_account_id`, `creation_image`, `existing_service_uid`, and `web_origin`.
There are no author-project, image, runtime or CORS defaults. Images must be an
immutable Portfolio digest in the selected region/project/repository; Web origin
must be one canonical lowercase HTTPS origin without credentials, port, path,
query or fragment. The upstream loader validates the entire closed projection
and binds it to actual source/build/trigger metadata and the saved plan.

Generate a private review candidate from an explicitly selected operator profile:

```sh
python3 infra/gcp/deployment_profile.py compile \
  --profile .deployment/profile.json --target portfolio \
  --output-dir .deployment/portfolio-review
```

The candidate's `terraform-inputs.candidate.json` contains only the permitted
`deployment` input. The legacy `bootstrap_image` argument defaults to null and,
if supplied by an older private operator file, must exactly equal the selected
creation image. It never selects an alternate image; the module uses
`deployment.creation_image` exclusively. The example files contain synthetic
placeholders, not inventory, credentials or provisioning permission.

## Existing ownership and access

The business root retains its existing resource addresses for the runtime,
`portfolio` database, `portfolio-api`, and the shared configuration controller.
A new read-only service boundary requires the inventoried UID, enabled invoker
IAM checks (`invoker_iam_disabled=false`) and the existing service-wide maximum
of 12. A missing/replaced service, absent identity/cap metadata or changed
invocation mode fails the plan. The revision maximum remains 1; service-wide and
revision limits are distinct existing settings. No invoker grant is added.

The shared controller continues to preserve the live image and release-owned
traffic. Private identity/metadata reads do not grant database content access.
The runtime still accesses only the named Portfolio database through its
existing condition; browser/client SDK reads and writes remain denied by the
existing client Rules. No key, secret, brokerage credential, model access,
private broker, KMS resource or server decryptor is introduced.

Administrator bootstrap keeps the existing Portfolio `service` stage and owns
its execution state, identities, IAM, client Rules and image trigger. Only its
Portfolio runtime/account references, artifact repository and existing build
trigger UUID are read from that target's projection. An output precondition
rejects a different trigger UUID without adding a resource or import. Inactive
stages remain inert. Other targets keep their original configuration and stage.

## Review and verification

Use the existing isolated Portfolio backend from the operator profile; retain
its bucket, prefix, lineage, serial and managed addresses. Do not initialize an
empty state, change region/account, import another target, use `-target`, or
reset an applied stage. Review a complete business-root plan expecting zero
managed creates/updates/replacements/deletes; new read-only data and output
metadata are separate from resource changes. Review the complete administrator
bootstrap plan and permit only the selected Portfolio trigger metadata/filter
transition. Other target instances, runtime permissions, database settings,
private invocation, capacity and build-only behavior must remain unchanged.

Keep the actual main-only source, UUID/digest, six-hour age, configuration
ownership, backend generation, Terraform locking/lineage/serial, native approval
and exact saved-plan-only apply checks. Old saved plans require regeneration
after reviewed source/configuration changes. This source change performs no
apply or new cloud provisioning; real plan evidence is an operator step.

Offline tests use two independent synthetic projects/regions/runtimes/images,
verify named-DB/CORS/private service boundaries, and reject UID/invocation/cap
changes, malformed inputs, wrong-owner or mutable images, noncanonical origins
and an overriding legacy image alias. Bootstrap mocks test stage gating,
repository/runtime binding and refusal of a changed build-trigger UUID. They
use no real account or cloud mutation and do not replace live IAM evidence.
