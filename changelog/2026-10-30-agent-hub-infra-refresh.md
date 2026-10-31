# Refresh Agent Hub first-provision configuration

Date: 2026-10-30

## Summary

Prepare the current encrypted Hub application for a separately authorized first cloud
creation. Default administrator stage, pipeline and agent protocol flags remain disabled;
this change does not apply infrastructure or deploy a service.

## Changes

- Replace Hub business-root production defaults with explicit validated instance, source
  identity and bounded Muse registration inputs; emit the implemented backend setting.
- Propose a protected operational RSA signing key and narrowly scoped runtime signing,
  public-key and Firebase revocation-check metadata access, separate from user content keys.
- Add index-only exemptions for implemented opaque fields without correctness-breaking TTL,
  with exact database metadata permissions for later plan/apply identities.
- Keep invoker IAM in the administrator service stage, private by default; future public
  connector invocation requires a separate explicit service-stage choice.
- Preserve build-only behavior while requiring explicit region/repository configuration.

## Validation

- Native mock plans cover portable configuration, storage without TTL, operational signing,
  default-off protocol/public access and invalid image/identity/registration inputs.
- Administrator Hub tests cover inert defaults, staged API/identity/IAM proposals and exact
  runtime/metadata permissions. Full live plans and image provenance are separate evidence;
  a manual candidate is not a dedicated-trigger first-provision approval.
