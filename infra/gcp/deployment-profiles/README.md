# Explicit deployment configuration candidates

`deployment_profile.py` is a credential-free configuration producer. It validates an explicitly
selected deployment instance, then renders reviewable candidate files. No profile is selected by
an ambient gcloud project, the working directory, or a production default.

The existing repo, Market, User, Config, Web and Portfolio consumers now use the explicit
`trigger-v1` contract below. Their production catalog contains static registration only; an
operator's selected instance reaches remote execution through the existing managed triggers.
Portfolio remains disabled for normal execution and build-only for image publication. Uncreated
Hub uses the disabled `inactive-v1` marker, which cannot run a normal plan/apply. The producer
itself does not update triggers, activate targets, remove adoption guards or install cloud resources.

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

| Artifact                           | Consumer shape / purpose                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline.candidate.json`          | Offline legacy schema-v2 review view, including derived state/identities/triggers; never a replacement for the static production catalog |
| `bootstrap-inputs.candidate.json`  | Bootstrap variables including both explicit stages and a `deployment_configs` map of canonical adopted-target projections                |
| `backends.candidate.json`          | Bootstrap and each target's bucket/prefix, keeping administrator and ordinary target state separate                                      |
| `web-substitutions.candidate.json` | Existing Web public substitution names; values derived from one selected profile                                                         |
| `inventory.candidate.json`         | Explicit runtime account/origin/image/adoption inputs for later per-target migration                                                     |
| `manifest.json`                    | Canonical normalized profile/source/target hashes, exact output-file byte hashes, `approval=not_requested`, `productionActivation=false` |

The metadata binds inputs and output files to one configuration selection. It is not an approval,
SLSA statement, live ownership check, or replacement for source provenance, main-only checks,
saved-plan hash, lineage/serial, age limit, native approval, or configuration/image ownership.
Do not copy candidates wholesale over production files. In particular, `pipeline.candidate.json`
is an offline legacy compatibility view, not the production registration contract. Consumer roots
continue to validate explicit typed inputs and adoption ownership.

Remote Cloud Build does not inherit a developer's ignored local files. Its existing managed trigger
must receive the selected projection through an explicitly reviewed administrator update. This
producer has no remote auto-discovery, credentials, upload, trigger-update or apply action.

## Target-instance v1 and private compilation

```sh
python3 infra/gcp/deployment_profile.py compile \
  --profile .deployment/profile.json \
  --target market \
  --output-dir .deployment/market-review
```

Compilation requires an explicitly adopted target, including its existing service and trigger
UUIDs. Fresh-install targets cannot use this route to create resources. The new output directory
and fixed four files use the same `0700`/`0600`, no-overwrite rules as `render`:

- `deployment-config.candidate.json`: the closed target projection as a reviewable JSON file.
- `terraform-inputs.candidate.json`: exactly `{"deployment": inputs}` for an explicit local
  reviewed `-var-file`; it is not automatically loaded from a root or read by Cloud Build.
- `trigger-substitutions.candidate.json`: `_DEPLOYMENT_CONFIG` containing the canonical projection
  string and `_DEPLOYMENT_SHA256` containing its SHA-256. Use the string from this mapping, not
  the raw candidate file with its terminal newline.
- `manifest.json`: instance/target/input/file digests, `approval=not_requested` and
  `productionActivation=false`. Stdout prints this manifest only, never input values.

The projection has exactly `schemaVersion=1`, `instanceId`, `target`, `project{id,number}`,
`region`, `source{repositoryUrl,repositoryResource}`, `artifactRepository`,
`adoption{serviceUid,buildTriggerId,planTriggerId,applyTriggerId}` and `inputs`.
Only Web adds a closed `build` object. Canonical ASCII JSON is at most 4000 bytes, matching the
Cloud Build per-substitution limit. Duplicate/unknown fields, noncanonical whitespace, wrong
types, mixed project/source/image/origin/UID values and generic environment maps are rejected.

`inputs` contains only target-owned Terraform values:

| Target                  | Fields under root variable `deployment`                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| repo                    | `project_id`                                                                                                  |
| all services/Web        | `project_id`, `region`, `artifact_repository`, `runtime_account_id`, `creation_image`, `existing_service_uid` |
| market/config/portfolio | Above plus `web_origin`                                                                                       |
| user                    | Above plus `web_origin`, `market_origin`                                                                      |

Web has no `web_origin` Terraform field. Its public `build` object contains exactly the existing
`_REGION`, `_REPOSITORY`, three API origin and four Firebase substitutions. These are bounded
public settings, not credentials or arbitrary environment entries. An API origin may be empty
when that optional service is absent; nonempty origins remain canonical and distinct. Disabled
Firebase retains its existing empty public fields. Shared project/source values
and explicitly consumed origins are part of the projection digest. Unrelated target settings and
the full operator-profile hash are not, so an unrelated service edit does not silently invalidate
this target's plans. The input inventory still is not live ownership attestation.

## Explicit trigger-managed consumption

Each existing consumer has `deployment_source: "trigger-v1"` on its static catalog entry, a typed
`deployment` variable and existing plan/apply triggers wired to the canonical
`deployment_configs[target]` string and SHA-256. The bootstrap `map(string)` defaults to `{}` for
its input shape, but every `trigger-v1` catalog entry requires a valid projection, including disabled
Portfolio. Missing configuration fails closed; it does not select a production default.

The catalog has no global instance fields or per-target state bucket/service-account fields.
Only static protocol keys remain, including optional validated target prefixes/trigger names.
Static target roots/controllers and `enabled` remain checked-in policy. A disabled target fails
before credentials or Terraform. `inactive-v1` is reserved for disabled Hub static metadata, and its
existing administrator preparation stages do not require an invented adopted service/trigger
identity. Normal Hub execution requires a separate migration to `trigger-v1` and valid configuration.

The YAML passes only built-in project/region locators, never JSON on a shell command line or in
an environment variable. The runner reads the actual Build and Trigger via Google APIs, validates
the trigger's canonical configuration/hash, and requires the build's actual substitutions to
match exactly. Invocation-time overrides, missing pins or a mismatched target/instance fail;
there is no fallback to local files or legacy policy for an opted-in target. Legacy targets
remain on their existing explicit committed-policy path.

The runner verifies phase-specific accounts and trigger UUIDs, exact regional repository
resource/URL, protected main source and output-only provenance. Plan/apply must use the same
projection. The source fingerprint and private saved-plan manifest include the instance ID,
projection digest and exact Terraform-input digest in addition to existing source/toolchain/
backend/state/TTL/artifact bindings. Native apply approval and saved-plan lineage/serial checks
remain required. Apply never replans or takes arbitrary Terraform arguments.

Only plan writes one temporary private `deployment.tfvars.json` and supplies its exact path.
Apply uses the reviewed binary with its embedded inputs. Root tfvars, symlinks, `TF_*` injection
and arbitrary CLI arguments remain forbidden. `check-registry` checks source/static contracts
without cloud access or a local operator profile. Administrators who can alter trusted main,
triggers or build identities remain trusted; the scheme cannot resist those administrators.

The provider documents [substitution bounds and triggered-build missing-variable behavior](https://docs.cloud.google.com/build/docs/configuring-builds/substitute-variable-values)
and [invocation-time substitution overrides](https://docs.cloud.google.com/build/docs/manually-build-code-source-repos).
The runner therefore enforces its own required-value and server-metadata checks rather than
depending on YAML substitutions to fail when a value is absent.

## Separate Web owner configuration (profile v2)

The owner-entry foundation is an additional offline contract. Existing profile v1, target-instance
v1, `compile`, `render`, the six-field Web Terraform input and the nine public build substitutions
retain their existing behavior. No current Terraform, Cloud Build, application or runtime consumer
reads the new files. Enabling an offline flag does not enable a deployment or change the existing
Web container's empty environment. The target compiler never silently places owner settings into
`deployment`, `_DEPLOYMENT_CONFIG`, public build fields or bootstrap inputs.

Use [profile-v2.schema.json](profile-v2.schema.json) instead of
[profile.schema.json](profile.schema.json) to opt into a closed `webOwnerApis` object:

```json
{
  "schemaVersion": 2,
  "webOwnerApis": {
    "portfolio": false,
    "agentHub": false
  }
}
```

This is a fragment: retain all the other v1 profile fields. Both flags are required booleans in v2;
unknown fields, inline credentials, arbitrary environment dictionaries or separately supplied
upstream URLs/audiences are rejected. A v1 profile has neither flag and compiles to both disabled
under this new command. The original v1 schema remains closed and unchanged. All existing
source, project, region, image, UID, stage and target validation continues to apply to v2.

Each enabled owner route requires Firebase to be configured and Web and that upstream to have
explicit `adopt` metadata. A disabled route emits no retained origin or audience. Hub may remain
`create` with no origin/image and stay disabled while Portfolio is enabled. Upstream `enabled`
continues to mean pipeline policy; owner flags neither change it nor approve service creation.

Portfolio currently supports only its same-profile numbered Cloud Run service URL,
`https://portfolio-api-{projectNumber}.{region}.run.app`, as the fixed upstream and identical
default service-token audience. This is an explicit first-consumer support boundary, not a claim
that other valid Cloud Run URL formats do not exist. Custom domains, hashed Run URLs and custom
audiences are not enabled by this contract; existing v1/disabled-route profiles may still contain
their previously supported canonical origins. Hub uses its same-profile canonical HTTPS origin,
has no IAM-token audience, and remains responsible for Firebase owner authorization on its public
service. Custom-domain ownership is operator-supplied metadata, not independently attested here.

```sh
python3 infra/gcp/deployment_profile.py compile-web-owner \
  --profile .deployment/profile.json \
  --output-dir .deployment/web-owner-review
```

There is no `--target` argument for this Web-only action. It produces exactly three private files
with the existing `0700` directory, `0600` files and no-overwrite rules:

| File                              | Closed contents and future use                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `web-owner-server.candidate.json` | Version 1, selected instance, `target=web`, the existing canonical Web target projection's SHA-256 and six fixed server environment values. This is not a Terraform variable file.               |
| `web-owner-public.candidate.json` | Version 1, selected instance, `target=web`, server configuration SHA-256 and only the two boolean public flags. No upstream, audience, Firebase server setting, token or environment dictionary. |
| `manifest.json`                   | Input/Web/server/file-byte hashes, `approval=not_requested` and `productionActivation=false`. Stdout prints only this manifest.                                                                  |

The server file's `environment` has exactly these string-valued names:

- `FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID`: the selected project when at least one route is enabled,
  otherwise empty. It is derived rather than an independently editable Firebase project.
- `FOLIOVIEW_PORTFOLIO_OWNER_ENABLED`: `"true"` or `"false"`.
- `FOLIOVIEW_PORTFOLIO_ORIGIN` and `FOLIOVIEW_PORTFOLIO_AUDIENCE`: the same validated Portfolio
  origin when enabled, otherwise both empty.
- `FOLIOVIEW_HUB_OWNER_ENABLED`: `"true"` or `"false"`.
- `FOLIOVIEW_HUB_ORIGIN`: the validated Hub origin when enabled, otherwise empty.

The public file is a transport envelope for future build configuration, not a browser response to
publish wholesale. Its `flags` object is exactly `{"portfolio": bool, "agentHub": bool}`; a later
Web consumer explicitly maps these flags into its reviewed public build names. The existing nine
build substitutions are unchanged. Metadata URLs are not secrets, but a browser never selects a
server forwarding destination.

### Future consumer validation and delivery boundary

The structural contracts are [web-owner-server.schema.json](web-owner-server.schema.json) and
[web-owner-public.schema.json](web-owner-public.schema.json). Parsers require canonical ASCII
JSON of at most 4000 bytes and reject duplicate/unknown fields, non-JSON constants and mixed
contexts. Files have a terminal newline for storage; remove exactly that writer newline before
calling the canonical-byte parsers, without reserializing arbitrary input first.

A future INF-009 consumer must obtain both the existing selected Web target projection and an
independently reviewed server-configuration hash from trusted configuration metadata. It must not
accept a hash supplied by the browser or merely trust a candidate manifest placed beside an
untrusted file. With `instance` parsed by the existing `parse_target` and `server_hash` independently
pinned:

```python
server = parse_web_owner_server(server_bytes, instance=instance, expected_sha256=server_hash)
public = parse_web_owner_public(
    public_bytes,
    server=server,
    instance=instance,
    expected_server_sha256=server_hash,
)
```

The server configuration is bound to the entire existing Web projection, including project,
region, source, image, runtime account and adoption UIDs, without creating independently divergent
copies of those values. The public flags must match that pinned server configuration. A whole
bundle from another instance or a modified UID/source fails rather than falling back. These
digests bind selected inputs; they do not attest live ownership or authorize cloud changes.

WEB-002 separately implements fixed owner routes and tests, first Portfolio and then Hub in its own
Web PR. INF-008 separately grants only the approved Portfolio invoker. INF-009 later reviews and
consumes this contract, configures server/public settings, and enables each path only after actual
authorization and transport acceptance. Hub Muse OAuth/REST/discovery/JWKS do not pass through
this owner proxy. No all-protocol gateway, service credentials, account keys, decryptor, new
service, cloud plan/apply or production enablement is introduced by this foundation.

## Verification

```sh
python3 -m unittest discover -s infra/gcp/tests -p test_deployment_profile.py -v
python3 -m unittest discover -s infra/gcp/tests -p test_deployment_instances.py -v
python3 -m unittest discover -s infra/gcp/tests -p test_web_owner_configuration.py -v
```

Tests render two independent synthetic projects/regions/sources, exercise the real existing policy
validator on an isolated temporary root, compare bootstrap/Web variable shapes, reject mixed
projects/images/anchors and secret/unknown fields, verify actual file-byte hashes/private modes,
and prove an existing policy is not modified. They perform no cloud calls or Terraform execution.
The owner-configuration suite additionally checks pre-change target/input digests, v1/v2 default
compatibility, independent flags, missing Hub, exact server/public hash binding, hostile metadata,
fixed environment fields, private CLI output and unchanged active-consumer inputs.
