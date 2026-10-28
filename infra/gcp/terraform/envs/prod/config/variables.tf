# These nonsecret instance inputs come from the reviewed Config trigger projection.
# No ambient project, checked-in production default, or arbitrary environment map.
variable "deployment" {
  description = "Explicit adopted Config instance; bind this object to the reviewed source and saved plan."
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
      "^${var.deployment.region}-docker\\.pkg\\.dev/${var.deployment.project_id}/${var.deployment.artifact_repository}/config-api@sha256:[a-f0-9]{64}$",
      var.deployment.creation_image,
    ))
    error_message = "Config requires an immutable config-api image in the selected region, project and repository."
  }

  validation {
    condition = try(
      length(var.deployment.web_origin) <= 261 &&
      can(regex("^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$", var.deployment.web_origin)),
      false,
    )
    error_message = "Use one canonical lowercase HTTPS Web origin, without userinfo, port, path, query or fragment."
  }
}
