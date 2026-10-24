variable "project_id" {
  description = "Project owning this single service. APIs must already be enabled by its root."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use a Google Cloud project ID, not a project number."
  }
}

variable "region" {
  description = "Service region; colocate its dependencies in the same region where possible."
  type        = string
  default     = "northamerica-northeast2"
  nullable    = false

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]+$", var.region))
    error_message = "Use a regional location such as northamerica-northeast2."
  }
}

variable "name" {
  description = "One independently deployed Cloud Run service name."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z]([a-z0-9-]{0,47}[a-z0-9])?$", var.name))
    error_message = "Use a lowercase Cloud Run service name of at most 49 characters."
  }
}

variable "image" {
  description = "Creation-only bootstrap image pinned by digest. Existing services preserve their current image; use the image-release pipeline for updates."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[^[:space:]@]+/[^[:space:]@]+@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Provide a registry image with an immutable @sha256 digest, not a tag."
  }
}

variable "runtime_service_account" {
  description = "Explicit keyless service account email; the Compute default account is not used."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.project_id}\\.iam\\.gserviceaccount\\.com$", var.runtime_service_account))
    error_message = "Use an explicit runtime service account in this project."
  }
}

variable "environment" {
  description = "Non-secret environment values; Terraform state and plans contain these values."
  type        = map(string)
  default     = {}
  nullable    = false

  validation {
    condition = alltrue([for name, value in var.environment :
      can(regex("^[A-Za-z_][A-Za-z0-9_]*$", name)) &&
      !contains(["PORT", "K_SERVICE", "K_REVISION", "K_CONFIGURATION"], name) &&
      !startswith(name, "X_GOOGLE_") && value != null
    ])
    error_message = "Use valid non-reserved environment names and non-null values."
  }
}

variable "secret_environment" {
  description = "Environment name to existing same-project Secret Manager resource and numeric version; never secret payloads."
  type = map(object({
    secret  = string
    version = string
  }))
  default  = {}
  nullable = false

  validation {
    condition = alltrue([for name, ref in var.secret_environment :
      can(regex("^[A-Za-z_][A-Za-z0-9_]*$", name)) &&
      !contains(["PORT", "K_SERVICE", "K_REVISION", "K_CONFIGURATION"], name) &&
      !startswith(name, "X_GOOGLE_") &&
      can(regex("^projects/${var.project_id}/secrets/[A-Za-z0-9_-]+$", ref.secret)) &&
      can(regex("^[1-9][0-9]*$", ref.version))
    ])
    error_message = "Secret references need valid non-reserved names, same-project secret IDs and pinned numeric versions."
  }

  validation {
    condition     = length(setintersection(toset(keys(var.environment)), toset(keys(var.secret_environment)))) == 0
    error_message = "Plain and secret environment names must not overlap."
  }
}

variable "port" {
  description = "HTTP container port. Cloud Run injects PORT automatically."
  type        = number
  default     = 8080
  nullable    = false

  validation {
    condition     = var.port >= 1 && var.port <= 65535 && floor(var.port) == var.port
    error_message = "Port must be an integer between 1 and 65535."
  }
}

variable "memory" {
  description = "Memory for the initial one-vCPU request-billed service contract."
  type        = string
  default     = "512Mi"
  nullable    = false

  validation {
    condition     = contains(["256Mi", "512Mi", "1Gi", "2Gi", "4Gi"], var.memory)
    error_message = "The one-vCPU module supports 256Mi, 512Mi, 1Gi, 2Gi or 4Gi."
  }
}

variable "min_instances" {
  description = "Minimum instances; zero permits scale-to-zero. Increasing it incurs idle capacity costs."
  type        = number
  default     = 0
  nullable    = false

  validation {
    condition     = var.min_instances >= 0 && floor(var.min_instances) == var.min_instances
    error_message = "Minimum instances must be a non-negative integer."
  }
}

variable "max_instances" {
  description = "Per-revision scaling limit; one by default. Not a project-wide billing cap."
  type        = number
  default     = 1
  nullable    = false

  validation {
    condition     = var.max_instances >= 1 && floor(var.max_instances) == var.max_instances && var.max_instances >= var.min_instances
    error_message = "Maximum instances must be a positive integer at least as large as the minimum."
  }
}

variable "concurrency" {
  description = "Maximum concurrent requests per container instance."
  type        = number
  default     = 40
  nullable    = false

  validation {
    condition     = var.concurrency >= 1 && var.concurrency <= 1000 && floor(var.concurrency) == var.concurrency
    error_message = "Concurrency must be an integer between 1 and 1000."
  }
}

variable "timeout_seconds" {
  description = "HTTP request timeout. Workers must select their own bounded timeout explicitly."
  type        = number
  default     = 60
  nullable    = false

  validation {
    condition     = var.timeout_seconds >= 1 && var.timeout_seconds <= 3600 && floor(var.timeout_seconds) == var.timeout_seconds
    error_message = "Timeout must be an integer between 1 and 3600 seconds."
  }
}

variable "startup_cpu_boost" {
  description = "Optional extra CPU during startup; disabled by default to keep the initial cost contract explicit."
  type        = bool
  default     = false
  nullable    = false
}

variable "ingress" {
  description = "Network ingress, separate from IAM invocation permissions."
  type        = string
  default     = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  nullable    = false

  validation {
    condition     = contains(["INGRESS_TRAFFIC_INTERNAL_ONLY", "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER", "INGRESS_TRAFFIC_ALL"], var.ingress)
    error_message = "Select a supported explicit Cloud Run ingress mode."
  }
}

variable "allow_unauthenticated" {
  description = "Explicitly grant allUsers run.invoker for a browser-facing service; application authentication is still the caller's responsibility."
  type        = bool
  default     = false
  nullable    = false

  validation {
    condition     = !var.allow_unauthenticated || var.ingress == "INGRESS_TRAFFIC_ALL"
    error_message = "Public invocation requires explicitly selecting INGRESS_TRAFFIC_ALL as well."
  }
}

variable "invoker_service_accounts" {
  description = "Stable caller keys to same-project service account emails, including emails unknown until apply. No project-level role is granted."
  type        = map(string)
  default     = {}
  nullable    = false

  validation {
    condition = alltrue([for email in var.invoker_service_accounts :
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.project_id}\\.iam\\.gserviceaccount\\.com$", email))
    ])
    error_message = "Invoker values must be explicit service account emails in this project."
  }

  validation {
    condition     = length(distinct(values(var.invoker_service_accounts))) == length(var.invoker_service_accounts)
    error_message = "Each invoker email may appear only once to avoid duplicate IAM ownership."
  }
}
