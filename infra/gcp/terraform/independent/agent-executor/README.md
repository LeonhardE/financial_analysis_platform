# Retired Confidential VM infrastructure

The unused Executor resource and administrator roots have been removed. This
historical documentation location contains no Terraform configuration, resource
instances, state or provisioning command. The original design is in Git history.

The current Agent-owned credential route uses the existing Web, five services
and storage. It needs no Confidential VM, VPC, fixed TCP proxy, public IP,
certificate automation, state bucket, creator account or separate Executor project.
Source removal performs no cloud destroy and does not erase old recovery data.
