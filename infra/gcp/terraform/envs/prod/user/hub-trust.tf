# The reviewed, self-contained User deployment projection supplies only these
# four nonsecret settings. Existing deployment inputs default to no Hub trust.
variable "hub_trust" {
  description = "Optional closed User/Hub trust map, pinned by the managed deployment projection."
  type        = map(string)
  default     = null
  nullable    = true

  validation {
    condition = var.hub_trust == null ? true : try(
      toset(keys(var.hub_trust)) == toset([
        "USER_SERVICE_AUDIENCE", "USER_DELEGATION_AUDIENCE",
        "USER_DELEGATION_ISSUER", "USER_TRUSTED_HUB_CALLERS",
        ]) && (
        alltrue([for value in values(var.hub_trust) : value == ""]) || (
          can(regex("^https://user-api-[1-9][0-9]{5,19}\\.${var.deployment.region}\\.run\\.app$", var.hub_trust.USER_SERVICE_AUDIENCE)) &&
          var.hub_trust.USER_DELEGATION_AUDIENCE == "${var.hub_trust.USER_SERVICE_AUDIENCE}/internal/v2" &&
          var.hub_trust.USER_DELEGATION_ISSUER == replace(var.hub_trust.USER_SERVICE_AUDIENCE, "https://user-api-", "https://agent-hub-api-") &&
          length(var.hub_trust.USER_TRUSTED_HUB_CALLERS) <= 4096 &&
          length(keys(jsondecode(var.hub_trust.USER_TRUSTED_HUB_CALLERS))) == 1 &&
          jsonencode(jsondecode(var.hub_trust.USER_TRUSTED_HUB_CALLERS)) == var.hub_trust.USER_TRUSTED_HUB_CALLERS &&
          can(regex("^[1-9][0-9]{0,127}$", keys(jsondecode(var.hub_trust.USER_TRUSTED_HUB_CALLERS))[0])) &&
          can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.deployment.project_id}\\.iam\\.gserviceaccount\\.com$", values(jsondecode(var.hub_trust.USER_TRUSTED_HUB_CALLERS))[0])) &&
          values(jsondecode(var.hub_trust.USER_TRUSTED_HUB_CALLERS))[0] != "${var.deployment.runtime_account_id}@${var.deployment.project_id}.iam.gserviceaccount.com"
        )
      ),
      false,
    )
    error_message = "Use null, four empty trust values, or exact User/Hub audiences and one pinned numeric Hub subject with a distinct same-project runtime email."
  }
}
