variable "project_id" {
  description = "Project ID owning the database and every optional runtime grant."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid 6-30 character Google Cloud project ID."
  }
}

variable "database_id" {
  description = "Exact existing or separately managed Firestore database ID; named ID or (default), never a path or wildcard."
  type        = string
  nullable    = false

  validation {
    condition = (
      var.database_id == "(default)" ||
      (
        can(regex("^[a-z][a-z0-9-]{2,61}[a-z0-9]$", var.database_id)) &&
        !can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.database_id))
      )
    )
    error_message = "database_id must be (default) or 4-63 lowercase letters/digits/hyphens, start with a letter, end alphanumeric and not be UUID-like."
  }
}

variable "runtime_service_accounts" {
  description = "Stable logical keys mapped to same-project custom runtime service account emails; empty grants nothing and only exposes the fixed database scope."
  type        = map(string)
  nullable    = false
  default     = {}

  validation {
    condition = (
      length(var.runtime_service_accounts) <= 10 &&
      alltrue([for key in keys(var.runtime_service_accounts) : can(regex("^[a-z][a-z0-9_-]{0,62}$", key))])
    )
    error_message = "Provide at most ten runtime accounts under stable 1-63 character lowercase logical keys, without paths or punctuation."
  }

  validation {
    condition     = length(distinct(values(var.runtime_service_accounts))) == length(var.runtime_service_accounts)
    error_message = "Each runtime service account email must have exactly one logical owner key."
  }

  validation {
    condition = alltrue([
      for email in values(var.runtime_service_accounts) :
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.project_id}\\.iam\\.gserviceaccount\\.com$", email))
    ])
    error_message = "Runtime members must be custom service account emails in project_id, without a member prefix, wildcard or cross-project principal."
  }
}
