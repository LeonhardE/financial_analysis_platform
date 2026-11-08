/** Bounded public failure metadata; never project records, handles, actor values or stacks. */
const stages = ["profile_record_missing", "profile_validation_failed", "identity_key_mismatch"];
export function recoveryDiagnostic(value) {
  if (!value || !stages.includes(value.stage) || !/^profile:[a-f0-9]{64}$/.test(value.namespace))
    return null;
  const result = { stage: value.stage, namespace: value.namespace };
  if (value.stage === "identity_key_mismatch") {
    for (const name of ["signingKeyMatches", "encryptionKeyMatches", "identityActive"]) {
      if (typeof value[name] !== "boolean") return null;
      result[name] = value[name];
    }
  }
  return result;
}
export function recoveryFailure(error, diagnostic) {
  error.diagnostic = recoveryDiagnostic(diagnostic);
  return error;
}
