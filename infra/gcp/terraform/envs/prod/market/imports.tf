# Keep these imports as the reviewed adoption contract. Once recorded in the
# isolated Market state they are no-ops. The independent boundary read must fail
# planning if the existing service goes missing or changes identity.
import {
  to = module.runtime_identity.google_service_account.this
  id = "projects/financial-analysis-512202/serviceAccounts/fa-api-runtime@financial-analysis-512202.iam.gserviceaccount.com"
}

import {
  to = module.market.google_cloud_run_v2_service.service
  id = "projects/financial-analysis-512202/locations/northamerica-northeast2/services/market-api"
}
