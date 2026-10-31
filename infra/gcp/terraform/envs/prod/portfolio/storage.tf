locals {
  # The implemented stores use exact document IDs. These opaque strings, maps and
  # arrays are never queried; recursively indexing proofs would add no value.
  unindexed_fields = {
    portfolio_authorities      = ["rootJwk", "registryHistory", "resourceRef", "writerKeyIds", "recipientKeyIds"]
    portfolio_snapshots        = ["carrierJson", "keyProofs", "receipt"]
    portfolio_operations       = ["receipt"]
    portfolio_source_states    = ["resourceRef"]
    portfolio_source_mutations = ["resourceRef"]
  }
  index_exemptions = merge([for collection, fields in local.unindexed_fields : {
    for field in fields : "${collection}_${field}" => {
      collection = collection
      field      = field
    }
  }]...)
}

# An exemption is not retention or TTL. Preserve receipts/history indefinitely;
# no correctness-bearing state is deleted by a timer.
resource "google_firestore_field" "opaque" {
  for_each = local.index_exemptions

  project    = local.project_id
  database   = module.database.database_id
  collection = each.value.collection
  field      = each.value.field
  index_config {}

  lifecycle { prevent_destroy = true }
}

output "index_exemptions" {
  description = "Implemented Portfolio opaque fields, with no single-field indexes or TTL."
  value       = local.index_exemptions
}
