# Portfolio automatic release Python compatibility

Date: 2026-11-03

## Summary

Make the Portfolio deployment step start reliably with the official Cloud SDK image after its
system `python3` command was removed from `PATH`.

## Changes

- Pin the Portfolio deployment tool image to its reviewed immutable official digest and invoke
  its bundled Python interpreter by absolute path.
- Document the interpreter and existing release gates. Deployment arguments, the shared release
  guard, trigger configuration and permissions are unchanged.

## Validation

- Existing deployment guard and infrastructure tests, plus formatting checks.
- Automatic image build and guarded deployment remain the post-merge live verification.
