# These nonsecret instance inputs come from the reviewed User trigger projection.
# No ambient project, checked-in production default, or arbitrary environment map.
variable "deployment" {
  description = "Explicit adopted User instance; bind this object to the reviewed source and saved plan."
  type = object({
    project_id           = string
    region               = string
    artifact_repository  = string
    runtime_account_id   = string
    creation_image       = string
    existing_service_uid = string
    web_origin           = string
    market_origin        = string
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
      "^${var.deployment.region}-docker\\.pkg\\.dev/${var.deployment.project_id}/${var.deployment.artifact_repository}/user-api@sha256:[a-f0-9]{64}$",
      var.deployment.creation_image,
    ))
    error_message = "User requires an immutable user-api image in the selected region, project and repository."
  }

  validation {
    condition = try(
      alltrue([for origin in [var.deployment.web_origin, var.deployment.market_origin] :
        length(origin) <= 261 &&
        can(regex("^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$", origin))
      ]) && var.deployment.web_origin != var.deployment.market_origin,
      false,
    )
    error_message = "Use distinct canonical lowercase HTTPS Web and Market origins, without userinfo, port, path, query or fragment."
  }
}
