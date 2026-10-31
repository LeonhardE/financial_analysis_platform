"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import styles from "./VaultManagementPanel.module.css";

export default function VaultKeyRenewalPanel({ workspace }: { workspace: HoldingsWorkspace }) {
  const t = useTranslations("vaultRenewal"),
    locale = useLocale();
  const scope = `${workspace.owner}:${workspace.vaultGeneration}:${workspace.vault?.vaultId}:${workspace.phase}`;
  const [cancellationReview, setCancellationReview] = useState<string | null>(null);
  useEffect(() => setCancellationReview(null), [scope]);
  const available = Boolean(
    workspace.authenticated &&
    workspace.vaultConfigured &&
    workspace.vault &&
    ["locked", "unlocked", "renewal-only"].includes(workspace.phase),
  );
  if (!available) return null;
  const busy = Boolean(workspace.busy);
  const candidate = workspace.keyRenewal;
  const summary =
    workspace.phase === "renewal-only" &&
    candidate?.vaultId === workspace.vault?.vaultId &&
    candidate?.rootKeyId === workspace.vault?.rootKeyId
      ? candidate
      : null;
  const pending = summary?.pending;
  const reviewingCancellation = cancellationReview === `${scope}:${pending?.operationId}`;
  const date = (seconds: number) => {
    const value = new Date(seconds * 1000);
    return Number.isFinite(value.getTime())
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(value)
      : "—";
  };
  return (
    <section className={styles.recovery} aria-labelledby="vault-renewal-title">
      <h3 id="vault-renewal-title">{t("title")}</h3>
      <p>{t("description")}</p>
      <p>{t("impact")}</p>
      {workspace.keyNotice === "key_renewal_saved" && <p role="status">{t("saved")}</p>}
      {workspace.keyNotice === "key_renewal_cancelled" && <p role="status">{t("cancelled")}</p>}
      {!summary ? (
        <>
          <p className={styles.note}>{t("help")}</p>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy || Boolean(workspace.archiveChange || workspace.deviceChange)}
            onClick={() => void workspace.reviewKeyRenewal()}
          >
            {t("review")}
          </button>
          <details className={styles.alternative}>
            <summary>{t("otherTitle")}</summary>
            <p>{t("otherHelp")}</p>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy || Boolean(workspace.archiveChange || workspace.deviceChange)}
              onClick={() => void workspace.reviewKeyRenewal("other")}
            >
              {t("reviewOther")}
            </button>
          </details>
        </>
      ) : (
        <div className={styles.review}>
          <p className={styles.warningText} role="status">
            {t("restricted")}
          </p>
          <h4>{t(pending ? "pendingTitle" : "reviewTitle")}</h4>
          {pending ? (
            <>
              <p>
                {t(
                  pending.state === "applied"
                    ? "pendingApplied"
                    : pending.state === "conflict"
                      ? "pendingConflict"
                      : "pendingReady",
                )}
              </p>
              <p>{t("expires", { date: date(pending.expiresAt) })}</p>
              {workspace.keyRenewalCancellation && <p role="status">{t("cancelPending")}</p>}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => void workspace.refreshKeyRenewal()}
                >
                  {t("check")}
                </button>
                {pending.state === "conflict" ? (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => void workspace.discardKeyRenewal()}
                  >
                    {t("discard")}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={busy || workspace.keyRenewalCancellation}
                      onClick={() => void workspace.confirmKeyRenewal()}
                    >
                      {t(pending.state === "applied" ? "finish" : "retry")}
                    </button>
                    {pending.state !== "applied" && (
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={busy}
                        onClick={() => setCancellationReview(`${scope}:${pending.operationId}`)}
                      >
                        {t("cancelCandidate")}
                      </button>
                    )}
                  </>
                )}
              </div>
              {reviewingCancellation && pending.state === "ready" && (
                <div className={styles.callout} role="group" aria-label={t("cancelConfirm")}>
                  <p>{t("cancelHelp")}</p>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={busy}
                      onClick={() => {
                        setCancellationReview(null);
                        void workspace.cancelKeyRenewal();
                      }}
                    >
                      {t("cancelConfirm")}
                    </button>
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => setCancellationReview(null)}
                    >
                      {t("keepCandidate")}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <p>{t("reviewHelp")}</p>
              <dl>
                <div>
                  <dt>{t("device")}</dt>
                  <dd>
                    {summary.device
                      ? t("expiry", { date: date(summary.device.expiresAt) })
                      : t("missingDevice")}
                  </dd>
                </div>
                {summary.recovery && (
                  <div>
                    <dt>{t("recovery")}</dt>
                    <dd>{t("expiry", { date: date(summary.recovery.expiresAt) })}</dd>
                  </div>
                )}
              </dl>
              {summary.reason && <p role="status">{t(`reasons.${summary.reason}`)}</p>}
              {workspace.configured && (
                <div className={styles.callout} role="group" aria-label={t("holdingsTitle")}>
                  <h4>{t("holdingsTitle")}</h4>
                  <p>{t("holdingsHelp")}</p>
                  {workspace.keyNotice === "renewal_holdings_none" && (
                    <p role="status">{t("holdingsNone")}</p>
                  )}
                  {workspace.keyNotice === "renewal_holdings_reconciled" && (
                    <p role="status">{t("holdingsReconciled")}</p>
                  )}
                  {workspace.renewalHoldings && (
                    <>
                      <p role="status">
                        {t(
                          workspace.renewalHoldings.status === "saved"
                            ? "holdingsSaved"
                            : "holdingsUnknown",
                        )}
                      </p>
                      <p>
                        {t("operation")}: <code>{workspace.renewalHoldings.operationId}</code>
                      </p>
                    </>
                  )}
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void workspace.reviewRenewalHoldings()}
                    >
                      {t("holdingsCheck")}
                    </button>
                    {workspace.renewalHoldings?.status === "saved" && (
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={busy}
                        onClick={() => void workspace.confirmRenewalHoldings()}
                      >
                        {t("holdingsConfirm")}
                      </button>
                    )}
                    {workspace.renewalHoldings && (
                      <button type="button" className={styles.secondary} onClick={workspace.lock}>
                        {t("holdingsKeep")}
                      </button>
                    )}
                  </div>
                </div>
              )}
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !summary.canRenew || Boolean(workspace.renewalHoldings)}
                onClick={() => void workspace.confirmKeyRenewal()}
              >
                {t("confirm")}
              </button>
            </>
          )}
          <details className={styles.alternative}>
            <summary>{t("details")}</summary>
            <p className={styles.note}>{t("root")}</p>
            <dl>
              <div>
                <dt>{t("rootFingerprint")}</dt>
                <dd>
                  <code>{summary.rootKeyId}</code>
                </dd>
              </div>
              <div>
                <dt>{t("registry")}</dt>
                <dd>{summary.registrySequence}</dd>
              </div>
              {pending && (
                <div>
                  <dt>{t("operation")}</dt>
                  <dd>
                    <code>{pending.operationId}</code>
                  </dd>
                </div>
              )}
            </dl>
          </details>
        </div>
      )}
      {(workspace.phase === "renewal-only" || workspace.busy === "reviewing-renewal") && (
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={workspace.lock}>
            {t(pending || busy ? "stop" : "cancelReview")}
          </button>
          {pending && <p className={styles.note}>{t("stopHelp")}</p>}
        </div>
      )}
      {workspace.error &&
        (workspace.keyRenewalFailure || workspace.error.startsWith("key_renewal_")) && (
          <p className={styles.error} role="alert">
            {t(
              t.has(`errors.${workspace.error}`)
                ? `errors.${workspace.error}`
                : "errors.request_failed",
            )}
          </p>
        )}
    </section>
  );
}
