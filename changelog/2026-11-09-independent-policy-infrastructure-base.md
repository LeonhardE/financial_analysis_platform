# Independent Policy infrastructure preparation

Date: 2026-11-09

## Summary

INF-011 D1 now has a separate trusted-Owner Terraform root for the Policy domain.
A default merge is inert. Ordered full resources/base plans prepare actual build
prerequisites before a private, authority-disabled Policy service can be proposed.

## Changes

- Require an explicit independent Policy project, inventoried operator projects,
  distinct keyless runtime/build accounts and a verified immutable Policy image.
- Prepare protected named live-witness storage, deny-all client Rules, immutable
  private snapshots, fixed ES256 and state-DEK wrapping keys, and bounded private
  Cloud Run configuration with both authority/release gates fixed off.
- Grant only exact build repository write and log access. No runtime key/data,
  public invocation, WIP/STS, impersonation or routine operator Policy control.
- Keep this trust root outside the ordinary operator catalog; document independent
  state/protected approval prerequisites, later exact D2/D3 bindings, recovery,
  retention/cost review and actual IAM/deployment acceptance still outstanding.

## Validation

- Fixed Terraform 1.16.7/provider 7.28.0 init and validation passed.
- Ten full provider-mocked plan cases passed: inert defaults, build-before-service,
  closed base, key/storage boundaries and invalid activation/project/image/identity
  or retention inputs. No apply or provisioner ran.
- Root `npm run check` and required commit checks precede publication.
- This source does not select a real project, authorize spending, create resources
  or establish actual IAM/recovery/live attestation acceptance.
