variable "project_id" {
  description = "Project ID that owns the runtime identity and every optional grant."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid 6-30 character Google Cloud project ID."
  }
}

variable "account_id" {
  description = "Stable service account ID; changing it would replace the protected identity."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.account_id))
    error_message = "account_id must contain 6-30 lowercase letters, digits, or hyphens, start with a letter, and end with a letter or digit."
  }
}

variable "display_name" {
  description = "Human-readable name; match the existing account exactly when importing."
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.display_name)) > 0
    error_message = "display_name must not be empty."
  }
}

variable "description" {
  description = "Service account description; match the existing account when importing."
  type        = string
  default     = ""
  nullable    = false
}

variable "secret_ids" {
  description = "Stable logical keys mapped to same-project Secret Manager resource IDs; metadata references only, never secret values or versions."
  type        = map(string)
  default     = {}
  nullable    = false

  validation {
    condition     = length(distinct(values(var.secret_ids))) == length(var.secret_ids)
    error_message = "secret_ids must map each secret to exactly one logical key so IAM member ownership is unique."
  }

  validation {
    condition = alltrue([
      for secret_id in values(var.secret_ids) :
      can(regex("^projects/${var.project_id}/secrets/[A-Za-z0-9_-]{1,255}$", secret_id))
    ])
    error_message = "secret_ids must be full projects/{project_id}/secrets/{secret_id} references in this project, without versions or wildcards."
  }
}

variable "deployer_service_accounts" {
  description = "Stable logical keys mapped to same-project service account emails allowed to attach this runtime identity; no token creation or project-wide impersonation."
  type        = map(string)
  default     = {}
  nullable    = false

  validation {
    condition     = length(distinct(values(var.deployer_service_accounts))) == length(var.deployer_service_accounts)
    error_message = "deployer_service_accounts must map each service account to exactly one logical key so IAM member ownership is unique."
  }

  validation {
    condition = alltrue([
      for email in values(var.deployer_service_accounts) :
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.project_id}\\.iam\\.gserviceaccount\\.com$", email))
    ])
    error_message = "deployer_service_accounts must be custom service account emails owned by project_id, without an IAM member prefix."
  }
}
