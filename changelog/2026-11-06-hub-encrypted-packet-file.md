# Import original encrypted connection packet files

Date: 2026-11-06

## Summary

The foreground helper can connect using the original encrypted packet JSON file returned by
the authorized tool. Browser agents with file-upload support can transfer opaque ciphertext
without transcribing it through model-generated text.

## Changes

- Add an optional file input to the 1.3.0 helper. Selecting a file performs no read, upload or
  connection; the existing explicit connection button reads one file locally, bounded to 12 KiB.
- Pass the parsed packet through the existing exact-field, recipient, pin, cryptographic and
  lifetime checks. Keep the paste option and reject ambiguous or multiple inputs.
- Clear packet and file controls before use and on lock, backgrounding or page exit. Ignore
  file reads that return after a lock or hide/show cycle. Store no packet file in the outbox.
- Rebuild the versioned page and integrity metadata; Worker bytes and trust pins are unchanged.

## Validation

- Page regressions cover original packet preservation through connection and report saving,
  explicit connection only, bounded/ambiguous/malformed/unreadable inputs and late reads.
- Reproducible helper build and repository `npm run check`.
