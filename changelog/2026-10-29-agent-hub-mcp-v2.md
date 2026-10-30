# Agent Hub encrypted MCP v2 protocol adapter

Date: 2026-10-29

## Summary

Expose seven encrypted agent tools and bounded authenticated proof/ciphertext continuation
resources through the official pinned MCP SDK. Existing Run, result, preparation and OAuth
authorization rules remain the domain boundary, including original saved-receipt recovery.

## Changes

- Add lazy, default-disabled JSON Streamable HTTP at the exact `/mcp/v2` resource.
- Project current committed agent task deliveries and metadata, without returning owner originals.
- Reuse encrypted Run/input/result/revision/receipt services with independent scopes and user/agent isolation.
- Enforce fixed host/origin, strict credentials/JSON, no-store responses and full MCP byte ceilings.
- Keep cloud settings/resources, Web/shared code, trusted UI and private-key handling unchanged.

## Validation

- All 12 MCP tests passed, using official modern/legacy SDK clients and synthetic encrypted fixtures.
- Cross-owner/agent denial, revocation, task pause, source outage, encrypted revision and replay checks.
- Full `npm run check` passed, including all 337 Hub tests, security, other targets and formatting.
