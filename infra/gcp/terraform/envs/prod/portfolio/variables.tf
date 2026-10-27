variable "bootstrap_image" {
  description = "Creation-only Portfolio digest selected from independently reviewed target-trigger provenance; a plan candidate is not provisioning approval."
  type        = string
  # Existing manual build artifact for preview only; not first-provision approval.
  # Future approved provenance must be captured and its digest fixed in source.
  default  = "northamerica-northeast2-docker.pkg.dev/financial-analysis-512202/financial-analysis/portfolio-api@sha256:cefd9ca35d555f3c5a4c2f521dde71bd98f1f955bf9a07978f6e92f3138c8e98"
  nullable = false

  validation {
    condition     = can(regex("^northamerica-northeast2-docker\\.pkg\\.dev/financial-analysis-512202/financial-analysis/portfolio-api@sha256:[a-f0-9]{64}$", var.bootstrap_image))
    error_message = "Use the exact existing Toronto repository's Portfolio image and immutable digest, never a tag or another target."
  }
}
