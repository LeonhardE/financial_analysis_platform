# Adopt Config infrastructure without replacing its service

Date: 2026-10-23

## Summary

Manage the existing Config service and runtime identity through their own
Terraform state and approval workflow while preserving independent image releases.

## Changes

- Import the existing Config service/runtime and administrator-owned image
  trigger, deployment grants, preferences storage and Firebase authentication read permissions.
- Retain observed service identity, invocation mode, instance cap, container
  configuration, environment and existing image-trigger behavior.
- Grant only Config execution permissions; retain a native approval gate and
  narrowly scoped existing-image download permission for configuration updates.
- Add Config root adoption guards, target-specific mock checks and rollout notes.

## Validation

- Target-specific Terraform mock plans cover adoption identity, invocation mode,
  service cost boundary and execution permissions.
- Repository checks run before commit; live bootstrap/import acceptance is
  performed from the merged source with the native saved-plan approval flow.
