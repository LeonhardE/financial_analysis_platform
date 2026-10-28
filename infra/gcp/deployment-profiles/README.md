# Explicit deployment configuration candidates

`deployment_profile.py` is a credential-free configuration producer. It validates an explicitly
selected deployment instance, then renders reviewable candidate files. No profile is selected by
an ambient gcloud project, the working directory, or a production default.

This foundation does **not** migrate the existing production Terraform roots, remove their
adoption guards, modify `terraform/pipeline.json`, activate a target, or implement a fresh cloud
installation. Those are separate, ordered per-target changes. The current pipeline still accepts
only its committed policy; it does not read these files or an arbitrary profile override.

## Local use

The checked-in [example](example.profile.json) contains a synthetic project and disabled browser
authentication. Copy it to an operator-only location and replace every deployment-instance value.
Do not use the demonstration project as an actual destination. Actual profiles and rendered files
belong in ignored operator configuration, not public Git or an application image.

```sh
mkdir -p .deployment
cp infra/gcp/deployment-profiles/example.profile.json .deployment/profile.json
python3 infra/gcp/deployment_profile.py validate --profile .deployment/profile.json
python3 infra/gcp/deployment_profile.py render \
  --profile .deployment/profile.json \
  --output-dir .deployment/candidates-review
```

`--output-dir` must not exist, must not be a symlink, and must have an existing parent. Each run
creates a new private `0700` directory with `0600` files. It never overwrites an earlier review or
live source. Filenames end in `.candidate.json` except the manifest; they are deliberately **not**
`terraform.tfvars.json`, `backend.tf`, or another automatically loaded Terraform input.

The stdout manifest contains the profile ID and hashes, never the raw public Firebase key or
configuration values. Invalid input returns a fixed message without echoing rejected values.

## Format and trust boundaries

[profile.schema.json](profile.schema.json) documents the closed v1 structure. The loader also
performs the cross-field checks that JSON Schema alone cannot express. Unknown and duplicate keys,
NaN, malformed UTF-8, oversized files, invalid types and secret-bearing arbitrary extension maps
are rejected. The maximum input is 128 KiB.

Required groups:

- `profileId`, `mode`, `project`, `region`: one explicit instance. Project numbers remain decimal
  strings; they are not inferred from credentials.
- `source`: exact HTTPS Git repository URL and regional Cloud Build repository resource. The
  resource must select the same project ID/number and region. Recording this pair does not prove
  that Google linked them; independently captured build provenance must still establish that.
- `artifactRepository`, `state`: named registry and the existing execution-policy naming convention
  for bootstrap, plan and isolated target state buckets. This producer intentionally retains the
  current consumer's naming constraints rather than allowing backend aliases to bypass isolation.
- `bootstrapStages`: explicit `portfolio` and `agent-hub` stages. Existing deployments must state
  their actual applied stages; there is no fallback to `none`. In particular, do not reset an
  already applied `service` stage. An adopted Portfolio/Hub target must use `service`; a target
  marked `create` permits only `none` or `execution`, never premature service grants. Fresh-install
  profiles must start with both stages `none`.
- `firebase`: only browser-public Firebase fields. Disabled authentication requires empty fields;
  enabled configuration checks the app's embedded project number and standard Firebase auth domain.
  API-key ownership and custom-domain ownership cannot be proven offline. Backend secrets, private
  keys and tokens have no fields here and must use independently managed credential mechanisms.
- `targets`: every registered repository/service target. The versioned target/runner names and
  controller addresses are protocol/tooling constraints, not the original deployer's account data.
  Runtime account IDs, origins, immutable image digests and adoption anchors are instance inputs.
  Service targets cannot share a runtime account; repository path tokens cannot be dot segments.

Only canonical HTTPS origins are accepted: no userinfo, ports, query, fragment, path, or duplicate
origin. Numbered Cloud Run origins must match their target name/project number/region. Hashed Run
URLs and custom DNS names do not expose enough information to establish project ownership offline;
operator inventory and later live review must establish that binding. Images always match the
profile's region/project/registry/target and an immutable SHA-256 digest, never a mutable tag.

Adopted targets require explicit unique service/trigger UUIDs and service image/origin. The `repo`
foundation has only plan/apply trigger anchors, without a Run identity. An input inventory is **not**
an independently audited inventory. Do not make up anchors from examples or treat a hash as proof
of ownership. Replaced identities and incorrect state lineages must still fail the consuming plan.

For a `fresh_install` profile, every target is `create`, disabled and has no adoption anchors.
Unknown origins or not-yet-built digests may be null until the corresponding stage has established
them. A complete first-install flow still requires APIs, source connection, identities, reviewed
builds, Firebase provider/domains and isolated state. The new profile does not create those things.

## Output contracts

| Artifact                           | Consumer shape / purpose                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline.candidate.json`          | Existing saved-plan policy schema v2; pinned toolchain version, unchanged six-hour maximum plan age, per-target state/identities/triggers/controllers |
| `bootstrap-inputs.candidate.json`  | Exact current bootstrap variable names, including both explicitly selected stages                                                                     |
| `backends.candidate.json`          | Bootstrap and each target's bucket/prefix, keeping administrator and ordinary target state separate                                                   |
| `web-substitutions.candidate.json` | Existing Web public substitution names; values derived from one selected profile                                                                      |
| `inventory.candidate.json`         | Explicit runtime account/origin/image/adoption inputs for later per-target migration                                                                  |
| `manifest.json`                    | Canonical normalized profile/source/target hashes, exact output-file byte hashes, `approval=not_requested`, `productionActivation=false`              |

The metadata binds inputs and output files to one configuration selection. It is not an approval,
SLSA statement, live ownership check, or replacement for source provenance, main-only checks,
saved-plan hash, lineage/serial, age limit, native approval, or configuration/image ownership.
Current live consumers remain unchanged. Do not copy candidates wholesale over their production
files: their adoption-only roots still contain target-specific guards requiring separate migration.

Remote Cloud Build does not inherit a developer's ignored local files. A later target integration
must explicitly provide configuration through a reviewed trusted source, bind its digest to the
selected source/target, and preserve plan/apply verification. There is no remote auto-discovery or
apply flag in this producer.

## Verification

```sh
python3 -m unittest discover -s infra/gcp/tests -p test_deployment_profile.py -v
```

Tests render two independent synthetic projects/regions/sources, exercise the real existing policy
validator on an isolated temporary root, compare bootstrap/Web variable shapes, reject mixed
projects/images/anchors and secret/unknown fields, verify actual file-byte hashes/private modes,
and prove an existing policy is not modified. They perform no cloud calls or Terraform execution.
