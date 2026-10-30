"use client";

import { useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import styles from "./VaultManagementPanel.module.css";

export function PasskeyHelp({
  workspace,
  mode = "unlock",
  unlockOptions,
}: {
  workspace: HoldingsWorkspace;
  mode?: "create" | "unlock";
  unlockOptions?: { forResults?: boolean; enableState?: boolean };
}) {
  const t = useTranslations("vaultManagement");
  const busy = Boolean(workspace.busy);
  if (!workspace.authenticated) return null;
  if (workspace.needsDeviceApproval)
    return (
      <div className={styles.review} role="group" aria-label={t("deviceApprovalTitle")}>
        <strong>{t("deviceApprovalTitle")}</strong>
        <p>{t("deviceApprovalHelp")}</p>
        <p className={styles.note}>{t("deviceApprovalTrust")}</p>
        {workspace.vault && (
          <dl>
            <dt>{t("rootFingerprint")}</dt>
            <dd>
              <code>{workspace.vault.rootKeyId}</code>
            </dd>
          </dl>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={() => void workspace.confirmDeviceRegistration()}
          >
            {t("approveBrowser")}
          </button>
          <button type="button" className={styles.secondary} onClick={workspace.lock}>
            {t("cancelAndLock")}
          </button>
        </div>
      </div>
    );
  return (
    <div className={styles.passkeyHelp}>
      <p>{t("identityHelp")}</p>
      {mode === "create" && <p className={styles.warningText}>{t("firstUseLoss")}</p>}
      {mode === "create" &&
        ["passkey_unsupported", "passkey_cancelled"].includes(workspace.error) && (
          <p className={styles.note}>{t("unusedCredential")}</p>
        )}
      <p className={styles.note}>{t("localFirst")}</p>
      {mode === "unlock" && <p className={styles.note}>{t("samePasskey")}</p>}
      <details className={styles.alternative}>
        <summary>{t("otherTitle")}</summary>
        <p>{t(mode === "create" ? "createOtherHelp" : "otherHelp")}</p>
        <p className={styles.note}>{t("otherNoFallback")}</p>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() =>
            void (mode === "create"
              ? workspace.create({ method: "other" })
              : workspace.unlock({ ...unlockOptions, method: "other" }))
          }
        >
          {t(mode === "create" ? "createOther" : "unlockOther")}
        </button>
      </details>
      {(workspace.busy === "creating" || workspace.busy === "unlocking") && (
        <button type="button" className={styles.secondary} onClick={workspace.cancelOperation}>
          {t("cancelPasskey")}
        </button>
      )}
    </div>
  );
}
