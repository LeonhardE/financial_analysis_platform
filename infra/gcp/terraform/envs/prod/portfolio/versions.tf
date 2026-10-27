terraform {
  required_version = "= 1.16.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 7.28.0"
    }
  }

  # Provision this target's isolated bucket before later remote initialization.
  # Read-only pre-provision plans use a private local-backend copy, not this bucket.
  backend "gcs" {}
}
