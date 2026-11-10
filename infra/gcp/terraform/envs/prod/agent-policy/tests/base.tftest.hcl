# Provider-mocked full plans; never apply, authenticate or execute the controller.
mock_provider "google" { override_during = plan }

variables {
  deployment = {
    project_id           = "demo-policy-alpha"
    region               = "europe-west3"
    artifact_repository  = "policy-images"
    runtime_account_id   = "policy-runtime"
    build_account_id     = "policy-build"
    creation_image       = "europe-west3-docker.pkg.dev/demo-policy-alpha/policy-images/agent-policy-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    operator_project_ids = ["demo-operator-alpha", "demo-executor-alpha"]
  }
}

run "default_none_proposes_no_cloud_resources_or_grants" {
  command = plan
  assert {
    condition = (
      length(google_project_service.policy) == 0 &&
      length(module.runtime_identity) == 0 && length(module.build_identity) == 0 &&
      length(module.agent_policy) == 0 && length(module.witness) == 0 &&
      length(google_kms_key_ring.policy) == 0 && length(google_kms_crypto_key.signing) == 0 &&
      length(google_kms_crypto_key.recovery) == 0 && length(google_storage_bucket.snapshots) == 0 &&
      length(google_artifact_registry_repository_iam_member.build) == 0 &&
      length(google_project_iam_member.build_logging) == 0 &&
      length(google_project_iam_custom_role.authority) == 0 &&
      length(google_kms_crypto_key_iam_member.signing) == 0 &&
      length(google_kms_crypto_key_iam_member.recovery) == 0 &&
      length(google_kms_crypto_key_iam_member.creator) == 0 &&
      length(google_project_iam_member.witness) == 0 &&
      length(google_storage_bucket_iam_member.snapshots) == 0 &&
      length(google_project_iam_member.owner_auth) == 0 &&
      length(google_firebaserules_release.deny_clients) == 0 &&
      output.base.service == null && output.base.witness == null &&
      !output.base.authority_enabled && !output.base.key_release_enabled && !output.base.public_invocation
    )
    error_message = "A default merge must create no API, identity, service, data/key resource or IAM grant."
  }
}

run "resources_prepares_build_without_service_or_placeholder_image" {
  command = plan
  variables {
    stage = "resources"
    deployment = {
      project_id           = "demo-policy-alpha"
      region               = "europe-west3"
      artifact_repository  = "policy-images"
      runtime_account_id   = "policy-runtime"
      build_account_id     = "policy-build"
      operator_project_ids = ["demo-operator-alpha"]
    }
  }
  assert {
    condition = (
      length(module.agent_policy) == 0 && output.base.service == null &&
      length(google_artifact_registry_repository.policy) == 1 &&
      length(module.build_identity) == 1 && length(module.witness) == 1 &&
      length(google_kms_crypto_key.signing) == 1 && !output.base.key_release_enabled
    )
    error_message = "Prepare the build repository/identity and protected resources without creating a service from an invented image."
  }
}

run "base_is_single_target_private_and_authority_closed" {
  command = plan
  variables { stage = "base" }
  assert {
    condition = (
      output.base.project_id == "demo-policy-alpha" &&
      output.base.runtime_service_account == "policy-runtime@demo-policy-alpha.iam.gserviceaccount.com" &&
      output.base.build_service_account == "policy-build@demo-policy-alpha.iam.gserviceaccount.com" &&
      output.creation_configuration.environment.POLICY_ENABLED == "0" &&
      output.creation_configuration.environment.POLICY_KEY_RELEASE_ENABLED == "0" &&
      output.creation_configuration.environment.POLICY_CONFIG == "" &&
      output.creation_configuration.environment.POLICY_STORE_BACKEND == "cloud" &&
      output.creation_configuration.max_instances == 1 &&
      output.creation_configuration.min_instances == 0 &&
      output.creation_configuration.concurrency == 4 &&
      !output.base.authority_enabled && !output.base.key_release_enabled && !output.base.public_invocation &&
      length(google_project_service.policy) == 9
    )
    error_message = "The independent Policy base cannot become active or public through caller environment/configuration."
  }
}

run "policy_keys_are_nonexportable_and_have_no_d1_decrypt_grant" {
  command = plan
  variables { stage = "base" }
  assert {
    condition = (
      google_kms_crypto_key.signing[0].purpose == "ASYMMETRIC_SIGN" &&
      google_kms_crypto_key.signing[0].version_template[0].algorithm == "EC_SIGN_P256_SHA256" &&
      google_kms_crypto_key.recovery[0].purpose == "ENCRYPT_DECRYPT" &&
      google_kms_crypto_key.recovery[0].version_template[0].algorithm == "GOOGLE_SYMMETRIC_ENCRYPTION" &&
      !google_kms_crypto_key.signing[0].skip_initial_version_creation &&
      !google_kms_crypto_key.recovery[0].skip_initial_version_creation &&
      google_kms_crypto_key.recovery[0].rotation_period == "7776000s" &&
      google_kms_crypto_key.signing[0].destroy_scheduled_duration == "2592000s" &&
      google_project_iam_member.build_logging[0].role == "roles/logging.logWriter" &&
      google_project_iam_member.build_logging[0].member == "serviceAccount:policy-build@demo-policy-alpha.iam.gserviceaccount.com" &&
      google_artifact_registry_repository_iam_member.build[0].role == "roles/artifactregistry.writer"
    )
    error_message = "Only fixed ES256 and identity-bound DEK wrapping keys exist; the sole project IAM is build logging, with no KMS/data/deployment grant."
  }
}

run "witness_and_snapshots_are_separate_protected_and_have_no_history_ttl" {
  command = plan
  variables { stage = "base" }
  assert {
    condition = (
      output.base.witness == "projects/demo-policy-alpha/databases/agent-policy-witness" &&
      module.witness[0].database_id == "agent-policy-witness" &&
      length(module.witness[0].ttl_field_names) == 0 &&
      length(module.witness[0].composite_index_names) == 0 &&
      length(google_firestore_field.pointer) == 4 &&
      alltrue([for field in google_firestore_field.pointer : length(field.ttl_config) == 0 && length(field.index_config) == 1 && length(field.index_config[0].indexes) == 0]) &&
      google_storage_bucket.snapshots[0].name == "demo-policy-alpha-policy-snapshots" &&
      google_storage_bucket.snapshots[0].uniform_bucket_level_access &&
      google_storage_bucket.snapshots[0].public_access_prevention == "enforced" &&
      google_storage_bucket.snapshots[0].versioning[0].enabled &&
      !google_storage_bucket.snapshots[0].force_destroy &&
      length(google_storage_bucket.snapshots[0].lifecycle_rule) == 0 &&
      !google_storage_bucket.snapshots[0].retention_policy[0].is_locked &&
      tonumber(google_storage_bucket.snapshots[0].retention_policy[0].retention_period) == 604800 &&
      google_firebaserules_release.deny_clients[0].name == "cloud.firestore/agent-policy-witness" &&
      strcontains(google_firebaserules_ruleset.deny_clients[0].source[0].files[0].content, "allow read, write: if false;")
    )
    error_message = "No backup restore, client SDK or retention timer may select/erase the latest authority; snapshot storage stays private and protected."
  }
}

run "reject_activation_stage" {
  command = plan
  variables { stage = "active" }
  expect_failures = [var.stage]
}
run "reject_operator_project_reuse" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-policy-alpha"
      region               = "europe-west3"
      artifact_repository  = "policy-images"
      runtime_account_id   = "policy-runtime"
      build_account_id     = "policy-build"
      creation_image       = "europe-west3-docker.pkg.dev/demo-policy-alpha/policy-images/agent-policy-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      operator_project_ids = ["demo-policy-alpha"]
    }
  }
  expect_failures = [var.deployment]
}
run "reject_mutable_or_other_service_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-policy-alpha"
      region               = "europe-west3"
      artifact_repository  = "policy-images"
      runtime_account_id   = "policy-runtime"
      build_account_id     = "policy-build"
      creation_image       = "europe-west3-docker.pkg.dev/demo-policy-alpha/policy-images/agent-executor-api:latest"
      operator_project_ids = ["demo-operator-alpha"]
    }
  }
  expect_failures = [var.deployment]
}
run "reject_shared_build_runtime_identity_and_unbounded_retention" {
  command = plan
  variables {
    deployment = {
      project_id                 = "demo-policy-alpha"
      region                     = "europe-west3"
      artifact_repository        = "policy-images"
      runtime_account_id         = "policy-runtime"
      build_account_id           = "policy-runtime"
      creation_image             = "europe-west3-docker.pkg.dev/demo-policy-alpha/policy-images/agent-policy-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      operator_project_ids       = ["demo-operator-alpha"]
      snapshot_retention_seconds = 0
    }
  }
  expect_failures = [var.deployment]
}

run "reject_base_without_successful_build" {
  command = plan
  variables {
    stage = "base"
    deployment = {
      project_id           = "demo-policy-alpha"
      region               = "europe-west3"
      artifact_repository  = "policy-images"
      runtime_account_id   = "policy-runtime"
      build_account_id     = "policy-build"
      operator_project_ids = ["demo-operator-alpha"]
    }
  }
  expect_failures = [var.deployment]
}
