variable "bootstrap_image" {
  description = "Creation-only Portfolio digest selected from independently reviewed target-trigger provenance; a plan candidate is not provisioning approval."
  type        = string
  # Audited main-only build 7dc66184-691c-4044-83d3-1a7b6efec113,
  # source 09f813c7369158b34dce036a51fc894160bf955a; creation only.
  default  = "northamerica-northeast2-docker.pkg.dev/financial-analysis-512202/financial-analysis/portfolio-api@sha256:93932b8af2887ac39d17bfec040f213416d8a1e8b2547b71c3aa9dedbab535cf"
  nullable = false

  validation {
    condition     = can(regex("^northamerica-northeast2-docker\\.pkg\\.dev/financial-analysis-512202/financial-analysis/portfolio-api@sha256:[a-f0-9]{64}$", var.bootstrap_image))
    error_message = "Use the exact existing Toronto repository's Portfolio image and immutable digest, never a tag or another target."
  }
}
