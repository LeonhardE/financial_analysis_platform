# Managed Web owner configuration foundation

## Summary

- Add explicit managed Web owner compilation using the existing closed server/public sidecars, independent flags and fixed six-field runtime projection.
- Pin the complete deployment configuration and require Web source opt-in before Terraform consumption.
- Preserve ordinary compilation, old sidecar outputs and all nine public build inputs; browser capabilities continue through the existing runtime endpoint.

## Validation

- Offline checks cover legacy compatibility, independent flags, canonical hashes, mixed/mutated projections, exact source opt-in and private CLI output.
- Root `npm run check` before commit; no Web consumer resources, permissions or cloud changes are included.
