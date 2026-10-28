locals {
  execution_registry = jsondecode(file("${path.module}/../pipeline.json"))
  enabled_target_execution = {
    for name, target in local.execution_registry.targets : name => target
    if name != "repo" && (
      target.enabled ||
      (name == "portfolio" && var.portfolio_provisioning_stage != "none") ||
      (name == "agent-hub" && var.agent_hub_provisioning_stage != "none")
    )
  }
  # Use a blocking lifecycle precondition on the existing repo plan trigger.
  # A check block would only warn and could provision an unusable target.
  execution_registry_valid = try(
    local.execution_registry.schema_version == 2 &&
    local.execution_registry.project_id == var.project_id &&
    local.execution_registry.region == var.region &&
    local.execution_registry.state_bucket == "${var.project_id}-tfstate" &&
    local.execution_registry.plan_bucket == "${var.project_id}-tfplans" &&
    local.execution_registry.targets.repo.enabled &&
    alltrue([for name, target in local.execution_registry.targets : (
      can(regex("^[a-z]([a-z0-9-]{0,13}[a-z0-9])?$", name)) &&
      !contains(["bootstrap", "shared"], name) &&
      contains([true, false], target.enabled) &&
      target.directory == "infra/gcp/terraform/envs/prod/${name}" &&
      contains(["committed-v2", "trigger-v1"], try(target.deployment_source, "committed-v2")) &&
      (try(target.deployment_source, "committed-v2") == "trigger-v1" ? try(
        length(setsubtract(toset(keys(target)), toset([
          "directory", "enabled", "configuration_controllers", "deployment_source", "state_prefix", "plan_trigger", "apply_trigger",
        ]))) == 0 &&
        try(target.state_prefix, "prod/${name}") == "prod/${name}" &&
        try(target.plan_trigger, "terraform-plan-${name}") == "terraform-plan-${name}" &&
        try(target.apply_trigger, "terraform-apply-${name}") == "terraform-apply-${name}" &&
        length(var.deployment_configs[name]) <= 4000 &&
        can(regex("^[\\x20-\\x7e]+$", var.deployment_configs[name])) &&
        !strcontains(var.deployment_configs[name], "$") &&
        var.deployment_configs[name] == jsonencode(jsondecode(var.deployment_configs[name])) &&
        jsondecode(var.deployment_configs[name]).schemaVersion == 1 &&
        jsondecode(var.deployment_configs[name]).target == name &&
        jsondecode(var.deployment_configs[name]).project.id == var.project_id &&
        jsondecode(var.deployment_configs[name]).region == var.region &&
        jsondecode(var.deployment_configs[name]).source.repositoryResource == var.repository_id &&
        jsondecode(var.deployment_configs[name]).inputs.project_id == var.project_id &&
        (name != "repo" || toset(keys(jsondecode(var.deployment_configs[name]).inputs)) == toset(["project_id"])),
        false,
        ) : try(
        target.state_prefix == "prod/${name}" &&
        target.state_bucket == (name == "repo" ? "${var.project_id}-tfstate" : "${var.project_id}-tfstate-${name}") &&
        target.plan_trigger == "terraform-plan-${name}" &&
        target.apply_trigger == "terraform-apply-${name}" &&
        target.plan_service_account == (name == "repo" ? "fa-infra-plan@${var.project_id}.iam.gserviceaccount.com" : "fa-infra-${name}-plan@${var.project_id}.iam.gserviceaccount.com") &&
        target.apply_service_account == (name == "repo" ? "fa-infra-apply@${var.project_id}.iam.gserviceaccount.com" : "fa-infra-${name}-apply@${var.project_id}.iam.gserviceaccount.com"),
        false,
      )) &&
      length(target.configuration_controllers) <= 1 &&
      (name != "repo" || length(target.configuration_controllers) == 0) &&
      alltrue([for address in target.configuration_controllers : can(regex("^module\\.[a-z_][a-z0-9_]*\\.terraform_data\\.configuration$", address))]) &&
      (!target.enabled || (
        fileexists("${path.module}/../envs/prod/${name}/versions.tf") &&
        fileexists("${path.module}/../envs/prod/${name}/.terraform.lock.hcl")
      ))
    )]),
    false,
  )
}

# Only an administrative bootstrap apply can create execution identities, IAM,
# buckets, and triggers. Registering an inactive future target creates nothing.
# Each target is activated in its own subsequent infrastructure PR.
module "target_execution" {
  for_each = local.enabled_target_execution
  source   = "../modules/target-execution"

  project_id          = var.project_id
  region              = var.region
  repository_id       = var.repository_id
  target              = each.key
  plan_bucket         = google_storage_bucket.plans.name
  build_metadata_role = google_project_iam_custom_role.build_metadata.name
  lock_delete_role    = google_project_iam_custom_role.state_lock_delete.name
  deployment_config = try(each.value.deployment_source, "committed-v2") == "trigger-v1" ? try(
    var.deployment_configs[each.key], null,
  ) : null
}

output "target_execution" {
  description = "Activated non-repo execution boundaries; empty until each target's separate provisioning change."
  value = {
    for name, execution in module.target_execution : name => {
      state_bucket     = execution.state_bucket
      state_prefix     = execution.state_prefix
      service_accounts = execution.service_accounts
      triggers         = execution.triggers
    }
  }
}
