variable "owner_environment" {
  description = "Optional pinned managed Web environment: six legacy fields or their exact pair of reviewed independent Agent settings."
  type        = map(string)
  default     = null
  nullable    = true

  validation {
    condition = var.owner_environment == null ? true : try(
      (toset(keys(var.owner_environment)) == toset([
        "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED",
        "FOLIOVIEW_PORTFOLIO_ORIGIN", "FOLIOVIEW_PORTFOLIO_AUDIENCE",
        "FOLIOVIEW_HUB_OWNER_ENABLED", "FOLIOVIEW_HUB_ORIGIN",
        ]) || toset(keys(var.owner_environment)) == toset([
        "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED",
        "FOLIOVIEW_PORTFOLIO_ORIGIN", "FOLIOVIEW_PORTFOLIO_AUDIENCE",
        "FOLIOVIEW_HUB_OWNER_ENABLED", "FOLIOVIEW_HUB_ORIGIN",
        "FOLIOVIEW_INDEPENDENT_AGENT_ENABLED", "FOLIOVIEW_INDEPENDENT_AGENT_CONFIG",
      ])) &&
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
    error_message = "Use null, the exact six legacy settings, or their complete independent Agent pair. Retain this Firebase project and matching numbered Portfolio/Hub origins."
  }
  validation {
    condition = var.owner_environment == null ? true : !contains(keys(var.owner_environment), "FOLIOVIEW_INDEPENDENT_AGENT_ENABLED") ? true : try(
      alltrue([for config in [jsondecode(var.owner_environment.FOLIOVIEW_INDEPENDENT_AGENT_CONFIG)] : (
        var.owner_environment.FOLIOVIEW_HUB_OWNER_ENABLED == "true" &&
        var.owner_environment.FOLIOVIEW_INDEPENDENT_AGENT_ENABLED == "true" &&
        length(var.owner_environment.FOLIOVIEW_INDEPENDENT_AGENT_CONFIG) <= 1024 &&
        jsonencode(config) == var.owner_environment.FOLIOVIEW_INDEPENDENT_AGENT_CONFIG &&
        toset(keys(config)) == toset(["connectionId", "clientId", "issuer", "audience", "policyJwk", "nativeRedirectUris"]) &&
        alltrue([for id in [config.connectionId, config.clientId] :
          can(regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", id))
        ]) &&
        can(regex("^https://[a-z0-9]+([.-][a-z0-9]+)*$", config.issuer)) &&
        can(regex("^https://[a-z0-9]+([.-][a-z0-9]+)*/mcp$", config.audience)) &&
        config.issuer != trimsuffix(config.audience, "/mcp") &&
        config.issuer != var.owner_environment.FOLIOVIEW_HUB_ORIGIN &&
        trimsuffix(config.audience, "/mcp") != var.owner_environment.FOLIOVIEW_HUB_ORIGIN &&
        toset(keys(config.policyJwk)) == toset(["kty", "crv", "x", "y"]) &&
        config.policyJwk.kty == "EC" && config.policyJwk.crv == "P-256" &&
        alltrue([for k in ["x", "y"] : can(regex("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$", config.policyJwk[k]))]) &&
        length(config.nativeRedirectUris) >= 1 && length(config.nativeRedirectUris) <= 4 &&
        length(toset(config.nativeRedirectUris)) == length(config.nativeRedirectUris) &&
        alltrue([for uri in config.nativeRedirectUris :
          length(uri) <= 512 && can(regex("^https://[a-z0-9]+([.-][a-z0-9]+)*(/[A-Za-z0-9._~-]+)+$", uri)) &&
          !strcontains(uri, "/../") && !endswith(uri, "/..")
        ])
      )]), false,
    )
    error_message = "Independent Agent configuration requires the complete enabled public pair, Hub Owner support, canonical bounded six-field JSON, public-only P-256 JWK and exact HTTPS issuer/resource/callbacks. Use the pinned profile-v5 projection; no arbitrary environment or private key."
  }
}

locals {
  independent_agent = try(jsondecode(var.owner_environment.FOLIOVIEW_INDEPENDENT_AGENT_CONFIG), null)
}
