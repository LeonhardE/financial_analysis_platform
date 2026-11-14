"use client";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import Disclosure from "./Disclosure";
import styles from "./SettingsPanel.module.css";

function PendingSection() {
  const t = useTranslations("settings");
  return (
    <div className={styles.sectionLoading} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      {t("loading")}
    </div>
  );
}
const Management = dynamic(() => import("./VaultManagementPanel"), { loading: PendingSection });
const ACCESS_ERRORS = new Set([
  "passkey_unsupported",
  "passkey_cancelled",
  "unlock_failed",
  "wrong_account",
  "key_revoked",
]);

export default function SettingsSecurityPanel({ workspace }: { workspace: HoldingsWorkspace }) {
  const t = useTranslations("settings.security");
  const errors = useTranslations("vaultManagement.errors");
  const archiveUnavailable = workspace.vault?.archive === null;
  const unlocked =
    workspace.authenticated &&
    workspace.vaultConfigured &&
    !archiveUnavailable &&
    workspace.phase === "unlocked" &&
    !workspace.needsDeviceApproval;
  const exceptional = ["renewal-only", "archive-pending", "archive-deleted"].includes(
    workspace.phase,
  );
  const status =
    workspace.phase === "checking"
      ? "checking"
      : !workspace.authenticated
        ? "signedOut"
        : !workspace.vaultConfigured
          ? "notConfigured"
          : workspace.needsDeviceApproval
            ? "needsApproval"
            : workspace.phase === "needs-vault"
              ? "notSetUp"
              : exceptional || archiveUnavailable
                ? "attention"
                : unlocked
                  ? "unlocked"
                  : "locked";
  const action = !workspace.authenticated
    ? "signIn"
    : workspace.phase === "needs-vault"
      ? "setUp"
      : unlocked
        ? "lock"
        : "unlock";
  const disabled =
    Boolean(workspace.busy) ||
    !workspace.vaultConfigured ||
    workspace.phase === "checking" ||
    exceptional ||
    (!workspace.authenticated && !["anonymous", "error"].includes(workspace.authStatus));
  const devicesPending = Boolean(
    workspace.needsDeviceApproval || workspace.deviceChange || workspace.deviceReview,
  );
  const recoveryPending = Boolean(
    archiveUnavailable ||
    workspace.archiveChange ||
    workspace.recoveryExport ||
    workspace.phase === "archive-pending",
  );
  const showPrimary = !exceptional && !archiveUnavailable && !workspace.needsDeviceApproval;
  const dangerPending =
    exceptional ||
    Boolean(
      workspace.keyRenewalFailure ||
      workspace.keyRenewal ||
      workspace.archiveDeletionReview ||
      workspace.archiveDeletion ||
      workspace.archiveDeletionError,
    );
  return (
    <section className={styles.securityCard} aria-labelledby="settings-security-title">
      <header className={styles.securityHeading}>
        <h2 id="settings-security-title">{t("title")}</h2>
        <span className={styles.accessBadge} data-unlocked={unlocked}>
          {t(status)}
        </span>
      </header>
      <div className={styles.accessRow}>
        <div>
          <strong>{t("passkey")}</strong>
          <p>{t(unlocked ? "privateDataOpen" : !showPrimary ? "followSection" : "passkeyHelp")}</p>
        </div>
        {workspace.busy === "verifying" ? (
          <button type="button" className={styles.accessButton} onClick={workspace.cancelOperation}>
            {t("cancel")}
          </button>
        ) : (
          showPrimary && (
            <button
              type="button"
              className={styles.accessButton}
              disabled={disabled}
              onClick={() => {
                if (!workspace.authenticated) void workspace.signIn();
                else if (workspace.phase === "needs-vault") void workspace.create();
                else if (unlocked) workspace.lock();
                else void workspace.unlock({ forResults: true, enableState: true });
              }}
            >
              {t(action)}
            </button>
          )
        )}
      </div>
      {ACCESS_ERRORS.has(workspace.error) && <p role="alert">{errors(workspace.error)}</p>}
      <div className={styles.deviceSummary}>
        <span>{t("thisDevice")}</span>
        <span>
          {t(
            workspace.needsDeviceApproval
              ? "needsApproval"
              : unlocked
                ? "accessAvailable"
                : "unlockToCheck",
          )}
        </span>
      </div>
      <Disclosure
        title={t("manageDevices")}
        forceOpen={devicesPending}
        onOpen={() => {
          const currentDirectory =
            workspace.vault &&
            workspace.keyManagement?.vaultId === workspace.vault.vaultId &&
            workspace.keyManagement?.rootKeyId === workspace.vault.rootKeyId;
          if (unlocked && !currentDirectory && !workspace.busy)
            void workspace.refreshKeyManagement();
        }}
      >
        <Management workspace={workspace} section="devices" />
      </Disclosure>
      <Disclosure title={t("recovery")} forceOpen={recoveryPending}>
        <Management workspace={workspace} section="recovery" />
      </Disclosure>
      <Disclosure title={t("advanced")} danger forceOpen={dangerPending}>
        <Management workspace={workspace} section="advanced" />
      </Disclosure>
    </section>
  );
}
