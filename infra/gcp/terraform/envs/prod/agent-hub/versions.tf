terraform {
  required_version = "= 1.16.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 7.28.0"
    }
  }

  # The future target runner uses its own bucket and prod/agent-hub prefix.
  backend "gcs" {}
}
