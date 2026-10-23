variable "project_id" {
  description = "Project ID that owns the trigger, connected repository, and build identity."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use a Google Cloud project ID."
  }
}

variable "region" {
  description = "Region of the existing Cloud Build v2 repository and new trigger."
  type        = string
  nullable    = false
  default     = "northamerica-northeast2"

  validation {
    condition     = can(regex("^[a-z]+(-[a-z]+)+[0-9]+$", var.region))
    error_message = "Use a regional Cloud Build location."
  }
}

variable "name" {
  description = "Unique trigger name for this one service or client."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$", var.name))
    error_message = "Use a trigger name of 1–64 letters, digits, underscores, or hyphens, starting with a letter or digit."
  }
}

variable "description" {
  description = "Human-readable purpose of the trigger."
  type        = string
  nullable    = false
  default     = "Build one service or client from main."
}

variable "repository_id" {
  description = "Full existing Cloud Build v2 repository resource name, using this project ID and region."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^projects/${var.project_id}/locations/${var.region}/connections/[^/]+/repositories/[^/]+$", var.repository_id))
    error_message = "The connected repository must belong to the trigger's project and region."
  }
}

variable "build_service_account" {
  description = "Full existing service account resource name used to run the build. No IAM roles are granted here."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^projects/${var.project_id}/serviceAccounts/[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.project_id}\\.iam\\.gserviceaccount\\.com$", var.build_service_account))
    error_message = "Use a full same-project user-managed service account resource name."
  }
}

variable "filename" {
  description = "Repository-relative YAML build configuration path; absolute paths and traversal are rejected."
  type        = string
  nullable    = false

  validation {
    condition = (
      can(regex("^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*\\.ya?ml$", var.filename)) &&
      alltrue([for segment in split("/", var.filename) : !contains([".", ".."], segment)])
    )
    error_message = "Use a repository-relative .yaml or .yml path without traversal."
  }
}

variable "included_files" {
  description = "Explicit files or directory-scoped globs for this target and its shared dependencies. Root-wide wildcard patterns are rejected."
  type        = list(string)
  nullable    = false

  validation {
    condition = length(var.included_files) > 0 && alltrue([for path in var.included_files : (
      can(regex("^[A-Za-z0-9_.-]+(/[^\\r\\n]+)?$", path)) &&
      !strcontains(path, "\\") &&
      alltrue([for segment in split("/", path) : !contains(["", ".", ".."], segment)])
    )])
    error_message = "Provide nonempty relative file paths or directory-scoped globs, without root wildcards or traversal."
  }
}

variable "ignored_files" {
  description = "Paths ignored by push filtering. Documentation-only changes do not build by default."
  type        = list(string)
  nullable    = false
  default     = ["**/*.md"]

  validation {
    condition = alltrue([for path in var.ignored_files : (
      path != "" && !startswith(path, "/") &&
      !strcontains(path, "\\") && !can(regex("[\\r\\n]", path)) &&
      alltrue([for segment in split("/", path) : !contains(["", ".", ".."], segment)])
    )])
    error_message = "Ignored file patterns must be nonempty relative paths without traversal."
  }
}

variable "substitutions" {
  description = "Nonsecret build metadata or environment references. Never pass credentials; region and deployment mode are owned by this module."
  type        = map(string)
  nullable    = false
  default     = {}

  validation {
    condition = alltrue([for key, value in var.substitutions : (
      value != null && can(regex("^_[A-Z][A-Z0-9_]*$", key)) &&
      !contains(["_REGION", "_DEPLOY_SERVICE"], key)
    )])
    error_message = "Use custom _UPPER_CASE substitution names and non-null values; _REGION and _DEPLOY_SERVICE are reserved."
  }
}

variable "disabled" {
  description = "Keep true until the consuming target's trigger, permissions, and rollout are reviewed."
  type        = bool
  nullable    = false
  default     = true
}

variable "deploy_enabled" {
  description = "Enable automatic deployment only after the shared release and Terraform ownership compatibility work is complete."
  type        = bool
  nullable    = false
  default     = false
}
