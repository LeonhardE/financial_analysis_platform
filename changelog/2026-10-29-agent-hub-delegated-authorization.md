# Agent Hub delegated authorization foundation

Date: 2026-10-29

## Summary

Add a separately authorized Muse OAuth foundation so external agents can receive bounded,
owner-approved task permissions without receiving the user's website login or content keys.
Existing owner vault, resource catalogue and encrypted task APIs retain their identity boundaries.

## Changes

- Integrate the framework-independent Authlib authorization-server core, pinned to 1.9.1, with
  strict preregistered clients, exact redirects, S256 PKCE and the separate encrypted v2 resource.
- Persist one-time authorization decisions and hashed credentials through existing Hub
  transactions, with short access tokens, refresh rotation and revocation isolation.
- Reuse current root-authenticated keys, signed task grants, task versions and source fences;
  OAuth permission alone does not authorize decryption or distribute content keys.
- Keep configuration disabled by default. Do not change shared contracts, other services,
  frontend, cloud configuration or provisioning. Real Muse consumption and consent UI integration
  remain separate acceptance boundaries.

## Validation

- All 156 Hub tests pass, including 44 new domain, HTTP, Firestore SDK and disabled-startup cases.
  Synthetic tests cover strict Google-owner verification boundaries, A/B users and A1/A2 agents,
  signed grants, current source/key fences, narrowed scopes, expiry/capacity and concurrent reuse.
- The required root `npm run check` passes; independent security review found no blockers and
  separately ran 22 targeted cases. Tests use synthetic data and in-memory RPCs, without cloud
  credentials, real Muse accounts, running servers or tunnels.
