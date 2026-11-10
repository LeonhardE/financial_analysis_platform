# Public ACME tokens only. Original TLS on 443 still terminates inside the TEE.
resource "google_storage_bucket" "challenge" {
  count                       = local.enabled && var.acme_http01_enabled ? 1 : 0
  project                     = local.project
  name                        = "${local.project}-executor-acme"
  location                    = local.region
  uniform_bucket_level_access = true
  public_access_prevention    = "inherited"
  force_destroy               = false
  labels                      = local.labels
  soft_delete_policy { retention_duration_seconds = 0 }
  lifecycle_rule {
    action { type = "Delete" }
    condition { age = 1 }
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.executor]
}
resource "google_storage_bucket_iam_member" "challenge_public" {
  count  = local.enabled && var.acme_http01_enabled ? 1 : 0
  bucket = google_storage_bucket.challenge[0].name
  role   = google_project_iam_custom_role.config[0].name
  member = "allUsers"
  # allUsers cannot use conditional bindings. This separate bucket contains only
  # public challenge bytes; the publisher's write grant is prefix restricted.
}
resource "google_compute_backend_bucket" "challenge" {
  count       = local.enabled && var.acme_http01_enabled ? 1 : 0
  project     = local.project
  name        = "${local.name}-acme"
  bucket_name = google_storage_bucket.challenge[0].name
  enable_cdn  = false
}
resource "google_compute_url_map" "challenge" {
  count           = local.enabled && var.acme_http01_enabled ? 1 : 0
  project         = local.project
  name            = "${local.name}-acme"
  default_service = google_compute_backend_bucket.challenge[0].id
}
resource "google_compute_target_http_proxy" "challenge" {
  count   = local.enabled && var.acme_http01_enabled ? 1 : 0
  project = local.project
  name    = "${local.name}-acme"
  url_map = google_compute_url_map.challenge[0].id
}
resource "google_compute_global_forwarding_rule" "challenge" {
  count                 = local.enabled && var.acme_http01_enabled ? 1 : 0
  project               = local.project
  name                  = "${local.name}-acme"
  target                = google_compute_target_http_proxy.challenge[0].id
  ip_address            = google_compute_global_address.ingress[0].address
  ip_protocol           = "TCP"
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL"
  network_tier          = "PREMIUM"
  labels                = local.labels
}
