export { OwnerConsentBridge, checkedCallback, startConsentPage } from "./consent.mjs";
import { startConsentPage } from "./consent.mjs";
if (typeof document !== "undefined") void startConsentPage();
