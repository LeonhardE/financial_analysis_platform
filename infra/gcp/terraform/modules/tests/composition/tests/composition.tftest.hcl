# Do not override computed values during plan: the regression requires unknown
# emails and resource IDs to reach consumer modules before any resource exists.
mock_provider "google" {
  override_during = apply
}

run "compose_new_identities_and_secret_with_stable_grant_keys" {
  command = plan

  assert {
    condition     = output.service_name == "example-api" && output.trigger_name == "build-example-api"
    error_message = "The composed modules must plan with new identities and secret IDs that remain unknown until apply."
  }
}
