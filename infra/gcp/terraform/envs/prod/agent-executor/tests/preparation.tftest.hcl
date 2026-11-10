# Full mock plans only; no credential, cloud API, apply or provisioner execution.
mock_provider "google" { override_during = plan }
variables {
  deployment = {
    project_id          = "demo-executor-alpha"
    region              = "europe-west3"
    zone                = "europe-west3-a"
    instance_name       = "synthetic-executor"
    artifact_repository = "executor-images"
    runtime_account_id  = "executor-runtime"
    creation_account_id = "executor-creation"
    build_account_id    = "executor-build"
    subnet_cidr         = "10.72.0.0/24"
  }
  policy = {
    project_id              = "demo-policy-alpha"
    runtime_service_account = "policy-runtime@demo-policy-alpha.iam.gserviceaccount.com"
  }
}

run "default_none_has_no_resources_or_grants" {
  command = plan
  assert {
    condition = (
      length(google_project_service.executor) == 0 && length(module.identity) == 0 &&
      length(google_compute_instance.executor) == 0 && length(google_storage_bucket.state) == 0 &&
      length(google_storage_bucket.config) == 0 &&
      length(google_compute_network.executor) == 0 && length(google_compute_global_address.ingress) == 0 &&
      length(google_compute_target_tcp_proxy.tls) == 0 && length(google_compute_global_forwarding_rule.tls) == 0 &&
      length(google_project_iam_member.policy_vm_read) == 0 && output.base.instance_id == null &&
      output.base.state_bucket == null && !output.base.kms_decrypt_granted
    )
    error_message = "A source merge must not allocate compute/network/storage, enable APIs or grant authority."
  }
}
run "resources_prepares_build_and_recovery_without_a_vm_or_placeholder_image" {
  command = plan
  variables { stage = "resources" }
  assert {
    condition = (
      length(module.identity) == 3 && length(google_compute_instance.executor) == 0 &&
      length(google_compute_instance_group.executor[0].instances) == 0 &&
      output.base.runtime_service_account == "executor-runtime@demo-executor-alpha.iam.gserviceaccount.com" &&
      output.base.creation_service_account == "executor-creation@demo-executor-alpha.iam.gserviceaccount.com" &&
      google_artifact_registry_repository_iam_member.build[0].role == "roles/artifactregistry.writer" &&
      google_project_iam_member.build_logging[0].member == "serviceAccount:executor-build@demo-executor-alpha.iam.gserviceaccount.com" &&
      length(google_project_iam_member.attest) == 2 && length(google_project_service.executor) == 7 &&
      output.launch_review.image == null && !output.launch_review.attestation_verified
    )
    error_message = "Prepare only this target's actual build/network/state prerequisites; do not fabricate an image or launch a VM."
  }
}
run "tls_crosses_proxy_as_original_encrypted_stream" {
  command = plan
  variables { stage = "resources" }
  assert {
    condition = (
      google_compute_global_forwarding_rule.tls[0].ip_protocol == "TCP" &&
      google_compute_global_forwarding_rule.tls[0].port_range == "443" &&
      google_compute_target_tcp_proxy.tls[0].proxy_header == "NONE" &&
      google_compute_backend_service.tls[0].protocol == "TCP" &&
      google_compute_backend_service.tls[0].port_name == "tee-tls" &&
      google_compute_instance_group.executor[0].named_port[0].port == 8443 &&
      google_compute_health_check.tcp[0].tcp_health_check[0].port == 8443 &&
      !google_compute_health_check.tcp[0].log_config[0].enable &&
      !google_compute_backend_service.tls[0].log_config[0].enable &&
      toset(google_compute_firewall.tls[0].source_ranges) == toset(["130.211.0.0/22", "35.191.0.0/16"]) &&
      one(google_compute_firewall.tls[0].allow).protocol == "tcp" &&
      toset(one(google_compute_firewall.tls[0].allow).ports) == toset(["8443"]) &&
      toset(google_compute_firewall.tls[0].target_service_accounts) == toset([
        "executor-runtime@demo-executor-alpha.iam.gserviceaccount.com", "executor-creation@demo-executor-alpha.iam.gserviceaccount.com"
      ]) && output.base.tls_termination == "measured_executor_only"
    )
    error_message = "Only TCP byte forwarding from 443 to original TEE TLS on 8443 is allowed, with GFE-only ingress; probes/logs cannot claim authority."
  }
}
run "immutable_state_permissions_exclude_list_overwrite_delete_and_configuration_write" {
  command = plan
  variables { stage = "resources" }
  assert {
    condition = (
      google_storage_bucket.state[0].uniform_bucket_level_access &&
      google_storage_bucket.state[0].public_access_prevention == "enforced" &&
      google_storage_bucket.state[0].versioning[0].enabled && !google_storage_bucket.state[0].force_destroy &&
      length(google_storage_bucket.config[0].retention_policy) == 0 &&
      google_storage_bucket.config[0].public_access_prevention == "enforced" &&
      google_storage_bucket.config[0].name != google_storage_bucket.state[0].name &&
      length(google_storage_bucket.state[0].lifecycle_rule) == 0 &&
      !google_storage_bucket.state[0].retention_policy[0].is_locked &&
      google_project_iam_custom_role.objects[0].permissions == toset(["storage.objects.get", "storage.objects.create"]) &&
      google_project_iam_custom_role.config[0].permissions == toset(["storage.objects.get"]) &&
      !strcontains(google_storage_bucket_iam_member.objects["runtime"].condition[0].expression, "executor-enrollment") &&
      strcontains(google_storage_bucket_iam_member.objects["creation"].condition[0].expression, "executor-enrollment/") &&
      strcontains(google_storage_bucket_iam_member.config["runtime"].condition[0].expression, "executor-config/") &&
      !output.base.kms_decrypt_granted
    )
    error_message = "Only bounded immutable state/enrollment prefixes and read-only public config; no listing, overwrite/delete, unencrypted financial output or KMS decrypt."
  }
}
run "independent_policy_reads_only_selected_current_vm" {
  command = plan
  variables { stage = "resources" }
  assert {
    condition = (
      google_project_iam_custom_role.policy_vm_read[0].permissions == toset(["compute.instances.get"]) &&
      google_project_iam_member.policy_vm_read[0].project == "demo-executor-alpha" &&
      google_project_iam_member.policy_vm_read[0].member == "serviceAccount:policy-runtime@demo-policy-alpha.iam.gserviceaccount.com" &&
      google_project_iam_member.policy_vm_read[0].condition[0].expression == "resource.type == 'compute.googleapis.com/Instance' && resource.name.endsWith('/zones/europe-west3-a/instances/synthetic-executor')"
    )
    error_message = "Policy gets exact current-instance metadata only, not compute admin/list, impersonation or another project's IAM."
  }
}
run "creation_uses_production_single_vm_explicit_mode_and_closed_metadata" {
  command = plan
  variables {
    stage = "creation"
    launch = {
      image                    = "europe-west3-docker.pkg.dev/demo-executor-alpha/executor-images/agent-executor-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      confidential_space_image = "projects/confidential-space-images/global/images/confidential-space-261001"
      root_key_id              = "cnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnI"
      draft_object             = "gs://demo-executor-alpha-executor-config/executor-config/connection/draft.json"
      permit_object            = "gs://demo-executor-alpha-executor-config/executor-config/connection/permit.json"
      root_jwk_object          = "gs://demo-executor-alpha-executor-config/executor-config/connection/root.json"
    }
  }
  assert {
    condition = (
      length(google_compute_instance.executor) == 1 && google_compute_instance.executor[0].machine_type == "n2d-standard-2" &&
      google_compute_instance.executor[0].confidential_instance_config[0].enable_confidential_compute &&
      google_compute_instance.executor[0].confidential_instance_config[0].confidential_instance_type == "SEV" &&
      google_compute_instance.executor[0].shielded_instance_config[0].enable_secure_boot &&
      google_compute_instance.executor[0].shielded_instance_config[0].enable_vtpm &&
      !google_compute_instance.executor[0].scheduling[0].automatic_restart &&
      google_compute_instance.executor[0].deletion_protection &&
      google_compute_instance.executor[0].service_account[0].email == "executor-creation@demo-executor-alpha.iam.gserviceaccount.com" &&
      google_compute_instance.executor[0].metadata["tee-nonroot-container"] == "true" &&
      google_compute_instance.executor[0].metadata["tee-container-log-redirect"] == "false" &&
      google_compute_instance.executor[0].metadata["tee-env-EXECUTOR_CREATION_ENABLED"] == "1" &&
      google_compute_instance.executor[0].metadata["tee-env-EXECUTOR_ENABLED"] == "0" &&
      google_compute_instance.executor[0].metadata["tee-env-EXECUTOR_NATIVE_ENABLED"] == "0" &&
      !contains(keys(google_compute_instance.executor[0].metadata), "tee-cmd") &&
      !contains(keys(google_compute_instance.executor[0].metadata), "tee-mount") &&
      !contains(keys(google_compute_instance.executor[0].metadata), "startup-script") &&
      !output.launch_review.full_environment_observed && !output.launch_review.attestation_verified
    )
    error_message = "Exactly one production SEV VM with original fixed command, dedicated creator, off financial gates and no operator command/mount/debug path."
  }
}
run "runtime_keeps_original_recovery_path_with_explicit_native_pins" {
  command = plan
  variables {
    stage = "runtime"
    launch = {
      image                    = "europe-west3-docker.pkg.dev/demo-executor-alpha/executor-images/agent-executor-api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      confidential_space_image = "projects/confidential-space-images/global/images/confidential-space-261001"
      root_key_id              = "cnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnI"
      config_object            = "gs://demo-executor-alpha-executor-config/executor-config/connection/runtime.json"
      native_config_object     = "gs://demo-executor-alpha-executor-config/executor-config/connection/native.json"
      native_config_sha256     = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      native_enabled           = true
    }
  }
  assert {
    condition = (
      length(google_compute_instance.executor) == 1 &&
      google_compute_instance.executor[0].service_account[0].email == "executor-runtime@demo-executor-alpha.iam.gserviceaccount.com" &&
      google_compute_instance.executor[0].metadata["tee-env-EXECUTOR_CREATION_ENABLED"] == "0" &&
      google_compute_instance.executor[0].metadata["tee-env-EXECUTOR_ENABLED"] == "1" &&
      google_compute_instance.executor[0].metadata["tee-env-EXECUTOR_NATIVE_CONFIG_SHA256"] == var.launch.native_config_sha256 &&
      !contains(keys(google_compute_instance.executor[0].metadata), "tee-env-EXECUTOR_DRAFT_OBJECT") &&
      output.launch_review.args == ["python", "-m", "app.main"] &&
      !output.launch_review.actual_state_head_observed && !output.base.kms_decrypt_granted
    )
    error_message = "Runtime uses fixed-image restoration and explicit native hash, never creation inputs or metadata that asserts live authorization."
  }
}
run "reject_missing_launch_and_unrecognized_stage" {
  command = plan
  variables { stage = "debug" }
  expect_failures = [var.stage]
}
run "reject_vm_without_launch" {
  command = plan
  variables { stage = "runtime" }
  expect_failures = [var.launch]
}
run "reject_wrong_target_image_debug_boot_and_free_form_source" {
  command = plan
  variables {
    stage = "runtime"
    launch = {
      image                    = "europe-west3-docker.pkg.dev/demo-executor-alpha/executor-images/agent-policy-api:latest"
      confidential_space_image = "projects/confidential-space-images/global/images/family/confidential-space-debug"
      root_key_id              = "not-a-root-pin"
      config_object            = "https://attacker.example/runtime.json"
    }
  }
  expect_failures = [var.launch]
}
run "reject_incomplete_native_or_mixed_creation_sources" {
  command = plan
  variables {
    stage = "runtime"
    launch = {
      image                    = "europe-west3-docker.pkg.dev/demo-executor-alpha/executor-images/agent-executor-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      confidential_space_image = "projects/confidential-space-images/global/images/confidential-space-261001"
      root_key_id              = "cnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnI"
      config_object            = "gs://demo-executor-alpha-executor-config/executor-config/runtime.json"
      draft_object             = "gs://demo-executor-alpha-executor-config/executor-config/draft.json"
      native_enabled           = true
    }
  }
  expect_failures = [var.launch]
}
run "reject_policy_self_authorization" {
  command = plan
  variables {
    policy = {
      project_id              = "demo-executor-alpha"
      runtime_service_account = "executor-runtime@demo-executor-alpha.iam.gserviceaccount.com"
    }
  }
  expect_failures = [var.policy]
}

run "second_project_and_region_do_not_reuse_author_infrastructure" {
  command = plan
  variables {
    stage = "resources"
    deployment = {
      project_id          = "demo-executor-beta"
      region              = "us-central1"
      zone                = "us-central1-b"
      instance_name       = "another-executor"
      artifact_repository = "other-images"
      runtime_account_id  = "other-runtime"
      creation_account_id = "other-creation"
      build_account_id    = "other-build"
      subnet_cidr         = "10.74.0.0/24"
    }
    policy = {
      project_id              = "demo-policy-beta"
      runtime_service_account = "other-policy@demo-policy-beta.iam.gserviceaccount.com"
    }
  }
  assert {
    condition = (
      output.base.state_bucket == "demo-executor-beta-executor-state" &&
      output.base.config_bucket == "demo-executor-beta-executor-config" &&
      google_compute_subnetwork.executor[0].region == "us-central1" &&
      google_artifact_registry_repository.executor[0].repository_id == "other-images" &&
      output.base.creation_service_account == "other-creation@demo-executor-beta.iam.gserviceaccount.com" &&
      strcontains(google_project_iam_member.policy_vm_read[0].condition[0].expression, "/zones/us-central1-b/instances/another-executor")
    )
    error_message = "Every resource/identity/location derives from the selected target, never a checked-in author deployment."
  }
}
