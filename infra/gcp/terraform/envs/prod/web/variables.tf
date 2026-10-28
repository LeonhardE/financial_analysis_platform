variable "deployment" {
  description = "Explicit Web inputs compiled from the selected target-instance-v1 projection; no production defaults or arbitrary runtime environment."
  type        = map(string)
  nullable    = false

  validation {
    condition = try(
      toset(keys(var.deployment)) == toset([
        "project_id", "region", "artifact_repository", "runtime_account_id",
        "creation_image", "existing_service_uid",
      ]) &&
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.deployment.project_id)) &&
      can(regex("^[a-z]+(-[a-z0-9]+)+[0-9]$", var.deployment.region)) &&
      can(regex("^[a-z][a-z0-9-]{1,62}$", var.deployment.artifact_repository)) &&
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.deployment.runtime_account_id)) &&
      can(regex("^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", var.deployment.existing_service_uid)) &&
      can(regex("^${var.deployment.region}-docker\\.pkg\\.dev/${var.deployment.project_id}/${var.deployment.artifact_repository}/market-web@sha256:[a-f0-9]{64}$", var.deployment.creation_image)),
      false,
    )
    error_message = "Provide exactly the six Web deployment fields with matching project/region/repository, an existing UID/runtime account ID and a Web image pinned by SHA-256."
  }
}
