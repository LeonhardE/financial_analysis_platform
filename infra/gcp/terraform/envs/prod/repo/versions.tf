terraform {
  required_version = "= 1.16.7"

  # Filled by execution tooling; backend settings are not ordinary variables.
  backend "gcs" {}
}
