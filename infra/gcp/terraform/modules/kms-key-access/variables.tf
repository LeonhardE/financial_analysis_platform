variable "project_id" {
  description = "Project owning the existing CryptoKey and the explicitly authorized workload."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use a valid 6-30 character Google Cloud project ID."
  }
}

variable "crypto_key_id" {
  description = "Full same-project existing CryptoKey reference, never a CryptoKeyVersion, alias, payload or wildcard."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^projects/${var.project_id}/locations/[a-z][a-z0-9-]{0,62}/keyRings/[A-Za-z0-9_-]{1,63}/cryptoKeys/[A-Za-z0-9_-]{1,63}$", var.crypto_key_id))
    error_message = "Use a full same-project projects/PROJECT/locations/LOCATION/keyRings/RING/cryptoKeys/KEY reference without a version or wildcard."
  }
}

variable "usage" {
  description = "One explicit capability with a fixed role: delegation_signer, public_key_viewer or firestore_cmek. No generic decrypt/admin role is accepted."
  type        = string
  nullable    = false

  validation {
    condition     = contains(["delegation_signer", "public_key_viewer", "firestore_cmek"], var.usage)
    error_message = "Choose exactly delegation_signer, public_key_viewer or firestore_cmek."
  }
}

variable "project_number" {
  description = "Explicit owning project's numeric identifier, required only for Firestore CMEK service-agent grants. This module does not discover or create a service agent."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.project_number == null ? var.usage != "firestore_cmek" : can(regex("^[1-9][0-9]{0,19}$", var.project_number))
    error_message = "Firestore CMEK requires the owning project's explicit numeric project_number; supplied values must be positive canonical decimal strings."
  }
}

variable "members" {
  description = "Stable logical keys to unprefixed service-account emails. Signing/public-key use accepts custom same-project runtime accounts; CMEK accepts only this project's Firestore service agent. Empty by default."
  type        = map(string)
  default     = {}
  nullable    = false

  validation {
    condition     = alltrue([for key in keys(var.members) : can(regex("^[a-z][a-z0-9_-]{0,63}$", key))])
    error_message = "Member map keys must be stable lowercase logical identifiers."
  }

  validation {
    condition     = length(distinct(values(var.members))) == length(var.members)
    error_message = "Each key/role/member tuple must have exactly one logical owner; duplicate email aliases are forbidden."
  }

  validation {
    condition = alltrue([for email in values(var.members) : (
      var.usage == "firestore_cmek"
      ? try(email == "service-${var.project_number}@gcp-sa-firestore.iam.gserviceaccount.com", false)
      : can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.project_id}\\.iam\\.gserviceaccount\\.com$", email))
    )])
    error_message = "Signing/public-key members must be custom same-project service accounts; Firestore CMEK members must be only the exact service-PROJECT_NUMBER@gcp-sa-firestore.iam.gserviceaccount.com agent. Do not pass IAM prefixes, humans, public members or runtime accounts for CMEK."
  }
}
