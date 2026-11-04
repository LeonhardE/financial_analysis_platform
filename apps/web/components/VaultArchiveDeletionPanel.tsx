"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import styles from "./VaultManagementPanel.module.css";

const errors = new Set([
  "archive_local_pending",
  "archive_change_pending",
  "archive_deletion_unknown",
  "archive_deletion_unavailable",
  "archive_deletion_review_stale",
  "archive_deletion_unlock_required",
  "archive_session_stale",
  "storage_unavailable",
  "passkey_cancelled",
  "passkey_unsupported",
  "request_timeout",
  "service_unavailable",
  "untrusted_lifecycle",
  "operation_conflict",
]);

export default function VaultArchiveDeletionPanel({ workspace }: { workspace: HoldingsWorkspace }) {
  const t = useTranslations("vaultDeletion");
  const pending = workspace.archiveDeletion,
    review = workspace.archiveDeletionReview;
  const scope = `${workspace.owner}:${workspace.vault?.vaultId}:${workspace.vaultGeneration}:${workspace.phase}:${review?.lifecycleVersion}:${review?.archiveDigest}:${pending?.operationId}:${Boolean(workspace.recoveryExport)}:${workspace.busy}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [input, setInput] = useState({ scope, backup: false, withdraw: false });
  const visible = input.scope === scope ? input : { scope, backup: false, withdraw: false };
  useEffect(() => {
    setInput({ scope, backup: false, withdraw: false });
  }, [scope]);
  if (!workspace.authenticated || !workspace.vaultConfigured || !workspace.vault) return null;
  const unlocked = workspace.phase === "unlocked" && !workspace.needsDeviceApproval;
  const deleted = workspace.phase === "archive-deleted";
  const notice = workspace.keyNotice?.startsWith("archive_deletion_")
    ? workspace.keyNotice.slice(17)
    : null;
  if (!unlocked && !pending && !deleted && !notice && !workspace.archiveDeletionError) return null;
  const busy = Boolean(workspace.busy);
  const current = () => scopeRef.current === scope && !busy;
  const change = (value: Partial<typeof input>) =>
    current() &&
    setInput((previous) => ({
      ...(previous.scope === scope ? previous : { scope, backup: false, withdraw: false }),
      ...value,
      scope,
    }));
  return (
    <div className={styles.recovery} aria-labelledby="vault-archive-deletion-title">
      <h3 id="vault-archive-deletion-title">{t("title")}</h3>
      <p>{t("description")}</p>
      {notice && ["deleted", "withdrawn", "superseded"].includes(notice) && (
        <p role="status">{t(`notices.${notice}`)}</p>
      )}
      {deleted ? (
        <div className={styles.callout} role="status">
          <p>{t("deleted")}</p>
          <a href="#vault-recovery-title">{t("restoreLink")}</a>
        </div>
      ) : pending ? (
        <div className={styles.review}>
          <h4>{t(pending.withdrawalPending ? "withdrawalPendingTitle" : "pendingTitle")}</h4>
          <p>{t(pending.withdrawalPending ? "withdrawalPendingHelp" : "pendingHelp")}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => current() && void workspace.refreshArchiveDeletion()}
            >
              {t("check")}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy || !pending.operationId}
              onClick={() => current() && void workspace.resumeArchiveDeletion()}
            >
              {t(pending.withdrawalPending ? "retryWithdrawal" : "retryDeletion")}
            </button>
            {pending.canWithdraw && (
              <button
                type="button"
                className={styles.secondary}
                disabled={busy}
                onClick={() => change({ withdraw: true })}
              >
                {t("reviewWithdrawal")}
              </button>
            )}
          </div>
          {visible.withdraw && pending.canWithdraw && (
            <div className={styles.callout} role="group" aria-label={t("withdrawalTitle")}>
              <h4>{t("withdrawalTitle")}</h4>
              <p>{t("withdrawalHelp")}</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => {
                    if (!current()) return;
                    change({ withdraw: false });
                    void workspace.withdrawArchiveDeletion();
                  }}
                >
                  {t("confirmWithdrawal")}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => change({ withdraw: false })}
                >
                  {t("keepPending")}
                </button>
              </div>
              <details className={styles.alternative}>
                <summary>{t("otherPasskey")}</summary>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => {
                    if (!current()) return;
                    change({ withdraw: false });
                    void workspace.withdrawArchiveDeletion("other");
                  }}
                >
                  {t("withdrawOther")}
                </button>
              </details>
            </div>
          )}
          <details className={styles.alternative}>
            <summary>{t("operationDetails")}</summary>
            <code>{pending.operationId}</code>
          </details>
        </div>
      ) : unlocked && !workspace.archiveChange && !workspace.recoveryExport ? (
        <>
          <p className={styles.warningText}>{t("effects")}</p>
          {review ? (
            <div className={styles.review} role="group" aria-label={t("reviewTitle")}>
              <h4>{t("reviewTitle")}</h4>
              <p>{t("recoveryWarning")}</p>
              <p>
                <a href="#vault-recovery-title">{t("backupLink")}</a>
              </p>
              <label className={styles.deletionCheck}>
                <input
                  type="checkbox"
                  checked={visible.backup}
                  disabled={busy}
                  onChange={(event) => change({ backup: event.currentTarget.checked })}
                />
                <span>{t("backupConfirmation")}</span>
              </label>
              <details className={styles.alternative}>
                <summary>{t("libraryDetails")}</summary>
                <code>{review.rootKeyId}</code>
              </details>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={
                    busy ||
                    !visible.backup ||
                    workspace.archiveDeletionError === "archive_deletion_review_stale"
                  }
                  onClick={() => {
                    if (!current()) return;
                    change({ backup: false });
                    void workspace.confirmArchiveDeletion(true);
                  }}
                >
                  {t("confirmDeletion")}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => {
                    if (!current()) return;
                    change({ backup: false });
                    workspace.cancelArchiveDeletionReview();
                  }}
                >
                  {t("keepArchive")}
                </button>
                {workspace.archiveDeletionError === "archive_deletion_review_stale" && (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => {
                      if (!current()) return;
                      change({ backup: false });
                      void workspace.reviewArchiveDeletion();
                    }}
                  >
                    {t("reviewAgain")}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.danger}
              disabled={busy}
              onClick={() => {
                if (!current()) return;
                change({ backup: false });
                void workspace.reviewArchiveDeletion();
              }}
            >
              {t("reviewDeletion")}
            </button>
          )}
        </>
      ) : null}
      {workspace.archiveDeletionError && (
        <p className={styles.error} role="alert">
          {t(
            errors.has(workspace.archiveDeletionError)
              ? `errors.${workspace.archiveDeletionError}`
              : "errors.generic",
          )}
        </p>
      )}
    </div>
  );
}
