locals {
  labels = {
    application = "folioview"
    managed_by  = "terraform"
    scope       = "repo"
  }

  state_buckets = {
    bootstrap = "${var.project_id}-tf-bootstrap"
    execution = "${var.project_id}-tfstate"
  }
}

# Bootstrap state has a separate administrative trust boundary. Neither runtime
# identity receives access to this bucket or to its IAM policy.
resource "google_storage_bucket" "state" {
  for_each = local.state_buckets

  project                     = var.project_id
  name                        = each.value
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      with_state                 = "ARCHIVED"
      days_since_noncurrent_time = 30
      num_newer_versions         = 2
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_storage_bucket" "plans" {
  project                     = var.project_id
  name                        = "${var.project_id}-tfplans"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  # Plans can contain sensitive resource values. Keep them private and short-lived.
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 7
    }
  }

  soft_delete_policy {
    retention_duration_seconds = 0
  }

  lifecycle {
    prevent_destroy = true
  }
}
