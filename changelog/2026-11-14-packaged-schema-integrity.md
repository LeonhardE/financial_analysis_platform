# Bind runtime schema loading to the validated packaged bytes

Date: 2026-11-14

## Summary

Reduce first-use schema initialization work by checking the integrity of a trusted
static package resource at runtime and validating its full meta-schema in CI.
User input validation and the schema resource itself remain unchanged.

## Changes

- Pin the raw packaged `schemas.json` SHA256 before JSON parsing or validator
  construction. Changed or unreadable bytes fail closed with the existing
  `authorization_unavailable` error and no fallback.
- Require independent full Draft 2020-12 meta-schema validation in the common
  suite, including verification of the installed package's resource bytes.
- Preserve every input size, canonical/strict JSON, schema/format and detached-copy
  check. Document the explicit pin update and package verification workflow.

## Validation

- Seven integrity regressions cover modified valid JSON, whitespace, truncation,
  invalid UTF-8, unreadable resources, failure isolation and detached copies.
- Complete common suite: the original 308 tests plus seven new tests pass.
- Schema resource bytes and wire definitions are unchanged.
