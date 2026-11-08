# Consolidate maintained component documentation

Date: 2026-11-07

## Summary

Replace scattered per-feature documents with README entry points and maintained topic guides
for Agent Hub, Web and the shared encrypted contracts.

## Changes

- Merge Agent Hub references into owner API, key-management, persistent API, runtime and legacy
  compatibility guides; retain technical contracts and separate current implementation from real acceptance.
- Consolidate Web workspace, transport, key/recovery and Agent references, and shared authority/content guides.
- Correct obsolete consumer-stage descriptions, add persistent plan evidence, and repair moved-file/anchor links.
- Normalize the Config IAM runbook filename while preserving its operational content and third-party notices.
- Make commit author policy contributor-neutral; preserve configured author identity and collaborator credit.
- Document same-named feature-branch tracking and maintained-document organization.

## Validation

- Audit repository Markdown file/heading references and current route/feature boundaries.
- Full repository `npm run check` before commit.
- Verify the PR changes documentation only and the feature branch does not track main.
