variable "owner_environment" {
  description = "Optional closed six-field owner configuration from the pinned managed Web projection."
  type        = map(string)
  default     = null
  nullable    = true

  validation {
    condition = var.owner_environment == null ? true : try(
      toset(keys(var.owner_environment)) == toset([
        "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED",
        "FOLIOVIEW_PORTFOLIO_ORIGIN", "FOLIOVIEW_PORTFOLIO_AUDIENCE",
        "FOLIOVIEW_HUB_OWNER_ENABLED", "FOLIOVIEW_HUB_ORIGIN",
      ]) &&
      contains(["true", "false"], var.owner_environment.FOLIOVIEW_PORTFOLIO_OWNER_ENABLED) &&
      contains(["true", "false"], var.owner_environment.FOLIOVIEW_HUB_OWNER_ENABLED) &&
      var.owner_environment.FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID == (
        var.owner_environment.FOLIOVIEW_PORTFOLIO_OWNER_ENABLED == "true" || var.owner_environment.FOLIOVIEW_HUB_OWNER_ENABLED == "true" ? var.deployment.project_id : ""
      ) &&
      (var.owner_environment.FOLIOVIEW_PORTFOLIO_OWNER_ENABLED == "true" ? (
        can(regex("^https://portfolio-api-[1-9][0-9]{5,19}\\.${var.deployment.region}\\.run\\.app$", var.owner_environment.FOLIOVIEW_PORTFOLIO_ORIGIN)) &&
        var.owner_environment.FOLIOVIEW_PORTFOLIO_AUDIENCE == var.owner_environment.FOLIOVIEW_PORTFOLIO_ORIGIN
      ) : var.owner_environment.FOLIOVIEW_PORTFOLIO_ORIGIN == "" && var.owner_environment.FOLIOVIEW_PORTFOLIO_AUDIENCE == "") &&
      (var.owner_environment.FOLIOVIEW_HUB_OWNER_ENABLED == "true" ? (
        can(regex("^https://agent-hub-api-[1-9][0-9]{5,19}\\.${var.deployment.region}\\.run\\.app$", var.owner_environment.FOLIOVIEW_HUB_ORIGIN)) &&
        (var.owner_environment.FOLIOVIEW_PORTFOLIO_OWNER_ENABLED != "true" || var.owner_environment.FOLIOVIEW_HUB_ORIGIN == replace(var.owner_environment.FOLIOVIEW_PORTFOLIO_ORIGIN, "https://portfolio-api-", "https://agent-hub-api-"))
      ) : var.owner_environment.FOLIOVIEW_HUB_ORIGIN == ""),
      false,
    )
    error_message = "Use null or the exact six owner settings with explicit independent flags, this Firebase project and matching numbered Portfolio/Hub Run origins."
  }
}
