# Identify commit targets and isolate infrastructure changes

Date: 2026-10-23

## Summary

Commit subjects now identify the service or client they affect. Infrastructure provisioning
also stays within one target per commit and PR.

## Changes

- Require Conventional Commit scopes such as `fix(web)` and `feat(market)`, with explicit
  scopes for shared foundations and repository-wide policy or tooling.
- Use infrastructure subjects such as `infra(user)` and `infra(market)` and separate each
  service or client's provisioning into its own commit and PR.
- Keep shared modules and bootstrap infrastructure in dedicated foundation PRs, followed by
  separate PRs for each consuming service's resources.
- Document these requirements in `AGENTS.md`; existing commit history is unchanged.

## Validation

- `npm run check`: passed.
