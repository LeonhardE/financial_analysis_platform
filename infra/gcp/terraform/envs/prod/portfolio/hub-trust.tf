# The reviewed, self-contained Portfolio deployment projection supplies only these
# five nonsecret settings. Existing deployment inputs default to no Hub trust.
variable "hub_trust" {
  description = "Optional closed Portfolio/Hub trust map, pinned by the managed deployment projection."
  type        = map(string)
  default     = null
  nullable    = true

  validation {
    condition = var.hub_trust == null ? true : try(
      toset(keys(var.hub_trust)) == toset([
        "PORTFOLIO_SERVICE_AUDIENCE", "PORTFOLIO_DELEGATION_AUDIENCE",
        "PORTFOLIO_DELEGATION_ISSUER", "PORTFOLIO_TRUSTED_HUB_CALLERS",
        "PORTFOLIO_HUB_AUTHORITY_ORIGIN",
        ]) && (
        alltrue([for value in values(var.hub_trust) : value == ""]) || (
          can(regex("^https://portfolio-api-[1-9][0-9]{5,19}\\.${var.deployment.region}\\.run\\.app$", var.hub_trust.PORTFOLIO_SERVICE_AUDIENCE)) &&
          var.hub_trust.PORTFOLIO_DELEGATION_AUDIENCE == "${var.hub_trust.PORTFOLIO_SERVICE_AUDIENCE}/internal/v2" &&
          var.hub_trust.PORTFOLIO_HUB_AUTHORITY_ORIGIN == var.hub_trust.PORTFOLIO_DELEGATION_ISSUER &&
          var.hub_trust.PORTFOLIO_DELEGATION_ISSUER == replace(var.hub_trust.PORTFOLIO_SERVICE_AUDIENCE, "https://portfolio-api-", "https://agent-hub-api-") &&
          length(var.hub_trust.PORTFOLIO_TRUSTED_HUB_CALLERS) <= 4096 &&
          length(keys(jsondecode(var.hub_trust.PORTFOLIO_TRUSTED_HUB_CALLERS))) == 1 &&
          jsonencode(jsondecode(var.hub_trust.PORTFOLIO_TRUSTED_HUB_CALLERS)) == var.hub_trust.PORTFOLIO_TRUSTED_HUB_CALLERS &&
          can(regex("^[1-9][0-9]{0,127}$", keys(jsondecode(var.hub_trust.PORTFOLIO_TRUSTED_HUB_CALLERS))[0])) &&
          can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.deployment.project_id}\\.iam\\.gserviceaccount\\.com$", values(jsondecode(var.hub_trust.PORTFOLIO_TRUSTED_HUB_CALLERS))[0])) &&
          values(jsondecode(var.hub_trust.PORTFOLIO_TRUSTED_HUB_CALLERS))[0] != "${var.deployment.runtime_account_id}@${var.deployment.project_id}.iam.gserviceaccount.com"
        )
      ),
      false,
    )
    error_message = "Use null, five empty trust values, or exact Portfolio/Hub audiences and one pinned numeric Hub subject with a distinct same-project runtime email."
  }
}
