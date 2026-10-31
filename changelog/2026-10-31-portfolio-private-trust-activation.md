# Portfolio private trust activation

## Summary

- Consume the pinned five-field Hub trust contract while preserving legacy default denial and Portfolio's private IAM boundary.
- Configure only the selected Web and Hub service invokers; add runtime-only Firebase revocation lookup and a separately gated service-only image publisher path with producing-build metadata verification.
- Exempt eleven implemented opaque carrier/proof fields from indexing, with no TTL; scope infrastructure field metadata/update permissions to the existing Portfolio database.

## Validation

- Native mock plans cover legacy/explicit trust, malformed identities/endpoints, private UID/cap boundaries, exact invokers, independent image activation, field exemptions and no TTL.
- Root `npm run check` before commit. Actual complete target plans, deployment, image provenance and remote owner/delegation checks remain separate operational evidence.
