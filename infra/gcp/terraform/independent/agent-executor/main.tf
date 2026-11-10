# Owner administrator root, never selected by ordinary workload execution.
locals {
  read_permissions  = ["artifactregistry.repositories.get", "artifactregistry.repositories.getIamPolicy", "compute.backendBuckets.get", "compute.backendServices.get", "compute.firewalls.get", "compute.globalAddresses.get", "compute.globalForwardingRules.get", "compute.globalOperations.get", "compute.healthChecks.get", "compute.instanceGroups.get", "compute.instances.get", "compute.networks.get", "compute.projects.get", "compute.regionOperations.get", "compute.regions.get", "compute.subnetworks.get", "compute.targetHttpProxies.get", "compute.targetTcpProxies.get", "compute.urlMaps.get", "compute.zoneOperations.get", "compute.zones.get", "iam.roles.get", "iam.roles.list", "iam.serviceAccounts.get", "iam.serviceAccounts.getIamPolicy", "iam.serviceAccounts.list", "resourcemanager.projects.get", "resourcemanager.projects.getIamPolicy", "serviceusage.services.get", "serviceusage.services.list", "serviceusage.services.use", "storage.buckets.get", "storage.buckets.getIamPolicy"]
  write_permissions = ["artifactregistry.repositories.create", "artifactregistry.repositories.setIamPolicy", "artifactregistry.repositories.update", "compute.backendBuckets.create", "compute.backendBuckets.delete", "compute.backendBuckets.update", "compute.backendBuckets.use", "compute.backendServices.create", "compute.backendServices.delete", "compute.backendServices.update", "compute.backendServices.use", "compute.disks.create", "compute.disks.delete", "compute.disks.use", "compute.firewalls.create", "compute.firewalls.delete", "compute.firewalls.update", "compute.globalAddresses.create", "compute.globalAddresses.delete", "compute.globalAddresses.use", "compute.globalForwardingRules.create", "compute.globalForwardingRules.delete", "compute.healthChecks.create", "compute.healthChecks.delete", "compute.healthChecks.update", "compute.healthChecks.use", "compute.images.useReadOnly", "compute.instanceGroups.create", "compute.instanceGroups.update", "compute.instanceGroups.delete", "compute.instanceGroups.use", "compute.instances.create", "compute.instances.delete", "compute.instances.setDeletionProtection", "compute.instances.setLabels", "compute.instances.setMetadata", "compute.instances.setServiceAccount", "compute.instances.setShieldedInstanceIntegrityPolicy", "compute.instances.updateShieldedInstanceConfig", "compute.networks.create", "compute.networks.delete", "compute.networks.updatePolicy", "compute.networks.use", "compute.subnetworks.create", "compute.subnetworks.delete", "compute.subnetworks.update", "compute.subnetworks.use", "compute.subnetworks.useExternalIp", "compute.targetHttpProxies.create", "compute.targetHttpProxies.delete", "compute.targetHttpProxies.setUrlMap", "compute.targetHttpProxies.use", "compute.targetTcpProxies.create", "compute.targetTcpProxies.update", "compute.targetTcpProxies.delete", "compute.targetTcpProxies.use", "compute.urlMaps.create", "compute.urlMaps.delete", "compute.urlMaps.update", "compute.urlMaps.use", "iam.roles.create", "iam.roles.update", "iam.serviceAccounts.create", "iam.serviceAccounts.setIamPolicy", "iam.serviceAccounts.update", "resourcemanager.projects.setIamPolicy", "serviceusage.services.enable", "storage.buckets.create", "storage.buckets.setIamPolicy", "storage.buckets.update"]
}
module "owner_lane" {
  count             = var.enabled ? 1 : 0
  source            = "../../owner-lane-module"
  project_id        = var.admin.project_id
  region            = var.admin.region
  target            = "agent-executor"
  repository_id     = var.admin.repository_id
  lane              = var.lane
  execution_enabled = var.execution_enabled
}
resource "google_project_iam_custom_role" "workload" {
  for_each    = var.enabled ? toset(["read", "apply"]) : toset([])
  project     = var.admin.project_id
  role_id     = each.key == "read" ? "folioviewExecutorPlanRead" : "folioviewExecutorApprovedApply"
  title       = each.key == "read" ? "Executor infrastructure metadata reads" : "Owner approved Executor infrastructure apply"
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
resource "google_service_account_iam_member" "workload_act_as" {
  for_each           = var.enabled && var.workload_act_as_enabled ? toset([var.admin.runtime_account_id, var.admin.creation_account_id]) : toset([])
  service_account_id = "projects/${var.admin.project_id}/serviceAccounts/${each.value}@${var.admin.project_id}.iam.gserviceaccount.com"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${module.owner_lane[0].lane.accounts.apply}"
}
output "preparation" {
  value = { enabled = var.enabled, execution_enabled = var.execution_enabled, lane = try(module.owner_lane[0].lane, null), workload_access_enabled = var.workload_access_enabled, workload_act_as_enabled = var.workload_act_as_enabled }
}
