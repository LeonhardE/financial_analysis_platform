"use client";

import { useLocale, useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import { PasskeyHelp } from "./PasskeyHelp";
import styles from "./VaultManagementPanel.module.css";

const ERRORS = new Set([
  "passkey_unsupported",
  "passkey_cancelled",
  "unlock_failed",
  "unlock_required",
  "wrong_account",
  "key_revoked",
  "device_limit",
  "version_conflict",
  "registry_conflict",
  "pending_registration",
  "operation_conflict",
  "device_change_pending",
  "device_change_conflict",
  "device_unavailable",
  "storage_unavailable",
  "service_unavailable",
  "request_timeout",
]);

export default function VaultManagementPanel({ workspace }: { workspace: HoldingsWorkspace }) {
  const t = useTranslations("vaultManagement"),
    locale = useLocale();
  const busy = Boolean(workspace.busy);
  const unlocked = Boolean(
    workspace.authenticated &&
    workspace.vaultConfigured &&
    workspace.phase === "unlocked" &&
    !workspace.needsDeviceApproval,
  );
  const candidate = workspace.keyManagement;
  const summary =
    unlocked &&
    workspace.vault &&
    candidate?.vaultId === workspace.vault.vaultId &&
    candidate?.rootKeyId === workspace.vault.rootKeyId
      ? candidate
      : null;
  const change = summary ? workspace.deviceChange : null;
  const pending = change ? summary?.pendingChange : null;
  const review = summary && !change ? workspace.deviceReview : null;
  const reviewedDevice = review
    ? summary?.devices.find((device) => device.deviceId === review.deviceId)
    : null;
  const reviewCurrent = Boolean(
    review &&
    summary?.canManage &&
    reviewedDevice?.active &&
    (review.action === "rotate" ? reviewedDevice.current : !reviewedDevice.current) &&
    review.registrySequence === summary?.registrySequence &&
    review.checkpointDigest === summary?.checkpointDigest,
  );
  const recovery =
    summary &&
    workspace.recoveryCheck?.rootKeyId === summary.rootKeyId &&
    workspace.recoveryCheck.registrySequence === summary.registrySequence
      ? workspace.recoveryCheck
      : null;
  const date = (value: string | number) => {
    const parsed = new Date(typeof value === "number" ? value * 1000 : value);
    return Number.isFinite(parsed.getTime())
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(parsed)
      : "—";
  };
  const error = workspace.error;
  const unlockOptions = { forResults: true, enableState: true };

  return (
    <section className={styles.panel} aria-labelledby="vault-management-title">
      <header className={styles.heading}>
        <div>
          <h2 id="vault-management-title">{t("title")}</h2>
          <p>{t("description")}</p>
        </div>
        <span className={styles.badge} data-unlocked={unlocked}>
          {t(unlocked ? "unlocked" : "locked")}
        </span>
      </header>
      <p>{t("identityHelp")}</p>
      {!workspace.vaultConfigured ? (
        <p className={styles.note} role="status">
          {t("notConfigured")}
        </p>
      ) : !workspace.authenticated ? (
        <div className={styles.callout}>
          <p>{t("signInHelp")}</p>
          <button
            type="button"
            className={styles.primary}
            disabled={!["anonymous", "error"].includes(workspace.authStatus)}
            onClick={() => void workspace.signIn()}
          >
            {t("signIn")}
          </button>
        </div>
      ) : workspace.phase === "checking" ? (
        <p role="status">{t("loading")}</p>
      ) : !unlocked ? (
        <div className={styles.callout}>
          <PasskeyHelp
            workspace={workspace}
            mode={workspace.phase === "needs-vault" ? "create" : "unlock"}
            unlockOptions={unlockOptions}
          />
          {!workspace.needsDeviceApproval && (
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() =>
                void (workspace.phase === "needs-vault"
                  ? workspace.create()
                  : workspace.unlock(unlockOptions))
              }
            >
              {t(workspace.phase === "needs-vault" ? "createLocal" : "unlockLocal")}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => void workspace.refreshKeyManagement()}
            >
              {t("refresh")}
            </button>
            <button type="button" className={styles.secondary} onClick={workspace.lock}>
              {t("lock")}
            </button>
          </div>
          {!summary ? (
            <p role="status">{t("loadDirectory")}</p>
          ) : (
            <>
              <div className={styles.sectionHeading}>
                <h3>{t("devicesTitle")}</h3>
                <p>{t("devicesHelp")}</p>
              </div>
              {!summary.canManage && (
                <div className={styles.callout}>
                  <p className={styles.warningText}>{t("readOnly")}</p>
                  {!change && !review && (
                    <>
                      <PasskeyHelp workspace={workspace} unlockOptions={unlockOptions} />
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={busy}
                        onClick={() => void workspace.unlock(unlockOptions)}
                      >
                        {t("enableChanges")}
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className={styles.devices}>
                {summary.devices.map((device) => (
                  <article className={styles.device} key={device.deviceId}>
                    <div className={styles.deviceHeading}>
                      <h4>{t(device.current ? "thisBrowser" : "otherDevice")}</h4>
                      <span className={styles.badge}>
                        {t(device.active ? "active" : "inactive")}
                      </span>
                    </div>
                    <dl>
                      <div>
                        <dt>{t("deviceId")}</dt>
                        <dd>
                          <code>{device.deviceId}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>{t("signingKey")}</dt>
                        <dd>
                          <code>{device.signingKeyId}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>{t("encryptionKey")}</dt>
                        <dd>
                          <code>{device.encryptionKeyId}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>{t("validity")}</dt>
                        <dd>
                          {date(device.notBefore)} – {date(device.expiresAt)}
                        </dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className={device.current ? styles.secondary : styles.danger}
                      disabled={
                        busy || !summary.canManage || !device.active || Boolean(change || review)
                      }
                      onClick={() =>
                        void workspace.reviewDeviceChange(
                          device.current ? "rotate" : "revoke",
                          device.deviceId,
                        )
                      }
                    >
                      {t(device.current ? "reviewRotate" : "reviewRevoke")}
                    </button>
                  </article>
                ))}
              </div>
              {review && (
                <div className={styles.review} role="group" aria-label={t("reviewTitle")}>
                  <h3>{t(review.action === "rotate" ? "rotateTitle" : "revokeTitle")}</h3>
                  <p>{t(review.action === "rotate" ? "rotateHelp" : "revokeHelp")}</p>
                  {reviewedDevice && (
                    <dl>
                      <div>
                        <dt>{t("deviceId")}</dt>
                        <dd>
                          <code>{reviewedDevice.deviceId}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>{t("signingKey")}</dt>
                        <dd>
                          <code>{reviewedDevice.signingKeyId}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>{t("encryptionKey")}</dt>
                        <dd>
                          <code>{reviewedDevice.encryptionKeyId}</code>
                        </dd>
                      </div>
                    </dl>
                  )}
                  <p className={styles.warningText}>{t("grantImpact")}</p>
                  <p className={styles.note}>{t("passkeyNotRevoked")}</p>
                  {!reviewCurrent && <p role="alert">{t("reviewStale")}</p>}
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={busy || !reviewCurrent}
                      onClick={() => void workspace.confirmDeviceChange()}
                    >
                      {t(review.action === "rotate" ? "confirmRotate" : "confirmRevoke")}
                    </button>
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void workspace.discardDeviceChange()}
                    >
                      {t("cancelReview")}
                    </button>
                  </div>
                </div>
              )}
              {change && (
                <div className={styles.review} role="status">
                  <h3>{t("pendingTitle")}</h3>
                  <p>
                    {t(
                      pending?.state === "applied"
                        ? "pendingApplied"
                        : pending?.state === "conflict"
                          ? "pendingConflict"
                          : "pendingReady",
                    )}
                  </p>
                  <p className={styles.note}>{t("grantImpact")}</p>
                  <div className={styles.actions}>
                    {pending?.state === "conflict" ? (
                      <button
                        type="button"
                        className={styles.danger}
                        disabled={busy}
                        onClick={() => void workspace.discardDeviceChange()}
                      >
                        {t("discardConflict")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={
                          busy || !pending || (pending.state === "ready" && !summary.canManage)
                        }
                        onClick={() => void workspace.confirmDeviceChange()}
                      >
                        {t(pending?.state === "applied" ? "recoverChange" : "retryChange")}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void workspace.refreshKeyManagement()}
                    >
                      {t("checkChange")}
                    </button>
                  </div>
                  <details className={styles.alternative}>
                    <summary>{t("operationDetails")}</summary>
                    <code>{change.operationId}</code>
                  </details>
                </div>
              )}
              <details className={styles.alternative}>
                <summary>{t("verificationDetails")}</summary>
                <p>{t("verificationHelp")}</p>
                <dl>
                  <div>
                    <dt>{t("rootFingerprint")}</dt>
                    <dd>
                      <code>{summary.rootKeyId}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("checkpoint")}</dt>
                    <dd>{summary.registrySequence}</dd>
                  </div>
                  <div>
                    <dt>{t("checkpointFingerprint")}</dt>
                    <dd>
                      <code>{summary.checkpointDigest}</code>
                    </dd>
                  </div>
                </dl>
              </details>
            </>
          )}
        </>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {t(`errors.${ERRORS.has(error) ? error : "request_failed"}`)}
        </p>
      )}
      {unlocked && workspace.keyNotice && t.has(`notices.${workspace.keyNotice}`) && (
        <p role="status">{t(`notices.${workspace.keyNotice}`)}</p>
      )}
      <div className={styles.recovery}>
        <h3>{t("recoveryTitle")}</h3>
        <p>{t("recoveryHelp")}</p>
        <p className={styles.warningText}>{t("recoveryLimits")}</p>
        {summary?.recovery && (
          <div className={styles.callout}>
            <strong>{t("recoveryCertificate")}</strong>
            <p>
              {t(summary.recovery.active ? "active" : "inactive")} · {t("validity")}:{" "}
              {date(summary.recovery.notBefore)} – {date(summary.recovery.expiresAt)}
            </p>
            <p className={styles.note}>{t("recoveryValidityHelp")}</p>
            <details className={styles.alternative}>
              <summary>{t("recoveryFingerprint")}</summary>
              <code>{summary.recovery.keyId}</code>
            </details>
          </div>
        )}
        {summary && (
          <>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy || !summary.recovery?.active}
              onClick={() => void workspace.verifyRecovery()}
            >
              {t("checkRecovery")}
            </button>
            <details className={styles.alternative}>
              <summary>{t("otherTitle")}</summary>
              <p>{t("otherHelp")}</p>
              <button
                type="button"
                className={styles.secondary}
                disabled={busy || !summary.recovery?.active}
                onClick={() => void workspace.verifyRecovery("other")}
              >
                {t("checkRecoveryOther")}
              </button>
            </details>
            {!summary.recovery?.active && (
              <p className={styles.warningText}>{t("recoveryUnavailable")}</p>
            )}
          </>
        )}
        {recovery && (
          <p role="status">{t("recoveryChecked", { date: date(recovery.checkedAt) })}</p>
        )}
        {workspace.busy === "verifying" && (
          <button type="button" className={styles.secondary} onClick={workspace.cancelOperation}>
            {t("cancelPasskey")}
          </button>
        )}
      </div>
    </section>
  );
}
