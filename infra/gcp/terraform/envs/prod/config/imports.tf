# Keep these imports as the reviewed adoption contract. Once recorded in the
# isolated Config state they are no-ops. The independent boundary read must fail
# planning if the existing service goes missing or changes identity.
import {
  to = module.runtime_identity.google_service_account.this
  id = "projects/financial-analysis-512202/serviceAccounts/fa-config-runtime@financial-analysis-512202.iam.gserviceaccount.com"
}

import {
  to = module.config.google_cloud_run_v2_service.service
  id = "projects/financial-analysis-512202/locations/northamerica-northeast2/services/config-api"
}
