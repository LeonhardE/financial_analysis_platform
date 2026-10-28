variable "project_id" {
  description = "Project that owns the target's private execution resources."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use a Google Cloud project ID."
  }
}

variable "region" {
  description = "Region of the connected Cloud Build repository and state bucket."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z]+(-[a-z]+)+[0-9]+$", var.region))
    error_message = "Use a regional Cloud Build location."
  }
}

variable "target" {
  description = "One service, worker, or client slug, used in immutable execution identifiers."
  type        = string
  nullable    = false

  validation {
    condition = (
      can(regex("^[a-z]([a-z0-9-]{0,13}[a-z0-9])?$", var.target)) &&
      !contains(["repo", "bootstrap", "shared"], var.target)
    )
    error_message = "Use a nonreserved target slug of 1–15 lowercase letters, digits, or hyphens, starting with a letter and ending with a letter or digit."
  }
}

variable "repository_id" {
  description = "Existing same-region Cloud Build v2 repository resource, using the project ID or numeric project resource alias."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^projects/(${var.project_id}|[0-9]+)/locations/${var.region}/connections/[^/]+/repositories/[^/]+$", var.repository_id))
    error_message = "Use the existing project's same-region Cloud Build v2 repository resource."
  }
}

variable "plan_bucket" {
  description = "Existing private saved-plan bucket; access is limited to this target's object prefixes."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$", var.plan_bucket))
    error_message = "Use an existing Cloud Storage bucket name without gs:// or an object prefix."
  }
}

variable "build_metadata_role" {
  description = "Administrative bootstrap's custom cloudbuild.builds.get role resource name."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^projects/${var.project_id}/roles/[A-Za-z0-9_.]+$", var.build_metadata_role))
    error_message = "Pass a same-project custom role for reading build provenance metadata."
  }
}

variable "lock_delete_role" {
  description = "Administrative bootstrap's custom storage.objects.delete role, narrowed to the target's lock by IAM condition."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^projects/${var.project_id}/roles/[A-Za-z0-9_.]+$", var.lock_delete_role))
    error_message = "Pass a same-project custom role for condition-scoped state lock deletion."
  }
}

variable "deployment_config" {
  description = "Optional canonical ASCII JSON projection for this target, pinned in both administrator-owned triggers. Full closed-schema and provenance validation belongs to the runtime loader."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = var.deployment_config == null ? true : try(
      length(var.deployment_config) <= 4000 &&
      can(regex("^[\\x20-\\x7e]+$", var.deployment_config)) &&
      !strcontains(var.deployment_config, "$") &&
      var.deployment_config == jsonencode(jsondecode(var.deployment_config)) &&
      jsondecode(var.deployment_config).schemaVersion == 1 &&
      jsondecode(var.deployment_config).target == var.target &&
      jsondecode(var.deployment_config).project.id == var.project_id &&
      jsondecode(var.deployment_config).region == var.region,
      false,
    )
    error_message = "Use null or canonical printable ASCII JSON of at most 4000 bytes, without dollar substitutions, with schemaVersion 1 and this target/project/region."
  }
}
