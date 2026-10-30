"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import styles from "./VaultManagementPanel.module.css";

const MAX_RECOVERY_FILE = 128 * 1024;
const empty = { scope: "", review: false, file: "", fileName: "", code: "", error: "" };

export default function VaultRecoveryPanel({ workspace }: { workspace: HoldingsWorkspace }) {
  const t = useTranslations("vaultRecovery");
  const scope = `${workspace.owner ?? ""}:${workspace.vault?.vaultId ?? ""}:${workspace.vaultGeneration}:${workspace.phase}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const fileRequest = useRef(0);
  const [input, setInput] = useState(empty);
  const visible = input.scope === scope ? input : { ...empty, scope };
  const busy = Boolean(workspace.busy);
  const available = Boolean(
    workspace.authenticated &&
    workspace.vaultConfigured &&
    workspace.vault &&
    ["locked", "unlocked", "needs-device"].includes(workspace.phase),
  );
  const unlocked = available && workspace.phase === "unlocked" && !workspace.needsDeviceApproval;
  const exported =
    unlocked &&
    workspace.recoveryExport?.vaultId === workspace.vault?.vaultId &&
    workspace.recoveryExport?.rootKeyId === workspace.vault?.rootKeyId
      ? workspace.recoveryExport
      : null;
  const pending = available ? workspace.archiveChange : null;

  useEffect(() => {
    setInput({ ...empty, scope });
    fileRequest.current += 1;
    return () => {
      fileRequest.current += 1;
    };
  }, [scope, workspace.phase]);

  if (!available) return null;
  const changeInput = (value: Partial<typeof empty>) =>
    setInput((previous) => ({ ...(previous.scope === scope ? previous : empty), scope, ...value }));
  const readFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    const request = ++fileRequest.current;
    changeInput({ file: "", fileName: "", error: "" });
    if (!file) return;
    if (file.size < 1 || file.size > MAX_RECOVERY_FILE) {
      changeInput({ error: "file_size" });
      return;
    }
    try {
      const text = await file.text();
      if (scopeRef.current !== scope || fileRequest.current !== request) return;
      if (!text || text.length > MAX_RECOVERY_FILE) throw new Error("file_size");
      changeInput({ file: text, fileName: file.name });
    } catch {
      if (scopeRef.current === scope && fileRequest.current === request)
        changeInput({ error: "file_read" });
    }
  };
  const recover = (method: "local" | "other" = "local") => {
    if (busy || !visible.file || !/^[A-Za-z0-9_-]{43}$/.test(visible.code)) return;
    const file = visible.file,
      code = visible.code;
    fileRequest.current += 1;
    setInput({ ...empty, scope });
    void workspace.recoverWithKit(file, code, method);
  };
  const download = () => {
    if (!exported || busy || scopeRef.current !== scope) return;
    const blob = new Blob([exported.file], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    try {
      link.href = url;
      link.download = `folioview-recovery-${exported.vaultId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
      document.body.appendChild(link);
      link.click();
    } finally {
      link.remove();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className={styles.recovery} aria-labelledby="vault-recovery-title">
      <h3 id="vault-recovery-title">{t("title")}</h3>
      <p>{t("description")}</p>
      <p className={styles.warningText}>{t("limits")}</p>
      {workspace.keyNotice === "archive_change_saved" && <p role="status">{t("saved")}</p>}
      {workspace.keyNotice === "archive_change_cancelled" && <p role="status">{t("cancelled")}</p>}
      {pending ? (
        <div className={styles.review} role="status">
          <h4>{t("pendingTitle")}</h4>
          <p>
            {t(
              pending.state === "applied"
                ? "pendingApplied"
                : pending.state === "conflict"
                  ? "pendingConflict"
                  : "pendingReady",
            )}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => void workspace.refreshArchiveChange()}
            >
              {t("checkPending")}
            </button>
            {pending.state !== "conflict" && (
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                onClick={() => void workspace.confirmArchiveChange()}
              >
                {t(pending.state === "applied" ? "finishPending" : "retryPending")}
              </button>
            )}
            {pending.state !== "applied" && (
              <button
                type="button"
                className={styles.secondary}
                disabled={busy}
                onClick={() => changeInput({ review: true })}
              >
                {t("cancelChange")}
              </button>
            )}
          </div>
          {visible.review && pending.state !== "applied" && (
            <div className={styles.callout} role="group" aria-label={t("cancelChangeTitle")}>
              <h4>{t("cancelChangeTitle")}</h4>
              <p>{t("cancelChangeHelp")}</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={busy}
                  onClick={() => {
                    changeInput({ review: false });
                    void workspace.cancelArchiveChange();
                  }}
                >
                  {t("confirmCancelChange")}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => changeInput({ review: false })}
                >
                  {t("keepChange")}
                </button>
              </div>
            </div>
          )}
          {!unlocked && <p className={styles.note}>{t("unlockPending")}</p>}
          <details className={styles.alternative}>
            <summary>{t("operationDetails")}</summary>
            <code>{pending.operationId}</code>
          </details>
        </div>
      ) : unlocked ? (
        <>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy || Boolean(exported)}
              onClick={() => void workspace.exportRecoveryKit()}
            >
              {t("export")}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy || Boolean(exported)}
              onClick={() => changeInput({ review: true })}
            >
              {t("change")}
            </button>
          </div>
          {exported && (
            <div className={styles.review} role="group" aria-label={t("exportTitle")}>
              <h4>{t("exportTitle")}</h4>
              <p>{t("exportHelp")}</p>
              <ol className={styles.recoverySteps}>
                <li>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy}
                    onClick={download}
                  >
                    {t("download")}
                  </button>
                </li>
                <li>
                  <label className={styles.recoveryLabel} htmlFor="vault-recovery-export-code">
                    {t("code")}
                  </label>
                  <input
                    id="vault-recovery-export-code"
                    className={styles.recoveryInput}
                    value={exported.code}
                    readOnly
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className={styles.note}>{t("codeHelp")}</p>
                </li>
              </ol>
              <p>{t("exportCheck")}</p>
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                onClick={() => workspace.clearRecoveryExport()}
              >
                {t("hideExport")}
              </button>
            </div>
          )}
          {visible.review && !exported && (
            <div className={styles.review} role="group" aria-label={t("changeTitle")}>
              <h4>{t("changeTitle")}</h4>
              <p>{t("changeHelp")}</p>
              <p className={styles.note}>{t("localFirst")}</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => {
                    changeInput({ review: false });
                    void workspace.changePasskey();
                  }}
                >
                  {t("confirmChange")}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => changeInput({ review: false })}
                >
                  {t("cancel")}
                </button>
              </div>
              <details className={styles.alternative}>
                <summary>{t("otherTitle")}</summary>
                <p>{t("otherHelp")}</p>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => {
                    changeInput({ review: false });
                    void workspace.changePasskey("other");
                  }}
                >
                  {t("changeOther")}
                </button>
              </details>
            </div>
          )}
        </>
      ) : null}
      {workspace.phase === "locked" && !pending && (
        <details className={styles.alternative}>
          <summary>{t("importTitle")}</summary>
          <p>{t("importHelp")}</p>
          <p className={styles.note}>{t("deviceHelp")}</p>
          <div className={styles.recoveryForm}>
            <label className={styles.recoveryLabel} htmlFor="vault-recovery-file">
              {t("file")}
            </label>
            <input
              key={`${scope}:file`}
              id="vault-recovery-file"
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => void readFile(event)}
            />
            {visible.fileName && <p>{t("fileReady", { name: visible.fileName })}</p>}
            <label className={styles.recoveryLabel} htmlFor="vault-recovery-code">
              {t("code")}
            </label>
            <input
              key={`${scope}:code`}
              id="vault-recovery-code"
              type="password"
              className={styles.recoveryInput}
              autoComplete="off"
              spellCheck={false}
              maxLength={43}
              value={visible.code}
              disabled={busy}
              onChange={(event) =>
                changeInput({ code: event.currentTarget.value.trim(), error: "" })
              }
            />
            <p className={styles.note}>{t("importPrivacy")}</p>
          </div>
          {visible.error && (
            <p className={styles.error} role="alert">
              {t(`errors.${visible.error}`)}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !visible.file || !/^[A-Za-z0-9_-]{43}$/.test(visible.code)}
              onClick={() => recover()}
            >
              {t("recover")}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => {
                fileRequest.current += 1;
                setInput({ ...empty, scope });
                workspace.cancelRecovery();
              }}
            >
              {t("clearImport")}
            </button>
          </div>
          <details className={styles.alternative}>
            <summary>{t("otherTitle")}</summary>
            <p>{t("otherHelp")}</p>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy || !visible.file || !/^[A-Za-z0-9_-]{43}$/.test(visible.code)}
              onClick={() => recover("other")}
            >
              {t("recoverOther")}
            </button>
          </details>
        </details>
      )}
      {workspace.phase === "locked" && (
        <details className={styles.alternative}>
          <summary>{t("resumeTitle")}</summary>
          <p>{t("resumeHelp")}</p>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => {
              fileRequest.current += 1;
              setInput({ ...empty, scope });
              void workspace.resumeArchiveWithNewPasskey();
            }}
          >
            {t("resume")}
          </button>
          <details className={styles.alternative}>
            <summary>{t("otherTitle")}</summary>
            <p>{t("otherHelp")}</p>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => {
                fileRequest.current += 1;
                setInput({ ...empty, scope });
                void workspace.resumeArchiveWithNewPasskey("other");
              }}
            >
              {t("resumeOther")}
            </button>
          </details>
        </details>
      )}
      {busy &&
        ["recovering", "changing-passkey", "exporting-recovery", "restoring-recovery"].includes(
          workspace.busy ?? "",
        ) && (
          <button type="button" className={styles.secondary} onClick={workspace.cancelOperation}>
            {t("cancelOperation")}
          </button>
        )}
    </div>
  );
}
