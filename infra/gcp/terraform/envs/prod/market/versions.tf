terraform {
  required_version = "= 1.16.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 7.28.0"
    }
  }

  # The registered target runner supplies the isolated Market bucket and prefix.
  backend "gcs" {}
}
