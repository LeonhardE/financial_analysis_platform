# Explicit instance inputs, not ambient gcloud defaults or checked-in production IDs.
variable "deployment" {
  description = "Nonsecret Hub instance selected by the administrator's reviewed input and complete saved plan."
  type = object({
    project_id          = string
    region              = string
    artifact_repository = string
    runtime_account_id  = string
    creation_image      = string
    web_origin          = string
    hub_origin          = string
  })
  nullable = false

  validation {
    condition = (
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.deployment.project_id)) &&
      can(regex("^[a-z]+(-[a-z0-9]+)+[0-9]$", var.deployment.region)) &&
      can(regex("^[a-z][a-z0-9-]{1,62}$", var.deployment.artifact_repository)) &&
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.deployment.runtime_account_id))
    )
    error_message = "Use canonical project, region, artifact repository and custom runtime account identifiers."
  }
  validation {
    condition = can(regex(
      "^${var.deployment.region}-docker\\.pkg\\.dev/${var.deployment.project_id}/${var.deployment.artifact_repository}/agent-hub-api@sha256:[a-f0-9]{64}$",
      var.deployment.creation_image,
    ))
    error_message = "Hub creation requires its immutable agent-hub-api digest in the selected project, region and repository."
  }
  validation {
    condition = alltrue([for origin in [var.deployment.web_origin, var.deployment.hub_origin] :
      length(origin) <= 2048 && can(regex("^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$", origin))
    ]) && var.deployment.web_origin != var.deployment.hub_origin
    error_message = "Use distinct canonical lowercase HTTPS Web and Hub origins without ports, userinfo, paths, queries or fragments."
  }
}

# Compatibility only: it may not override the selected target/digest.
variable "bootstrap_image" {
  type        = string
  description = "Optional legacy alias; must exactly equal deployment.creation_image."
  default     = null
  nullable    = true
  validation {
    condition     = var.bootstrap_image == null || var.bootstrap_image == var.deployment.creation_image
    error_message = "bootstrap_image must be omitted or equal deployment.creation_image."
  }
}

variable "sources" {
  description = "Explicit fixed producer origins and Portfolio's complete workload identity; absent values leave producer operations unavailable. No content credentials."
  type = object({
    user_origin               = optional(string, "")
    portfolio_origin          = optional(string, "")
    portfolio_caller_email    = optional(string, "")
    trusted_portfolio_callers = optional(map(string), {})
  })
  default  = {}
  nullable = false
  validation {
    condition = alltrue([for origin in [var.sources.user_origin, var.sources.portfolio_origin] :
      origin == "" || (length(origin) <= 2048 && can(regex("^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$", origin)))
    ])
    error_message = "Producer origins are either explicitly disabled or fixed canonical HTTPS origins."
  }
  validation {
    condition = (
      (var.sources.portfolio_caller_email == "" || can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.deployment.project_id}\\.iam\\.gserviceaccount\\.com$", var.sources.portfolio_caller_email))) &&
      length(var.sources.trusted_portfolio_callers) <= 1 &&
      alltrue([for subject, email in var.sources.trusted_portfolio_callers :
        can(regex("^[0-9]{1,128}$", subject)) && email == var.sources.portfolio_caller_email && email != ""
      ])
    )
    error_message = "Trust at most the inventoried Portfolio subject and its exact same-project custom account; no guessed subject or public/human identity."
  }
}

variable "connector" {
  description = "Native account bootstrap and legacy Muse preregistration input. The old financial adapter is retired; personal Agent mode is separately opt-in. Client secrets never enter Terraform; confidential clients supply only their high-entropy verifier hash through private operator inputs."
  type = object({
    oauth_enabled             = optional(bool, false)
    encrypted_adapter_enabled = optional(bool, false)
    muse_clients = optional(list(object({
      client_id                  = string
      redirect_uris              = list(string)
      token_endpoint_auth_method = optional(string, "none")
      secret_sha256              = optional(string)
    })), [])
  })
  default  = {}
  nullable = false
  validation {
    condition = (
      !var.connector.encrypted_adapter_enabled
    )
    error_message = "The legacy financial adapter must remain false."
  }
  validation {
    condition = length(jsonencode([for client in var.connector.muse_clients : {
      provider                = "muse"
      clientId                = client.client_id
      redirectUris            = client.redirect_uris
      tokenEndpointAuthMethod = client.token_endpoint_auth_method
      secretSha256            = client.secret_sha256
    }])) <= 16384
    error_message = "The exact preregistration JSON must fit OAuthConfig's 16 KiB input budget."
  }
  validation {
    condition = (
      length(var.connector.muse_clients) <= 8 &&
      length(distinct([for client in var.connector.muse_clients : client.client_id])) == length(var.connector.muse_clients) &&
      alltrue([for client in var.connector.muse_clients :
        can(regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", client.client_id)) &&
        contains(["none", "client_secret_basic"], client.token_endpoint_auth_method) &&
        (client.token_endpoint_auth_method == "none" ? client.secret_sha256 == null : can(regex("^[a-f0-9]{64}$", client.secret_sha256))) &&
        length(client.redirect_uris) >= 1 && length(client.redirect_uris) <= 4 &&
        length(distinct(client.redirect_uris)) == length(client.redirect_uris) &&
        alltrue([for uri in client.redirect_uris : length(uri) <= 2048 && can(regex("^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$", uri))])
      ])
    )
    error_message = "Register up to eight distinct Muse clients with the matching public or confidential verifier profile with one to four exact HTTPS callbacks; wildcards, userinfo, ports, queries and fragments are refused."
  }
}

# Retain a false-only legacy input so an old operator file cannot silently opt in.
variable "persistent_mode_enabled" {
  description = "Retired browser runtime choice. Must remain false; select agent_owned_mode_enabled only in a separately authorized rollout."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.persistent_mode_enabled
    error_message = "The browser runtime is retired. Keep persistent_mode_enabled=false and explicitly review personal Agent mode."
  }
}

variable "agent_owned_mode_enabled" {
  description = "Enable personal Agent bootstrap/90-day credentials on this existing service only after explicit deployment and host-readiness review. False by default; grants no user resource authority."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition = !var.agent_owned_mode_enabled || (
      var.connector.oauth_enabled && length(var.connector.muse_clients) + length(var.agent_clients) > 0 &&
      var.sources.user_origin != "" && var.sources.portfolio_origin != "" &&
      var.sources.portfolio_caller_email != "" && length(var.sources.trusted_portfolio_callers) > 0
    )
    error_message = "Personal Agent mode needs explicit OAuth preregistration and complete reviewed User/Portfolio producer trust. It does not authorize public invocation, data access or deployment."
  }
}

variable "agent_clients" {
  description = "Explicit Muse/ChatGPT preregistrations. Public callback metadata and optional high-entropy client verifier hash only; never Agent private keys or raw client secrets. Legacy Muse registrations may remain in connector.muse_clients."
  type = list(object({
    provider                   = string
    client_id                  = string
    redirect_uris              = list(string)
    token_endpoint_auth_method = optional(string, "none")
    secret_sha256              = optional(string)
  }))
  default  = []
  nullable = false
  validation {
    condition     = !var.connector.oauth_enabled || length(var.connector.muse_clients) + length(var.agent_clients) > 0
    error_message = "OAuth requires explicit registered Agent clients."
  }
  validation {
    condition = (
      length(var.agent_clients) + length(var.connector.muse_clients) <= 8 &&
      length(distinct(concat([for c in var.agent_clients : c.client_id], [for c in var.connector.muse_clients : c.client_id]))) == length(var.agent_clients) + length(var.connector.muse_clients) &&
      alltrue([for client in var.agent_clients :
        contains(["muse", "chatgpt"], client.provider) &&
        can(regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", client.client_id)) &&
        contains(["none", "client_secret_basic"], client.token_endpoint_auth_method) &&
        (client.token_endpoint_auth_method == "none" ? client.secret_sha256 == null : can(regex("^[a-f0-9]{64}$", client.secret_sha256))) &&
        length(client.redirect_uris) >= 1 && length(client.redirect_uris) <= 4 &&
        length(distinct(client.redirect_uris)) == length(client.redirect_uris) &&
        alltrue([for uri in client.redirect_uris :
          length(uri) <= 2048 && can(regex("^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(/[A-Za-z0-9._~!$&'()*+,;=:@/-]*)?$", uri)) &&
          !strcontains(uri, "/../") && !endswith(uri, "/..") && !strcontains(uri, "/./")
        ])
      ])
    )
    error_message = "Register up to eight globally distinct Muse/ChatGPT clients, matching verifier profiles and exact canonical HTTPS callbacks; no wildcard, userinfo, query, fragment, port or dot traversal."
  }
  validation {
    condition = length(jsonencode(concat([for client in var.connector.muse_clients : {
      provider = "muse", clientId = client.client_id, redirectUris = client.redirect_uris, tokenEndpointAuthMethod = client.token_endpoint_auth_method, secretSha256 = client.secret_sha256
      }], [for client in var.agent_clients : {
      provider = client.provider, clientId = client.client_id, redirectUris = client.redirect_uris, tokenEndpointAuthMethod = client.token_endpoint_auth_method, secretSha256 = client.secret_sha256
    }]))) <= 16384
    error_message = "The combined preregistration JSON must fit the existing 16 KiB application limit."
  }
}
