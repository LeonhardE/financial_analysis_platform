# Production Web infrastructure

This root adopts the existing `market-web` service and its dedicated `fa-web-runtime`
identity into an isolated Web Terraform state. It does not rebuild either resource,
change the client implementation, or provision a database permission for the Web runtime.

The reviewed Cloud Run UID is `4cd78365-f1a5-4049-a397-d00b1eebfd68`; the runtime
unique ID is `102894855052714235808`. Planning reads the service independently and
fails if its identity, disabled invoker IAM checks, or service-wide maximum of two
instances changes. Native imports and `prevent_destroy` protect the existing objects.
The imported native service uses `ignore_changes = all`; configuration changes use
the existing etag-aware controller rather than a native full-template update.

## Ownership

- The Web root owns its runtime metadata and declared Cloud Run configuration.
- Bootstrap owns Web's plan/apply identities, isolated state bucket, native approval
  trigger, additive service/runtime grants and the existing `build-market-web` trigger.
- The normal Web image pipeline owns images, revision names and traffic. Terraform
  reads those fields immediately before a configuration update and preserves rollback
  routes. A reviewed controller replacement is available for explicit drift repair.
- Public invocation already uses `invokerIamDisabled=true`; adoption does not add an
  `allUsers` IAM grant. Revision scaling remains 0–12, while the existing service-wide
  maximum remains two. This preserves the current cost settings.
- The browser Firebase/API configuration remains build-time configuration in the
  imported Web trigger. All nine existing substitutions and the existing file filters
  are preserved exactly. Firebase Web configuration is public client configuration,
  not a service-account credential. There are no runtime environment variables or
  secret payloads in this service.

The Web trigger is declared directly because the shared trigger module always adds
`_DEPLOY_SERVICE`; the existing Web trigger has no such key and already deploys through
its retained build configuration. Adopting it directly avoids an incidental update.
The existing shared `fa-build` identity is referenced, never adopted or reconfigured.
The Web runtime is a dedicated user-managed account, so adopting its metadata does not
claim ownership of a Compute default account or another service's runtime.

## Minimal execution permissions

Plan can read only the existing Web service and runtime account. Apply can update
that service, maintain that runtime's metadata/enabled state, and attach only that
runtime. Apply also receives `artifactregistry.repositories.downloadArtifacts` on
the existing Toronto `financial-analysis` repository because Cloud Run revalidates
the current image during a configuration PATCH. The repository contains multiple
images, so this is a repository read boundary, not per-image isolation. It grants
no upload, deletion, repository administration, database access or IAM editing.

## Apply procedure

1. Merge this Web-only infrastructure PR after User and Config are independently
   migrated. Review an administrator bootstrap saved plan: existing Web trigger and
   two existing additive deployer grants import unchanged; only Web execution
   boundaries and narrowly scoped permissions are added. Apply that exact plan.
2. Run `terraform-plan-web` from trusted `main`. Review the immutable saved plan,
   provenance, configuration hash and state generation. Initial Web adoption must
   import the two native resources without updates/replacement and create only
   `module.web.terraform_data.configuration`.
3. Request `terraform-apply-web` with that producing plan build ID. Verify it is
   natively pending, approve the reviewed plan, and let the runner apply it unchanged.
4. Check the same service/runtime identities, retained image/traffic and a successful
   public HTML response. CPU representation can normalize from `1000m` to `1`, yielding
   a configuration revision without rebuilding the service. Run a fresh plan and
   require `No resource changes.`

If configuration execution fails after imports, inspect the current remote state
and service first. Generate and approve a fresh plan for the tainted controller;
do not replay a stale initial import plan or upload old state. Raw plans, state and
live account/policy inventories remain private and must not be committed.
