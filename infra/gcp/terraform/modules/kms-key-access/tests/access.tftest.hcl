mock_provider "google" {
  override_during = plan
}

variables {
  project_id    = "financial-analysis-512202"
  crypto_key_id = "projects/financial-analysis-512202/locations/northamerica-northeast2/keyRings/platform/cryptoKeys/delegation"
  usage         = "delegation_signer"
}

run "empty_members_grant_no_access" {
  command = plan

  assert {
    condition = (
      length(google_kms_crypto_key_iam_member.access) == 0 &&
      length(output.grants) == 0 &&
      output.crypto_key_id == var.crypto_key_id &&
      output.usage == "delegation_signer" &&
      output.role == "roles/cloudkms.signer"
    )
    error_message = "An existing key reference alone must not create a grant or an implicit decrypt capability."
  }
}

run "signer_is_exact_key_and_custom_runtime_only" {
  command = plan

  variables {
    members = { runtime = "fa-agent-hub-runtime@financial-analysis-512202.iam.gserviceaccount.com" }
  }

  assert {
    condition = (
      length(google_kms_crypto_key_iam_member.access) == 1 &&
      google_kms_crypto_key_iam_member.access["runtime"].crypto_key_id == var.crypto_key_id &&
      google_kms_crypto_key_iam_member.access["runtime"].role == "roles/cloudkms.signer" &&
      google_kms_crypto_key_iam_member.access["runtime"].member == "serviceAccount:fa-agent-hub-runtime@financial-analysis-512202.iam.gserviceaccount.com" &&
      output.grants["runtime"].role == "roles/cloudkms.signer"
    )
    error_message = "Delegation signing must bind only the exact existing key and custom runtime with the signing-only role."
  }
}

run "public_key_access_is_separate_from_signing" {
  command = plan

  variables {
    usage   = "public_key_viewer"
    members = { reader = "fa-agent-hub-runtime@financial-analysis-512202.iam.gserviceaccount.com" }
  }

  assert {
    condition = (
      length(google_kms_crypto_key_iam_member.access) == 1 &&
      google_kms_crypto_key_iam_member.access["reader"].crypto_key_id == var.crypto_key_id &&
      google_kms_crypto_key_iam_member.access["reader"].role == "roles/cloudkms.publicKeyViewer" &&
      output.role == "roles/cloudkms.publicKeyViewer"
    )
    error_message = "Reading public keys must not implicitly allow signing, decrypting or key administration."
  }
}

run "firestore_storage_key_access_is_agent_only" {
  command = plan

  variables {
    usage          = "firestore_cmek"
    project_number = "630815932903"
    members        = { firestore = "service-630815932903@gcp-sa-firestore.iam.gserviceaccount.com" }
  }

  assert {
    condition = (
      length(google_kms_crypto_key_iam_member.access) == 1 &&
      google_kms_crypto_key_iam_member.access["firestore"].crypto_key_id == var.crypto_key_id &&
      google_kms_crypto_key_iam_member.access["firestore"].role == "roles/cloudkms.cryptoKeyEncrypterDecrypter" &&
      google_kms_crypto_key_iam_member.access["firestore"].member == "serviceAccount:service-630815932903@gcp-sa-firestore.iam.gserviceaccount.com"
    )
    error_message = "Firestore CMEK must use only the exact owning project's service agent at the selected key."
  }
}

run "reject_arbitrary_role_usage" {
  command = plan
  variables { usage = "roles/cloudkms.admin" }
  expect_failures = [var.usage]
}

run "reject_runtime_content_decrypt_usage" {
  command = plan
  variables { usage = "decrypt_user_content" }
  expect_failures = [var.usage]
}

run "reject_cross_project_key_reference" {
  command = plan
  variables { crypto_key_id = "projects/another-project/locations/northamerica-northeast2/keyRings/platform/cryptoKeys/delegation" }
  expect_failures = [var.crypto_key_id]
}

run "reject_key_version_as_iam_boundary" {
  command = plan
  variables { crypto_key_id = "projects/financial-analysis-512202/locations/northamerica-northeast2/keyRings/platform/cryptoKeys/delegation/cryptoKeyVersions/1" }
  expect_failures = [var.crypto_key_id]
}

run "reject_short_key_alias" {
  command = plan
  variables { crypto_key_id = "delegation" }
  expect_failures = [var.crypto_key_id]
}

run "reject_wildcard_key" {
  command = plan
  variables { crypto_key_id = "projects/financial-analysis-512202/locations/northamerica-northeast2/keyRings/platform/cryptoKeys/*" }
  expect_failures = [var.crypto_key_id]
}

run "reject_cross_project_signing_runtime" {
  command = plan
  variables { members = { runtime = "fa-agent-hub-runtime@another-project.iam.gserviceaccount.com" } }
  expect_failures = [var.members]
}

run "reject_human_signing_principal" {
  command = plan
  variables { members = { runtime = "person@example.com" } }
  expect_failures = [var.members]
}

run "reject_public_member" {
  command = plan
  variables { members = { runtime = "allUsers" } }
  expect_failures = [var.members]
}

run "reject_prefixed_iam_member" {
  command = plan
  variables { members = { runtime = "serviceAccount:fa-agent-hub-runtime@financial-analysis-512202.iam.gserviceaccount.com" } }
  expect_failures = [var.members]
}

run "reject_default_compute_identity" {
  command = plan
  variables { members = { runtime = "630815932903-compute@developer.gserviceaccount.com" } }
  expect_failures = [var.members]
}

run "reject_duplicate_tuple_aliases" {
  command = plan
  variables {
    members = {
      runtime = "fa-agent-hub-runtime@financial-analysis-512202.iam.gserviceaccount.com"
      alias   = "fa-agent-hub-runtime@financial-analysis-512202.iam.gserviceaccount.com"
    }
  }
  expect_failures = [var.members]
}

run "reject_unstable_logical_member_key" {
  command = plan
  variables { members = { "role/member*" = "fa-agent-hub-runtime@financial-analysis-512202.iam.gserviceaccount.com" } }
  expect_failures = [var.members]
}

run "reject_cmek_grant_to_runtime" {
  command = plan
  variables {
    usage          = "firestore_cmek"
    project_number = "630815932903"
    members        = { runtime = "fa-agent-hub-runtime@financial-analysis-512202.iam.gserviceaccount.com" }
  }
  expect_failures = [var.members]
}

run "reject_wrong_project_firestore_agent" {
  command = plan
  variables {
    usage          = "firestore_cmek"
    project_number = "630815932903"
    members        = { firestore = "service-111111111111@gcp-sa-firestore.iam.gserviceaccount.com" }
  }
  expect_failures = [var.members]
}

run "reject_signer_grant_to_firestore_agent" {
  command = plan
  variables { members = { firestore = "service-630815932903@gcp-sa-firestore.iam.gserviceaccount.com" } }
  expect_failures = [var.members]
}

run "reject_cmek_without_explicit_project_number" {
  command = plan
  variables { usage = "firestore_cmek" }
  expect_failures = [var.project_number]
}

run "reject_project_number_alias" {
  command = plan
  variables { project_number = "financial-analysis-512202" }
  expect_failures = [var.project_number]
}
