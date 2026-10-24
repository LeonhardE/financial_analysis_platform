# Adopt the existing User service into isolated Terraform state

Date: 2026-10-23

## Summary

Manage the existing User service and dedicated runtime without recreation, keeping image releases independent.

## Changes

- Enable only the User target in its own state, execution accounts and native-approved saved-plan workflow.
- Import the existing User image trigger, publisher grants and runtime Firestore/Firebase metadata grants.
- Keep User configuration permissions scoped to the existing service and runtime, with read-only image access on the existing repository.
- Preserve the service UID, public invocation mode, one-instance service cap, image, release markers and traffic.

## Validation

- Plan-only mocked adoption guards reject a changed UID, access mode or instance cap.
- Bootstrap contract assertions enforce exact permissions and target boundaries.
- Root repository checks and production import results are recorded in the PR.
