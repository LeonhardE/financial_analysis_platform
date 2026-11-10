variable "stage" {
  description = "none is inert; resources prepares this target; creation/runtime launch exactly one explicitly approved VM mode. Actual apply/online acceptance is separate."
  type        = string
  default     = "none"
  nullable    = false
  validation {
    condition     = contains(["none", "resources", "creation", "runtime"], var.stage)
    error_message = "Use only none/resources/creation/runtime; no arbitrary mode or implicit activation."
  }
}

variable "deployment" {
  description = "Explicit single Executor project/zone/identities. No project/billing/prototype default or arbitrary VM size."
  type = object({
    project_id          = string
    region              = string
    zone                = string
    instance_name       = string
    artifact_repository = string
    runtime_account_id  = string
    creation_account_id = string
    build_account_id    = string
    subnet_cidr         = string
  })
  nullable = false
  validation {
    condition = (
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.deployment.project_id)) &&
      can(regex("^[a-z]+(-[a-z0-9]+)+[0-9]$", var.deployment.region)) &&
      can(regex("^${var.deployment.region}-[a-z]$", var.deployment.zone)) &&
      can(regex("^[a-z][a-z0-9-]{0,38}[a-z0-9]$", var.deployment.instance_name)) &&
      can(regex("^[a-z][a-z0-9-]{1,62}$", var.deployment.artifact_repository)) &&
      alltrue([for id in [var.deployment.runtime_account_id, var.deployment.creation_account_id, var.deployment.build_account_id] : can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", id))]) &&
      length(toset([var.deployment.runtime_account_id, var.deployment.creation_account_id, var.deployment.build_account_id])) == 3
    )
    error_message = "Use canonical project/region/zone, a bounded instance name and three distinct keyless account IDs."
  }
  validation {
    condition     = can(cidrnetmask(var.deployment.subnet_cidr)) && can(regex("^10\\.[0-9]+\\.[0-9]+\\.[0-9]+/24$", var.deployment.subnet_cidr))
    error_message = "Explicitly select one private 10/8 IPv4 /24 subnet; no default/foreign network."
  }
}

variable "policy" {
  description = "Independently reviewed D1 public identity output; this root grants it exact VM read only and creates no Policy resource."
  type        = object({ project_id = string, runtime_service_account = string })
  nullable    = false
  validation {
    condition = (
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.policy.project_id)) &&
      var.policy.project_id != var.deployment.project_id &&
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.policy.project_id}\\.iam\\.gserviceaccount\\.com$", var.policy.runtime_service_account))
    )
    error_message = "Policy must be a distinct trusted project and exact keyless identity; never self-authorize the Executor operator."
  }
}

variable "launch" {
  description = "Reviewed immutable build plus fixed public startup sources. Only creation/runtime need it; all values are public, never private JWKs/tokens."
  type = object({
    image                    = string
    confidential_space_image = string
    root_key_id              = string
    config_object            = optional(string)
    native_config_object     = optional(string)
    native_config_sha256     = optional(string)
    draft_object             = optional(string)
    permit_object            = optional(string)
    root_jwk_object          = optional(string)
    native_enabled           = optional(bool, false)
  })
  default = null
  validation {
    condition     = !contains(["creation", "runtime"], var.stage) || var.launch != null
    error_message = "A VM requires a separately reviewed exact build, production boot image and public source pins."
  }
  validation {
    condition = var.launch == null ? true : (
      can(regex("^${var.deployment.region}-docker\\.pkg\\.dev/${var.deployment.project_id}/${var.deployment.artifact_repository}/agent-executor-api@sha256:[a-f0-9]{64}$", var.launch.image)) &&
      can(regex("^projects/confidential-space-images/global/images/confidential-space-[0-9]{6}$", var.launch.confidential_space_image)) &&
      try(tonumber(reverse(split("-", var.launch.confidential_space_image))[0]) >= 261001, false) &&
      can(regex("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$", var.launch.root_key_id))
    )
    error_message = "Pin this target's immutable image and a numbered production Confidential Space image (261001+), with independent Root thumbprint. No debug/family/tag image."
  }
  validation {
    condition = var.launch == null ? true : alltrue([for uri in [
      var.launch.config_object, var.launch.native_config_object, var.launch.draft_object,
      var.launch.permit_object, var.launch.root_jwk_object,
      ] : uri == null ? true : (
      length(uri) <= 256 && can(regex("^gs://${var.deployment.project_id}-executor-config/executor-config/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\\.json$", uri))
    )])
    error_message = "Only this target's bounded executor-config JSON objects are startup sources; no arbitrary URL, bucket, traversal, query or fragment."
  }
  validation {
    condition = var.launch == null ? true : (
      var.stage == "creation" ? (
        var.launch.draft_object != null && var.launch.permit_object != null && var.launch.root_jwk_object != null &&
        var.launch.config_object == null && var.launch.native_config_object == null && var.launch.native_config_sha256 == null && !var.launch.native_enabled
        ) : var.stage == "runtime" ? (
        var.launch.config_object != null && var.launch.draft_object == null && var.launch.permit_object == null && var.launch.root_jwk_object == null &&
        (var.launch.native_enabled ? (
          var.launch.native_config_object != null && can(regex("^[a-f0-9]{64}$", var.launch.native_config_sha256))
        ) : var.launch.native_config_object == null && var.launch.native_config_sha256 == null)
      ) : true
    )
    error_message = "Creation requires only its three public sources with native/runtime off. Runtime requires core source and optional complete native pins, without creation input."
  }
}

variable "instance_protection_enabled" {
  description = "Keep true. Reviewed replacement requires separate full plans to disable protection, replace at fixed name, then restore it; never bypass with -target or empty state."
  type        = bool
  default     = true
  nullable    = false
}

variable "acme_http01_enabled" {
  description = "Separate explicit opt-in for public HTTP-01 token objects on port 80. No TLS termination, state, config, private key or analysis endpoint is published."
  type        = bool
  default     = false
  nullable    = false
}
