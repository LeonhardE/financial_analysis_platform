# Retired Confidential VM Executor target

The unused Confidential VM service, original-key recovery/creation utilities,
image/dependencies and dedicated VM/TCP-proxy deployment roots have been removed.
This directory retains historical contract references only and has no executable
application, image or deployable target.

The current route uses the existing [Agent Hub](../agent-hub-service/README.md),
Web and storage. Personal Agents keep their own credentials and users restore a
connection through reauthorization; no VM, fixed public proxy or extra Executor
project is required. This source cleanup does not delete existing cloud backups,
original keys, ciphertext, audit evidence or revocation state.

- [Historical recovery protocol](docs/recovery.md)
- [Historical operations](docs/operations.md)
- [Historical native transport](docs/native-mcp.md)
