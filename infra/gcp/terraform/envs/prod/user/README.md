# User infrastructure adoption

This root imports the existing Toronto `user-api` and dedicated `fa-user-runtime` into
`financial-analysis-512202-tfstate-user`, prefix `prod/user`. It never recreates either identity.
The independent UID, public-invoker mode and service-wide maximum of one are checked at plan time.

The existing image publisher and runtime Firestore/Firebase metadata grants are imported by
`bootstrap/user.tf`. The User Datastore User grant is restricted to `(default)` using the shared
Firestore access module's scope-only condition. Follow the
[administrator IAM migration](database-iam-migration.md) to replace the old unconditional tuple;
merging this configuration alone does not narrow deployed permissions. Firebase Auth Viewer and
other existing User permissions are preserved. Only the User apply identity receives existing-service configuration,
runtime metadata/attachment, and single-repository image-download permissions. The image
repository is shared; download access covers its other images, but deployment remains User-only.
No service creation/deletion, IAM administration, image upload or build/approval capability is granted.

After merging this target alone, review and apply the local administrator bootstrap saved plan,
then run `terraform-plan-user` on main. Verify two native imports with no changes and only the
configuration controller creation. Request `terraform-apply-user` with that producer ID, inspect
its pending native approval and approve the exact saved plan. CPU `1000m` is normalized to `1`
in one configuration revision; the live image, release markers and traffic remain release-owned.
Re-run the User plan and confirm no resource changes, unchanged service/runtime identities,
healthy `/health`, and anonymous private-route rejection. No user documents are read or changed.

Use the existing User image trigger for subsequent releases. Shared ownership guards already
protect image and rollback traffic; this adoption does not change application code or trigger filters.
