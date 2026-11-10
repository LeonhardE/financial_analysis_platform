# Owner administrator root, never selected by ordinary workload execution.
locals {
  read_permissions  = ["artifactregistry.repositories.get", "artifactregistry.repositories.getIamPolicy", "cloudkms.keyRings.get", "cloudkms.keyRings.list", "cloudkms.cryptoKeys.get", "cloudkms.cryptoKeys.list", "cloudkms.cryptoKeys.getIamPolicy", "cloudkms.cryptoKeyVersions.get", "cloudkms.cryptoKeyVersions.list", "datastore.databases.get", "datastore.databases.list", "datastore.indexes.list", "firebaserules.releases.get", "firebaserules.releases.list", "firebaserules.rulesets.get", "firebaserules.rulesets.list", "iam.serviceAccounts.get", "iam.serviceAccounts.list", "iam.serviceAccounts.getIamPolicy", "iam.roles.get", "iam.roles.list", "resourcemanager.projects.get", "resourcemanager.projects.getIamPolicy", "run.services.get", "run.services.list", "run.services.getIamPolicy", "run.operations.get", "run.revisions.get", "run.revisions.list", "serviceusage.services.get", "serviceusage.services.list", "serviceusage.services.use", "storage.buckets.get", "storage.buckets.getIamPolicy"]
  write_permissions = ["artifactregistry.repositories.create", "artifactregistry.repositories.update", "artifactregistry.repositories.setIamPolicy", "cloudkms.keyRings.create", "cloudkms.cryptoKeys.create", "cloudkms.cryptoKeys.update", "cloudkms.cryptoKeys.setIamPolicy", "datastore.databases.create", "datastore.databases.update", "datastore.indexes.create", "datastore.indexes.update", "firebaserules.rulesets.create", "firebaserules.releases.create", "firebaserules.releases.update", "iam.serviceAccounts.create", "iam.serviceAccounts.update", "iam.serviceAccounts.setIamPolicy", "iam.roles.create", "iam.roles.update", "resourcemanager.projects.setIamPolicy", "run.services.create", "run.services.update", "run.services.setIamPolicy", "serviceusage.services.enable", "storage.buckets.create", "storage.buckets.update", "storage.buckets.setIamPolicy"]
}
module "owner_lane" {
  count             = var.enabled ? 1 : 0
  source            = "../../owner-lane-module"
  project_id        = var.admin.project_id
  region            = var.admin.region
  target            = "agent-policy"
  repository_id     = var.admin.repository_id
  lane              = var.lane
  execution_enabled = var.execution_enabled
}
resource "google_project_iam_custom_role" "workload" {
  for_each    = var.enabled ? toset(["read", "apply"]) : toset([])
  project     = var.admin.project_id
  role_id     = each.key == "read" ? "folioviewPolicyPlanRead" : "folioviewPolicyApprovedApply"
  title       = each.key == "read" ? "Policy infrastructure metadata reads" : "Owner approved Policy infrastructure apply"
  permissions = each.key == "read" ? local.read_permissions : concat(local.read_permissions, local.write_permissions)
}
resource "google_project_iam_member" "plan_read" {
  count   = var.enabled && var.workload_access_enabled ? 1 : 0
  project = var.admin.project_id
  role    = google_project_iam_custom_role.workload["read"].name
  member  = "serviceAccount:${module.owner_lane[0].lane.accounts.plan}"
}
resource "google_project_iam_member" "apply" {
  count   = var.enabled && var.workload_access_enabled ? 1 : 0
  project = var.admin.project_id
  role    = google_project_iam_custom_role.workload["apply"].name
  member  = "serviceAccount:${module.owner_lane[0].lane.accounts.apply}"
}
resource "google_service_account_iam_member" "runtime_act_as" {
  count              = var.enabled && var.runtime_act_as_enabled ? 1 : 0
  service_account_id = "projects/${var.admin.project_id}/serviceAccounts/${var.admin.runtime_account_id}@${var.admin.project_id}.iam.gserviceaccount.com"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${module.owner_lane[0].lane.accounts.apply}"
}
output "preparation" {
  value = { enabled = var.enabled, execution_enabled = var.execution_enabled, lane = try(module.owner_lane[0].lane, null), workload_access_enabled = var.workload_access_enabled, runtime_act_as_enabled = var.runtime_act_as_enabled }
}
