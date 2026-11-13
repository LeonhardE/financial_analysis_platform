import type { PersistentConnectionView } from "./persistent-experience-controller";
type J = Record<string, any>;
/** Presentation only. A slot is never fabricated and history never grants access. */
export function providerGroups(
  views: PersistentConnectionView[],
  states: Record<string, J>,
  now: number,
) {
  return ["muse", "chatgpt"].map((provider) => {
    const rows = views.filter((v) => v.connection.provider === provider),
      state = states[provider],
      slot = state?.slot;
    const live = rows.filter(
      (v) =>
        v.connection.status === "active" &&
        ["active", "expiring"].includes(v.credential?.status ?? "") &&
        v.credential!.expiresAt > now,
    );
    const ref = slot?.currentCredential;
    const current = slot
      ? ref
        ? (rows.find((v) => {
            const r = v.credential?.reference;
            return (
              r &&
              ["connectionId", "clientId", "credentialGeneration", "credentialFingerprint"].every(
                (k) => r[k] === ref[k],
              )
            );
          }) ?? null)
        : null
      : live.length === 1
        ? live[0]
        : rows.length === 1
          ? rows[0]
          : null;
    const reviewRequired = Boolean(
      state?.legacyBlockers?.length ||
      current?.error ||
      (!current && rows.some((v) => v.error)) ||
      (!slot && live.length > 1) ||
      (ref && !current),
    );
    return { provider, current, history: rows.filter((v) => v !== current), reviewRequired };
  });
}
