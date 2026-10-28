# These nonsecret instance inputs come from the reviewed Portfolio trigger projection.
# No ambient project, checked-in production default, or arbitrary environment map.
variable "deployment" {
  description = "Explicit adopted Portfolio instance; bind this object to the reviewed source and saved plan."
  type = object({
    project_id           = string
    region               = string
    artifact_repository  = string
    runtime_account_id   = string
    creation_image       = string
    existing_service_uid = string
    web_origin           = string
  })
  nullable = false

  validation {
    condition = (
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.deployment.project_id)) &&
      can(regex("^[a-z]+(-[a-z0-9]+)+[0-9]$", var.deployment.region)) &&
      can(regex("^[a-z][a-z0-9-]{1,62}$", var.deployment.artifact_repository)) &&
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.deployment.runtime_account_id)) &&
      can(regex("^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", var.deployment.existing_service_uid))
    )
    error_message = "Provide canonical project, region, repository, runtime account ID and inventoried service UUID."
  }

  validation {
    condition = can(regex(
      "^${var.deployment.region}-docker\\.pkg\\.dev/${var.deployment.project_id}/${var.deployment.artifact_repository}/portfolio-api@sha256:[a-f0-9]{64}$",
      var.deployment.creation_image,
    ))
    error_message = "Portfolio requires an immutable portfolio-api image in the selected region, project and repository."
  }

  validation {
    condition = try(
      length(var.deployment.web_origin) <= 2048 &&
      can(regex("^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$", var.deployment.web_origin)),
      false,
    )
    error_message = "Use one canonical lowercase HTTPS Web origin, without userinfo, port, path, query or fragment."
  }
}

# Compatibility alias for old private operator files. The selected deployment is
# always authoritative; this input cannot choose another image or a mutable tag.
variable "bootstrap_image" {
  description = "Optional legacy creation-image alias; when supplied it must equal the selected deployment image."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = try(
      var.bootstrap_image == null || var.bootstrap_image == var.deployment.creation_image,
      false,
    )
    error_message = "bootstrap_image must be omitted or exactly equal deployment.creation_image."
  }
}
