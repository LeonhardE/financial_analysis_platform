# Explicit fixed-instance replacement review

Date: 2026-11-10

## Summary

Allow a separately adopted independent target to move its single VM between
reviewed modes without making arbitrary Terraform destruction available.

## Changes

- Require source-registered instance/launch addresses, the expected original VM ID
  and current state generation in protected trigger metadata.
- Require a prior separate protection-off change and same project/name/zone/machine
  delete-before-create replacement; deny unrelated deletes and key/state resets.
- Apply the same checks to the original plan and exact downloaded saved binary.

## Validation

- Adversarial offline replacement and existing saved-plan execution tests.
- Required complete repository checks; no cloud plan, replacement or deployment.
