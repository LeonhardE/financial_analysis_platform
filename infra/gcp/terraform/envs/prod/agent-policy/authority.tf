variable "authority" {
  description = "Explicit reviewed public domain and D2 identities. Null keeps D1 closed. Contains no private keys, credentials, Agent keys or implicit Root enrollment."
  type = object({
    owner_subject            = string
    vault_id                 = string
    state_epoch              = string
    root_jwk                 = map(string)
    policy_jwk               = map(string)
    issuer                   = string
    web_origin               = string
    executor_origin          = string
    native_client_id         = string
    native_redirect_uris     = set(string)
    auth_project_id          = string
    executor_project_id      = string
    creator_service_account  = string
    executor_service_account = string
  })
  default = null
  validation {
    condition     = var.authority == null ? true : var.stage == "base"
    error_message = "Authority bindings require the independently reviewed base service and an actual immutable image."
  }
  validation {
    condition = var.authority == null ? true : (
      can(regex("^[a-f0-9]{64}$", var.authority.owner_subject)) &&
      alltrue([for id in [var.authority.vault_id, var.authority.state_epoch, var.authority.native_client_id] :
        can(regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", id))
      ]) &&
      alltrue([for jwk in [var.authority.root_jwk, var.authority.policy_jwk] :
        toset(keys(jwk)) == toset(["kty", "crv", "x", "y"]) &&
        try(jwk.kty == "EC" && jwk.crv == "P-256", false) &&
        alltrue([for k in ["x", "y"] : can(regex("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$", lookup(jwk, k, "")))])
      ]) && var.authority.root_jwk != var.authority.policy_jwk
    )
    error_message = "Use a canonical Owner digest, bounded IDs and distinct public-only EC/P-256 JWKs with canonical 32-byte coordinates; no private/extra key fields. The service also validates actual EC points and the fixed KMS public key."
  }
  validation {
    condition = var.authority == null ? true : (
      alltrue([for origin in [var.authority.issuer, var.authority.web_origin, var.authority.executor_origin] :
        can(regex("^https://[a-z0-9]+([.-][a-z0-9]+)*$", origin)) && length(origin) <= 1024
      ]) &&
      length(toset([var.authority.issuer, var.authority.web_origin, var.authority.executor_origin])) == 3 &&
      length(var.authority.native_redirect_uris) >= 1 && length(var.authority.native_redirect_uris) <= 4 &&
      alltrue([for uri in var.authority.native_redirect_uris :
        can(regex("^https://[a-z0-9]+([.-][a-z0-9]+)*(/[A-Za-z0-9._~%-]+)+$", uri)) && length(uri) <= 2048 &&
        !strcontains(uri, "%") && !strcontains(uri, "/../") && !endswith(uri, "/..")
      ])
    )
    error_message = "Pin distinct HTTPS Policy/Web/executor origins and 1–4 exact native callbacks, without credentials, wildcard, query, fragment, encoded or parent paths."
  }
  validation {
    condition = var.authority == null ? true : (
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.authority.auth_project_id)) &&
      contains(var.deployment.operator_project_ids, var.authority.executor_project_id) &&
      var.authority.executor_project_id != var.deployment.project_id &&
      alltrue([for email in [var.authority.creator_service_account, var.authority.executor_service_account] :
        can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.authority.executor_project_id}\\.iam\\.gserviceaccount\\.com$", email))
      ]) && var.authority.creator_service_account != var.authority.executor_service_account
    )
    error_message = "Review the exact Firebase project and distinct keyless D2 creator/runtime accounts in the inventoried executor project; no group, wildcard or Policy-project executor."
  }
}

variable "authority_enabled" {
  description = "Separate reviewed issuance opt-in, never inferred from a populated config or a healthy service."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.authority_enabled || var.authority != null
    error_message = "Issuance requires explicit public authority bindings and Root bootstrapped state; Terraform never initializes state."
  }
}
variable "key_release_enabled" {
  description = "Separate reviewed DEK-release opt-in after actual Root/TEE/current-VM verification."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.key_release_enabled || var.authority_enabled
    error_message = "Key release requires explicit issuance activation, never a private base or config-only preparation."
  }
}
variable "public_invocation" {
  description = "Explicit OAuth/Owner HTTP reachability; application Google/Root/OAuth authentication still applies. Defaults private."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.public_invocation || var.authority != null
    error_message = "Public reachability requires reviewed authority bindings; it does not activate issuance or key release."
  }
}

locals {
  bound      = var.authority != null
  key_prefix = "projects/${local.project_id}/locations/${local.region}/keyRings/folioview-independent-policy/cryptoKeys"
  policy_config = local.bound ? {
    issuer               = var.authority.issuer
    consentUrl           = "${var.authority.web_origin}/agents"
    ownerSubject         = var.authority.owner_subject
    vaultId              = var.authority.vault_id
    rootJwk              = var.authority.root_jwk
    policyJwk            = var.authority.policy_jwk
    stateEpoch           = var.authority.state_epoch
    provider             = "openai_chatgpt"
    providerClientId     = var.authority.native_client_id
    audience             = "${var.authority.executor_origin}/mcp"
    kmsSigningKeyVersion = "${local.key_prefix}/policy-es256/cryptoKeyVersions/1"
    kmsRecoveryKey       = "${local.key_prefix}/executor-state-dek"
    witnessProject       = local.project_id
    witnessDatabase      = local.database_id
    snapshotBucket       = local.snapshot_name
    clients = [{
      clientId                = var.authority.native_client_id
      redirectUris            = sort(tolist(var.authority.native_redirect_uris))
      tokenEndpointAuthMethod = "none"
      secretSha256            = null
    }]
  } : null
  authority_roles = local.bound ? {
    witness = {
      id          = "folioviewPolicyWitnessCas"
      permissions = ["datastore.databases.get", "datastore.entities.get", "datastore.entities.create", "datastore.entities.update"]
    }
    snapshots = { id = "folioviewPolicySnapshotAppend", permissions = ["storage.objects.get", "storage.objects.create"] }
  } : {}
}

resource "google_project_iam_custom_role" "authority" {
  for_each    = local.authority_roles
  project     = local.project_id
  role_id     = each.value.id
  title       = each.value.id
  permissions = each.value.permissions
  depends_on  = [google_project_service.policy]
}
resource "google_project_iam_member" "witness" {
  count   = local.bound ? 1 : 0
  project = local.project_id
  role    = google_project_iam_custom_role.authority["witness"].name
  member  = "serviceAccount:${local.runtime_email}"
  condition {
    title      = "OnlyIndependentPolicyWitness"
    expression = "resource.type == 'firestore.googleapis.com/Database' && resource.name == 'projects/${local.project_id}/databases/${local.database_id}'"
  }
  depends_on = [module.runtime_identity, module.witness]
}
resource "google_storage_bucket_iam_member" "snapshots" {
  count  = local.bound ? 1 : 0
  bucket = google_storage_bucket.snapshots[0].name
  role   = google_project_iam_custom_role.authority["snapshots"].name
  member = "serviceAccount:${local.runtime_email}"
  condition {
    title      = "OnlyImmutablePolicySnapshots"
    expression = "resource.type == 'storage.googleapis.com/Object' && resource.name.startsWith('projects/_/buckets/${local.snapshot_name}/objects/policy-state/')"
  }
  depends_on = [module.runtime_identity]
}
resource "google_kms_crypto_key_iam_member" "signing" {
  for_each      = local.bound ? toset(["roles/cloudkms.signer", "roles/cloudkms.publicKeyViewer"]) : toset([])
  crypto_key_id = google_kms_crypto_key.signing[0].id
  role          = each.value
  member        = "serviceAccount:${local.runtime_email}"
  depends_on    = [module.runtime_identity]
}
resource "google_kms_crypto_key_iam_member" "recovery" {
  count         = local.bound ? 1 : 0
  crypto_key_id = google_kms_crypto_key.recovery[0].id
  role          = "roles/cloudkms.cryptoKeyDecrypter"
  member        = "serviceAccount:${local.runtime_email}"
  depends_on    = [module.runtime_identity]
}
resource "google_kms_crypto_key_iam_member" "creator" {
  count         = local.bound ? 1 : 0
  crypto_key_id = google_kms_crypto_key.recovery[0].id
  role          = "roles/cloudkms.cryptoKeyEncrypter"
  member        = "serviceAccount:${var.authority.creator_service_account}"
}
resource "google_project_iam_custom_role" "owner_auth" {
  count       = local.bound ? 1 : 0
  project     = var.authority.auth_project_id
  role_id     = "folioviewPolicyOwnerAuthLookup"
  title       = "FolioView Policy Owner authentication lookup"
  permissions = ["firebaseauth.users.get"]
}
resource "google_project_iam_member" "owner_auth" {
  count      = local.bound ? 1 : 0
  project    = var.authority.auth_project_id
  role       = google_project_iam_custom_role.owner_auth[0].name
  member     = "serviceAccount:${local.runtime_email}"
  depends_on = [module.runtime_identity]
}
