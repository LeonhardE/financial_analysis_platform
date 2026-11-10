# Independent Executor Owner preparation

Date: 2026-11-10

## Summary

Prepare the Executor's separate default-inert Owner administration, public control
publication and original-CSR certificate path without deploying it.

## Changes

- Add closed Owner-lane inputs and the explicit fixed-instance replacement consumer.
- Separate trusted infrastructure administration, exact creator/runtime actAs,
  create-only enrollment finalization, private public-config publication and public
  ACME-token publication behind independent false-by-default gates.
- Add optional separate public-token HTTP80 frontend; original TLS443 remains opaque
  TCP to the TEE. State and config buckets stay private.
- Add operator-only public-artifact validation/CAS tools and CSR-only Certbot command
  preparation, exact challenge hooks and offline original-key certificate validation.
  Tools are outside the measured runtime image and never receive Root private keys.

## Validation

- Adversarial public-input/operator tests and complete provider-mocked full plans.
- Required repository `npm run check` before commit; exact-head CI before merge.
- No cloud resource, backend, IAM, CA, build, deployment or online validation executed.
