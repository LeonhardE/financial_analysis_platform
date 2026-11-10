# Full mock plans only. Public keys come from the shared synthetic test vector.
mock_provider "google" { override_during = plan }
variables {
  stage = "base"
  deployment = {
    project_id           = "demo-policy-alpha"
    region               = "europe-west3"
    artifact_repository  = "policy-images"
    runtime_account_id   = "policy-runtime"
    build_account_id     = "policy-build"
    creation_image       = "europe-west3-docker.pkg.dev/demo-policy-alpha/policy-images/agent-policy-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    operator_project_ids = ["demo-executor-alpha"]
  }
  authority = jsondecode(<<-JSON
{
  "owner_subject": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "vault_id": "vault_demo",
  "state_epoch": "epoch_demo",
  "root_jwk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "PtETt4g7TFkGODedsMIc2hZ0LtAlUEi_QzOR03S8IdE",
    "y": "kJkgmszEyKIkyEOvpPTGigkNBNpemIna4vju_OgqN0A"
  },
  "policy_jwk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "dB3VvagX2V5GJlNzIOXVUXmYMCiy-CyZ1QDF7oYk48Q",
    "y": "B3C0apw4X9xWc4NVSIexVI7rkSw1ulynGZX_Is1EgdM"
  },
  "issuer": "https://policy.example.com",
  "web_origin": "https://app.example.com",
  "executor_origin": "https://executor.example.com",
  "native_client_id": "native_client",
  "native_redirect_uris": [
    "https://chatgpt.com/connector_platform/oauth/callback"
  ],
  "auth_project_id": "demo-auth-alpha",
  "executor_project_id": "demo-executor-alpha",
  "creator_service_account": "executor-creator@demo-executor-alpha.iam.gserviceaccount.com",
  "executor_service_account": "executor-runtime@demo-executor-alpha.iam.gserviceaccount.com"
}
JSON
  )
}
run "bound_configuration_keeps_all_activation_gates_closed" {
  command = plan
  assert {
    condition = (
      !output.base.authority_enabled && !output.base.key_release_enabled && !output.base.public_invocation &&
      output.creation_configuration.environment.POLICY_ENABLED == "0" &&
      output.creation_configuration.environment.POLICY_KEY_RELEASE_ENABLED == "0" &&
      output.creation_configuration.environment.FIREBASE_PROJECT_ID == "demo-auth-alpha" &&
      output.creation_configuration.environment.CORS_ORIGINS == "https://app.example.com" &&
      jsondecode(output.creation_configuration.environment.POLICY_CONFIG).audience == "https://executor.example.com/mcp" &&
      jsondecode(output.creation_configuration.environment.POLICY_CONFIG).consentUrl == "https://app.example.com/agents" &&
      jsondecode(output.creation_configuration.environment.POLICY_CONFIG).clients[0].tokenEndpointAuthMethod == "none" &&
      jsondecode(output.creation_configuration.environment.POLICY_CONFIG).clients[0].secretSha256 == null &&
      jsondecode(output.creation_configuration.environment.POLICY_CONFIG).kmsSigningKeyVersion == "projects/demo-policy-alpha/locations/europe-west3/keyRings/folioview-independent-policy/cryptoKeys/policy-es256/cryptoKeyVersions/1" &&
      jsondecode(output.creation_configuration.environment.POLICY_CONFIG).witnessDatabase == "agent-policy-witness"
    )
    error_message = "Public config must pin the actual selected domain/resources with public PKCE, while issuance/release/reachability remain separate and off."
  }
}
run "runtime_only_cas_and_immutable_snapshot_append" {
  command = plan
  assert {
    condition = (
      toset(google_project_iam_custom_role.authority["witness"].permissions) == toset(["datastore.databases.get", "datastore.entities.get", "datastore.entities.create", "datastore.entities.update"]) &&
      google_project_iam_member.witness[0].member == "serviceAccount:policy-runtime@demo-policy-alpha.iam.gserviceaccount.com" &&
      google_project_iam_member.witness[0].condition[0].expression == "resource.type == 'firestore.googleapis.com/Database' && resource.name == 'projects/demo-policy-alpha/databases/agent-policy-witness'" &&
      toset(google_project_iam_custom_role.authority["snapshots"].permissions) == toset(["storage.objects.get", "storage.objects.create"]) &&
      google_storage_bucket_iam_member.snapshots[0].condition[0].expression == "resource.type == 'storage.googleapis.com/Object' && resource.name.startsWith('projects/_/buckets/demo-policy-alpha-policy-snapshots/objects/policy-state/')"
    )
    error_message = "No entity delete/list, DB restore/admin or object overwrite/delete/list grant; the live witness and immutable snapshots are independently bounded."
  }
}
run "fixed_key_signing_and_decrypt_are_policy_only_creator_encrypt_only" {
  command = plan
  assert {
    condition = (
      length(google_kms_crypto_key_iam_member.signing) == 2 &&
      alltrue([for m in google_kms_crypto_key_iam_member.signing : m.member == "serviceAccount:policy-runtime@demo-policy-alpha.iam.gserviceaccount.com"]) &&
      google_kms_crypto_key_iam_member.recovery[0].role == "roles/cloudkms.cryptoKeyDecrypter" &&
      google_kms_crypto_key_iam_member.recovery[0].member == "serviceAccount:policy-runtime@demo-policy-alpha.iam.gserviceaccount.com" &&
      google_kms_crypto_key_iam_member.creator[0].role == "roles/cloudkms.cryptoKeyEncrypter" &&
      google_kms_crypto_key_iam_member.creator[0].member == "serviceAccount:executor-creator@demo-executor-alpha.iam.gserviceaccount.com" &&
      google_project_iam_custom_role.owner_auth[0].project == "demo-auth-alpha" &&
      toset(google_project_iam_custom_role.owner_auth[0].permissions) == toset(["firebaseauth.users.get"]) &&
      google_project_iam_member.owner_auth[0].member == "serviceAccount:policy-runtime@demo-policy-alpha.iam.gserviceaccount.com"
    )
    error_message = "Only Policy can sign/decrypt; the exact independent creator can only wrap. Runtime executor/build/ordinary operators get none. Owner lookup is get-only in its selected auth project."
  }
}
run "explicit_activation_is_separate_from_public_reachability" {
  command = plan
  variables { authority_enabled = true }
  assert {
    condition     = output.base.authority_enabled && !output.base.key_release_enabled && !output.base.public_invocation
    error_message = "Issuance alone cannot enable key release or public invocation."
  }
}
run "each_activation_gate_requires_explicit_selection" {
  command = plan
  variables {
    authority_enabled   = true
    key_release_enabled = true
    public_invocation   = true
  }
  assert {
    condition = (
      output.base.authority_enabled && output.base.key_release_enabled && output.base.public_invocation &&
      output.creation_configuration.environment.POLICY_ENABLED == "1" &&
      output.creation_configuration.environment.POLICY_KEY_RELEASE_ENABLED == "1"
    )
    error_message = "Only explicit reviewed selections can enable each configured gate; mock plans are not live authority or apply approval."
  }
}
run "reject_private_root_jwk" {
  command = plan
  variables { authority = merge(var.authority, { root_jwk = merge(var.authority.root_jwk, { d = "private" }) }) }
  expect_failures = [var.authority]
}
run "reject_duplicate_root_and_policy_key" {
  command = plan
  variables { authority = merge(var.authority, { policy_jwk = var.authority.root_jwk }) }
  expect_failures = [var.authority]
}
run "reject_noncanonical_jwk_coordinate" {
  command = plan
  variables { authority = merge(var.authority, { policy_jwk = merge(var.authority.policy_jwk, { x = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=" }) }) }
  expect_failures = [var.authority]
}
run "reject_wildcard_callback" {
  command = plan
  variables { authority = merge(var.authority, { native_redirect_uris = ["https://chatgpt.com/*"] }) }
  expect_failures = [var.authority]
}
run "reject_callback_query" {
  command = plan
  variables { authority = merge(var.authority, { native_redirect_uris = ["https://chatgpt.com/callback?client=x"] }) }
  expect_failures = [var.authority]
}
run "reject_origin_path" {
  command = plan
  variables { authority = merge(var.authority, { issuer = "https://policy.example.com/untrusted" }) }
  expect_failures = [var.authority]
}
run "reject_policy_project_creator" {
  command = plan
  variables { authority = merge(var.authority, { creator_service_account = "policy-runtime@demo-policy-alpha.iam.gserviceaccount.com" }) }
  expect_failures = [var.authority]
}
run "reject_creator_equals_runtime" {
  command = plan
  variables { authority = merge(var.authority, { creator_service_account = var.authority.executor_service_account }) }
  expect_failures = [var.authority]
}
run "reject_uninventoried_executor_project" {
  command = plan
  variables { authority = merge(var.authority, { executor_project_id = "other-project-alpha" }) }
  expect_failures = [var.authority]
}
run "reject_invalid_owner_identifier" {
  command = plan
  variables { authority = merge(var.authority, { vault_id = "vault:invalid" }) }
  expect_failures = [var.authority]
}
run "reject_bindings_without_base" {
  command = plan
  variables { stage = "resources" }
  expect_failures = [var.authority]
}
run "reject_release_without_issuance" {
  command = plan
  variables { key_release_enabled = true }
  expect_failures = [var.key_release_enabled]
}
run "reject_unbound_activation" {
  command = plan
  variables {
    authority         = null
    authority_enabled = true
  }
  expect_failures = [var.authority_enabled]
}
run "reject_unbound_public_invocation" {
  command = plan
  variables {
    authority         = null
    public_invocation = true
  }
  expect_failures = [var.public_invocation]
}
