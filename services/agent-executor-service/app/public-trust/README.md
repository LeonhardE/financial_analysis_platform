# OpenAI Connectors public trust anchors

Reviewed and retrieved 2026-11-09 from OpenAI's official public authentication
resources. These are public CA certificates, never private keys or credentials.

| File                                   | Official source                                                                                | SHA-256 of exact PEM bytes                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `openai-root-ca.public.pem`            | [OpenAI Root CA](https://developers.openai.com/plugins/mtls/openai-root-ca.pem)                | `3a565b5c83c83ba2de085de28733e3c6af01af9b347322b93caf3a03d42c5cbe` |
| `openai-connectors-mtls-ca.public.pem` | [Connectors mTLS CA](https://developers.openai.com/plugins/mtls/openai-connectors-mtls-ca.pem) | `7485f98dfbb7db119ca99d5748ac7a86baa73ddede878d3263a50cba2c4f6dd8` |

The server verifies both bundled file hashes and intermediate-to-Root signature,
CA roles, validity and clientAuth chain. Its TLS trust store admits only this
Connectors intermediate, with strict validation and partial-chain support;
provider leaves rotate under that intermediate. A valid leaf also needs exact
DNS SAN `mtls.prod.connectors.openai.com` and clientAuth EKU. No forwarded-header
fallback or arbitrary deployment-supplied trust file exists. Review CA rotation
against the [official authentication guide](https://developers.openai.com/plugins/build/auth)
and update code hashes/certificates in a new measured image before activation.
