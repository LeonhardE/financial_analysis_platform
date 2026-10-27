# Existing KMS key access

Grants one explicit capability on an **existing CryptoKey** using additive IAM
members. The module creates no key ring, key, key version, identity, Secret
Manager resource or project role, and reads no private key or secret payload.
There are no grants by default. Consumer roots own existing resource references,
provider configuration, imports, actual key-purpose checks and rollout approval.

| Usage               | Fixed role                                   | Allowed principal                                                                                              |
| ------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `delegation_signer` | `roles/cloudkms.signer`                      | Explicit custom service account in the key's project.                                                          |
| `public_key_viewer` | `roles/cloudkms.publicKeyViewer`             | Explicit custom service account in the key's project.                                                          |
| `firestore_cmek`    | `roles/cloudkms.cryptoKeyEncrypterDecrypter` | Only `service-PROJECT_NUMBER@gcp-sa-firestore.iam.gserviceaccount.com` for the explicit owning project number. |

The caller cannot select an arbitrary IAM role. Signing does not imply decrypt,
key administration or even reading a public key; add a separate public-key-viewer
instance only when the workload actually needs it. Local signature verification
does not need Cloud KMS's remote Verify API, so Signer/Verifier is not the default.

Hub's internal RS256 delegation signer is a **platform authentication key**, not
the user's vault root/device/agent or content key. Its consumer must choose the
approved `ASYMMETRIC_SIGN` key and supported RSA algorithm, and configure an exact
numeric `cryptoKeyVersions/N` reference for actual signing. The module validates
the CryptoKey reference's shape and IAM principal; it does not fetch or certify
the key's existence, algorithm, state, purpose or live inherited permissions.

Cloud KMS IAM is scoped to CryptoKey, **not individual key versions**. Granting
signer on a key permits that operation on its usable versions. Pinning a numeric
version in application configuration does not create a version-level IAM boundary.
Version selection/rotation belongs in trusted consumer configuration.

Firestore CMEK is storage encryption managed by the Firestore service agent.
Its key permission must never be granted through this usage to Hub/Portfolio
runtime identities. A consuming database root must separately verify key purpose,
database/key location compatibility and the correct project-number-to-project-ID
mapping. The explicit `project_number` is trusted input, not a discovery result.
This permission does not give a runtime user-content decryption capability, and
CMEK cannot replace client-side E2EE. User content keys remain off the platform.

## Inputs and outputs

| Input            | Type              | Default  | Meaning                                                                                                                       |
| ---------------- | ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `project_id`     | `string`          | Required | Key-owning project ID.                                                                                                        |
| `crypto_key_id`  | `string`          | Required | Full `projects/PROJECT/locations/LOCATION/keyRings/RING/cryptoKeys/KEY` in that project; no version, short alias or wildcard. |
| `usage`          | `string`          | Required | Exactly one capability from the table above.                                                                                  |
| `project_number` | nullable `string` | `null`   | Required for Firestore CMEK, positive decimal project number.                                                                 |
| `members`        | `map(string)`     | `{}`     | Stable logical map keys to service-account **emails without** the `serviceAccount:` prefix.                                   |

Outputs are `crypto_key_id`, `usage`, `role` and a `grants` map containing only
key/role/member metadata. No secret or key material appears in Terraform output.

Choose logical keys known at plan time, such as `runtime` or `firestore`, and keep
them stable. Each email can appear only once per module instance. The same
key/role/member tuple must not be owned by another module/root or an authoritative
IAM binding/policy. Separate usages have separate roles and may intentionally use
the same workload on the same key.

This module does not revoke inherited project/key-ring privileges or prove that
an otherwise overprivileged account has only these permissions. Inventory prior
grants in the consumer's target review. Removing a member entry removes only its
owned grant; the repository's current saved-plan guard rejects delete actions,
so revocation requires its separately reviewed removal path.

## Consumer example

This illustrative declaration is not a deployed instance:

```hcl
module "delegation_signing" {
  source = "../../../modules/kms-key-access"

  project_id    = var.project_id
  crypto_key_id = var.existing_delegation_key_id
  usage         = "delegation_signer"
  members       = { runtime = module.runtime_identity.email }
}
```

Reuse `service-identity.secret_ids` and `cloud-run-service.secret_environment`
for existing Secret Manager access and numeric version references. Those modules
already reject cross-project or unpinned references without reading payloads;
KMS access does not require a new secret container or local service-account key.

## Verification and primary references

Run with the pinned Terraform/provider toolchain:

```sh
terraform -chdir=infra/gcp/terraform/modules/kms-key-access init -backend=false -lockfile=readonly
terraform -chdir=infra/gcp/terraform/modules/kms-key-access validate
terraform -chdir=infra/gcp/terraform/modules/kms-key-access test
```

Native tests use a mocked Google provider, create no cloud resources and cover
empty defaults, exact key/role/member boundaries, cross-project/private-content
decrypt rejection and malformed/duplicate references.

The role and version boundaries follow [Google KMS permissions](https://docs.cloud.google.com/kms/docs/reference/permissions-and-roles).
Firestore storage-agent behavior follows [Firestore CMEK](https://docs.cloud.google.com/firestore/native/docs/use-cmek).
The additive resource uses the pinned [Google provider v7.28.0 IAM definition](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/website/docs/r/google_kms_crypto_key_iam.html.markdown).
