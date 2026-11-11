# Retired independent Policy infrastructure

The undeployed standalone Policy resource and administrator roots have been
removed. This directory is a historical documentation location only; it contains
no Terraform configuration, state, resource instances or provisioning command.

Use the existing Agent Hub, Web and storage. No new project, witness database,
KMS key, build service or Policy runtime is needed for Agent-owned credentials.
The original implementation is preserved in Git history. Source removal performs
no cloud destroy and does not delete existing backups or recovery material.
