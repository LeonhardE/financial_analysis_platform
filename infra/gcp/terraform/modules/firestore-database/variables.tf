variable "project_id" {
  description = "Project owning this single named database; the root must already enable its APIs."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use a 6-30 character Google Cloud project ID, not a project number or resource path."
  }
}

variable "database_id" {
  description = "New named database ID; existing/default database ownership belongs to its own root."
  type        = string
  nullable    = false

  validation {
    condition = (
      can(regex("^[a-z][a-z0-9-]{2,61}[a-z0-9]$", var.database_id)) &&
      !can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.database_id))
    )
    error_message = "Use a non-UUID named database ID of 4-63 lowercase letters, digits, or hyphens, starting with a letter and ending with a letter or digit; (default), paths, and wildcards are not supported."
  }
}

variable "location_id" {
  description = "Regional database location, normally colocated with its consuming service."
  type        = string
  default     = "northamerica-northeast2"
  nullable    = false

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]+$", var.location_id))
    error_message = "Use a regional location such as northamerica-northeast2, not a resource path or multi-region."
  }
}

variable "ttl_fields" {
  description = "Stable logical keys for optional collection-group TTL fields; one resource owns both TTL and its optional single-field index exemption. Simple dotted field paths only."
  type = map(object({
    collection_group = string
    field            = string
    disable_indexes  = optional(bool, true)
  }))
  default  = {}
  nullable = false

  validation {
    condition = alltrue([for key, config in var.ttl_fields : try(
      can(regex("^[a-z][a-z0-9_-]{0,62}$", key)) &&
      length(config.collection_group) <= 1500 &&
      can(regex("^[A-Za-z_][A-Za-z0-9_-]*$", config.collection_group)) &&
      !can(regex("^__.*__$", config.collection_group)) &&
      length(config.field) <= 1500 &&
      can(regex("^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$", config.field)) &&
      alltrue([for segment in split(".", config.field) : !can(regex("^__.*__$", segment))]),
    false)])
    error_message = "TTL entries need stable lowercase logical keys, simple collection IDs and non-reserved dotted field paths, without nulls, wildcards, resource paths, or quoted paths."
  }

  validation {
    condition     = length(distinct([for config in values(var.ttl_fields) : try(config.collection_group, null)])) == length(var.ttl_fields)
    error_message = "Each collection group can have exactly one TTL field and one owner; duplicate group declarations are not supported."
  }
}

variable "composite_indexes" {
  description = "Optional composite indexes keyed by stable logical names; each field has exactly one order or array mode. Simple dotted field paths only, with at least two distinct fields."
  type = map(object({
    collection_group = string
    query_scope      = optional(string, "COLLECTION")
    fields = list(object({
      field_path   = string
      order        = optional(string)
      array_config = optional(string)
    }))
  }))
  default  = {}
  nullable = false

  validation {
    condition = alltrue([for key, config in var.composite_indexes : try(
      can(regex("^[a-z][a-z0-9_-]{0,62}$", key)) &&
      length(config.collection_group) <= 1500 &&
      can(regex("^[A-Za-z_][A-Za-z0-9_-]*$", config.collection_group)) &&
      !can(regex("^__.*__$", config.collection_group)) &&
      contains(["COLLECTION", "COLLECTION_GROUP"], config.query_scope) &&
      length(config.fields) >= 2 && length(config.fields) <= 100 &&
      length(distinct([for field in config.fields : field.field_path])) == length(config.fields) &&
      length([for field in config.fields : field if field.array_config != null]) <= 1 &&
      alltrue([for field in config.fields : (
        length(field.field_path) <= 1500 &&
        can(regex("^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$", field.field_path)) &&
        alltrue([for segment in split(".", field.field_path) : !can(regex("^__.*__$", segment))]) &&
        ((field.order != null) != (field.array_config != null)) &&
        (field.order == null ? true : contains(["ASCENDING", "DESCENDING"], field.order)) &&
        (field.array_config == null ? true : field.array_config == "CONTAINS")
      )]),
    false)])
    error_message = "Indexes need simple non-reserved collection/field paths, a supported query scope, 2-100 distinct fields, exactly one valid order or array mode per field, and at most one array field."
  }

  validation {
    condition = length(distinct([for config in values(var.composite_indexes) : jsonencode({
      collection_group = try(config.collection_group, null)
      query_scope      = try(config.query_scope, null)
      fields           = try(config.fields, null)
    })])) == length(var.composite_indexes)
    error_message = "Each composite index definition must have exactly one logical owner; duplicate definitions are not supported."
  }
}
