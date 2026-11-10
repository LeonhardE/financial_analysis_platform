terraform {
  required_version = "= 1.16.7"
  required_providers { google = { source = "hashicorp/google", version = "= 7.28.0" } }
  # Pre-existing Owner-only administrator state, separate from workload execution state.
  backend "gcs" {}
}
