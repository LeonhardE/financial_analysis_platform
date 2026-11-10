resource "google_compute_network" "executor" {
  count                   = local.enabled ? 1 : 0
  project                 = local.project
  name                    = "${local.name}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.executor]
}
resource "google_compute_subnetwork" "executor" {
  count                    = local.enabled ? 1 : 0
  project                  = local.project
  name                     = "${local.name}-subnet"
  region                   = local.region
  network                  = google_compute_network.executor[0].id
  ip_cidr_range            = var.deployment.subnet_cidr
  private_ip_google_access = true
  lifecycle { prevent_destroy = true }
}
resource "google_compute_firewall" "tls" {
  count                   = local.enabled ? 1 : 0
  project                 = local.project
  name                    = "${local.name}-gfe-tls"
  network                 = google_compute_network.executor[0].name
  direction               = "INGRESS"
  priority                = 1000
  source_ranges           = ["130.211.0.0/22", "35.191.0.0/16"]
  target_service_accounts = [local.emails.runtime, local.emails.creation]
  allow {
    protocol = "tcp"
    ports    = ["8443"]
  }
  depends_on = [module.identity]
}
resource "google_compute_global_address" "ingress" {
  count        = local.enabled ? 1 : 0
  project      = local.project
  name         = "${local.name}-ingress"
  address_type = "EXTERNAL"
  ip_version   = "IPV4"
  labels       = local.labels
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.executor]
}

# TCP proxying carries the original encrypted TLS stream. No SSL/HTTPS proxy,
# certificate/private-key resource, header injection or plaintext listener exists.
resource "google_compute_instance_group" "executor" {
  count     = local.enabled ? 1 : 0
  project   = local.project
  name      = "${local.name}-group"
  network   = google_compute_network.executor[0].self_link
  zone      = var.deployment.zone
  instances = local.vm ? [google_compute_instance.executor[0].self_link] : []
  named_port {
    name = "tee-tls"
    port = 8443
  }
}
resource "google_compute_health_check" "tcp" {
  count               = local.enabled ? 1 : 0
  project             = local.project
  name                = "${local.name}-tcp"
  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 2
  tcp_health_check {
    port         = 8443
    proxy_header = "NONE"
  }
  log_config { enable = false }
  depends_on = [google_project_service.executor]
}
resource "google_compute_backend_service" "tls" {
  count                 = local.enabled ? 1 : 0
  project               = local.project
  name                  = "${local.name}-tls-backend"
  protocol              = "TCP"
  port_name             = "tee-tls"
  load_balancing_scheme = "EXTERNAL"
  timeout_sec           = 60
  health_checks         = [google_compute_health_check.tcp[0].id]
  backend {
    group                        = google_compute_instance_group.executor[0].self_link
    balancing_mode               = "CONNECTION"
    max_connections_per_instance = 16
  }
  log_config { enable = false }
}
resource "google_compute_target_tcp_proxy" "tls" {
  count           = local.enabled ? 1 : 0
  project         = local.project
  name            = "${local.name}-tcp-proxy"
  backend_service = google_compute_backend_service.tls[0].id
  proxy_header    = "NONE"
}
resource "google_compute_global_forwarding_rule" "tls" {
  count                 = local.enabled ? 1 : 0
  project               = local.project
  name                  = "${local.name}-tls-forwarding"
  target                = google_compute_target_tcp_proxy.tls[0].id
  ip_address            = google_compute_global_address.ingress[0].address
  ip_protocol           = "TCP"
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL"
  network_tier          = "PREMIUM"
  labels                = local.labels
}
