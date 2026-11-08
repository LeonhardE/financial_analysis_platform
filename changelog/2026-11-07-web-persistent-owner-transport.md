# Persistent owner transport prerequisites

Date: 2026-11-07

## Summary

Connect the Web owner's existing authenticated transport to persistent connection,
resource-consent, encrypted publication, plan-history and Inbox producers. Feature
gates and real account permissions remain unchanged.

## Changes

- Share an explicit owner route table between AuthProvider and the BFF, including
  producer-specific pagination, exact body/header budgets and closed response DTOs.
- Add a branded native account bridge with only two operations and original window,
  origin, request and nonce checks. Cookie-bound OAuth approvals stay in Hub.
- Preserve session-generation fencing before and after transient credential use.
- Validate actual Python producer DTOs in the synthetic encrypted owner/Agent loop;
  reject extra plaintext fields and arbitrary Agent or OAuth proxy routes.

## Validation

- Owner BFF, AuthProvider, native bridge and independent Python/Node protocol tests.
- Full repository `npm run check` before commit.
