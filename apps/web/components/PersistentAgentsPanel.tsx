"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "./AuthProvider";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import type { PersistentWorkspaceModel } from "./usePersistentWorkspace";
import type { PersistentConnection, PersistentTask } from "@/lib/persistent-experience-controller";
import {
  nativeHandoff,
  connectNativeOwnerBridge,
  type NativeOwnerBridge,
} from "@/lib/native-owner-bridge";
import styles from "./AgentsPanel.module.css";
const CONTRACT = "folioview.agent-workspace.v2.0";
export function PersistentAgentsPanel({
  workspace,
  model,
  origin,
  active,
}: {
  workspace: HoldingsWorkspace;
  model: PersistentWorkspaceModel;
  origin: string | null;
  active: boolean;
}) {
  const t = useTranslations("persistent"),
    locale = useLocale(),
    auth = useAuth();
  const [bridge, setBridge] = useState<NativeOwnerBridge | null>(null),
    [accountState, setAccount] = useState<{ owner: string; value: Record<string, any> } | null>(
      null,
    ),
    [setup, setSetup] = useState<{ scope: string; value: Record<string, any> } | null>(null),
    [handoffError, setHandoffError] = useState(false),
    [copied, setCopied] = useState(false);
  const [review, setReview] = useState<{
    scope: string;
    connection: PersistentConnection;
    value: Record<string, any>;
    tasks: string[];
    reassign: boolean;
    confirmed: boolean;
  } | null>(null);
  const scope = model.unlocked ? `${model.owner}:${workspace.vaultGeneration}` : null;
  const live = useRef({ scope, owner: model.owner, active });
  live.current = { scope, owner: model.owner, active };
  const account = accountState?.owner === model.owner ? accountState.value : null;
  const accountJob = useRef<AbortController | null>(null);
  useEffect(() => {
    setReview(null);
    setSetup(null);
  }, [scope]);
  useEffect(() => {
    if (!active || !origin) return;
    const abort = new AbortController();
    let current: NativeOwnerBridge | null = null;
    try {
      const handoff = nativeHandoff(window.location.search);
      if (handoff)
        void connectNativeOwnerBridge(handoff, origin, abort.signal)
          .then((v) => {
            if (abort.signal.aborted) v.close();
            else {
              current = v;
              setBridge(v);
            }
          })
          .catch(() => {
            if (!abort.signal.aborted) setHandoffError(true);
          });
    } catch {
      setHandoffError(true);
    }
    return () => {
      abort.abort();
      current?.close();
      setBridge(null);
      accountJob.current?.abort();
    };
  }, [active, origin]);
  useEffect(() => {
    setAccount(null);
    if (!bridge || !model.owner || !active) return;
    const abort = new AbortController();
    accountJob.current = abort;
    void auth
      .requestNativeAccount(
        bridge,
        "pending",
        { contractVersion: CONTRACT },
        model.owner,
        abort.signal,
      )
      .then((v) => {
        if (!abort.signal.aborted)
          setAccount({ owner: model.owner!, value: v as Record<string, any> });
      })
      .catch(() => {
        if (!abort.signal.aborted) setHandoffError(true);
      });
    return () => abort.abort();
  }, [bridge, model.owner, active, auth.requestNativeAccount]);
  const readSetup = async () => {
    const q = new URLSearchParams(window.location.search),
      id = q.get("runtime_setup");
    if (
      q.size !== 1 ||
      q.getAll("runtime_setup").length !== 1 ||
      !id ||
      !/^setup_[A-Za-z0-9_-]{22,128}$/.test(id)
    ) {
      setHandoffError(true);
      return;
    }
    const original = live.current.scope;
    const value = await model.execute((c) => c.inspectSetup(id));
    if (original && live.current.scope === original && value) setSetup({ scope: original, value });
  };
  const approveAccount = async () => {
    if (!bridge || !model.owner || !model.unlocked || !workspace.vault || !account) return;
    const owner = model.owner,
      abort = new AbortController();
    accountJob.current?.abort();
    accountJob.current = abort;
    try {
      await auth.requestNativeAccount(
        bridge,
        "approve",
        { contractVersion: CONTRACT, vaultId: workspace.vault.vaultId },
        owner,
        abort.signal,
      );
      if (live.current.owner !== owner || abort.signal.aborted) return;
      setAccount(null);
      bridge.close();
      setBridge(null);
      window.history.replaceState(null, "", "/agents");
      await model.reload();
    } catch {
      if (!abort.signal.aborted && live.current.owner === owner) setHandoffError(true);
    }
  };
  const inspect = async (connection: PersistentConnection) => {
    const original = live.current.scope,
      value = await model.review(connection);
    if (original && live.current.scope === original && value)
      setReview({
        scope: original,
        connection,
        value,
        tasks: [],
        reassign: false,
        confirmed: false,
      });
  };
  const currentReview = scope && review?.scope === scope ? review : null,
    currentSetup = scope && setup?.scope === scope ? setup.value : null;
  const date = (n: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(n * 1000);
  const taskSchedule = (task: PersistentTask) => {
    const d = task.content.deliveryExpectation;
    return d !== null && d !== undefined ? `${d.localTime} · ${d.timeZone}` : t("manual");
  };
  const hasSetup =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("runtime_setup");
  return (
    <section className={styles.panel} aria-labelledby="persistent-agents-title">
      <header className={styles.heading}>
        <div>
          <h1 id="persistent-agents-title">{t("title")}</h1>
          <p>{t("description")}</p>
        </div>
        <button
          className={styles.secondary}
          disabled={model.busy}
          onClick={() => void model.reload()}
        >
          {t("refresh")}
        </button>
      </header>
      {!workspace.authenticated ? (
        <div className={styles.empty}>
          <p>{t("signInHelp")}</p>
          <button className={styles.primary} onClick={() => void workspace.signIn()}>
            {t("signIn")}
          </button>
        </div>
      ) : !model.unlocked ? (
        <div className={styles.unlock}>
          <p>{t("unlockHelp")}</p>
          {workspace.phase === "needs-device" ? (
            <a href="/settings">{t("deviceNeeded")}</a>
          ) : (
            <button
              className={styles.primary}
              disabled={!!workspace.busy}
              onClick={() => void workspace.unlock()}
            >
              {t("unlock")}
            </button>
          )}
        </div>
      ) : null}
      {(handoffError || model.error) && (
        <p className={styles.warning} role="alert">
          {t(
            model.error === "resource_not_approved"
              ? "reviewNeeded"
              : model.error === "review_changed"
                ? "reviewChanged"
                : "requestFailed",
          )}
        </p>
      )}
      {account && (
        <div className={styles.setup}>
          <h2>{t("connectTitle")}</h2>
          <p>{t("accountOnly")}</p>
          <button
            className={styles.primary}
            disabled={!model.unlocked || model.busy}
            onClick={() => void approveAccount()}
          >
            {t("connect")}
          </button>
        </div>
      )}
      {hasSetup && (
        <div className={styles.setup}>
          <h2>{t("pairTitle")}</h2>
          <p>{t("pairHelp")}</p>
          {!currentSetup ? (
            <button
              className={styles.primary}
              disabled={!model.unlocked || model.busy}
              onClick={() => void readSetup()}
            >
              {t("reviewConnection")}
            </button>
          ) : (
            <>
              <p>{currentSetup.setup.confirmed ? t("pairMatched") : t("pairWait")}</p>
              <details>
                <summary>{t("details")}</summary>
                <p>
                  {t("signingKey")}: <code>{currentSetup.offer?.signingKeyId}</code>
                </p>
                <p>
                  {t("encryptionKey")}: <code>{currentSetup.offer?.encryptionKeyId}</code>
                </p>
              </details>
              <button
                className={styles.primary}
                disabled={
                  model.busy ||
                  !currentSetup.setup.confirmed ||
                  !currentSetup.offer ||
                  !workspace.canWriteState
                }
                onClick={async () => {
                  const original = live.current.scope;
                  const result = await model.execute(async (c) => {
                    await c.enroll(currentSetup.setup.intentId, currentSetup);
                    return true;
                  });
                  if (result && original === live.current.scope) {
                    setSetup(null);
                    window.history.replaceState(null, "", "/agents");
                    await model.reload();
                  }
                }}
              >
                {t("confirmConnection")}
              </button>
            </>
          )}
        </div>
      )}
      <div className={styles.setup}>
        <h2>Muse</h2>
        <p>{t("connectOnce")}</p>
        {origin && (
          <div className={styles.address}>
            <code>{origin + "/mcp/v3"}</code>
            <button
              className={styles.secondary}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(origin + "/mcp/v3");
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {t(copied ? "copied" : "copyAddress")}
            </button>
          </div>
        )}
        <p>{t("syncHelp")}</p>
      </div>
      {model.views.length === 0 && <p className={styles.empty}>{t("noConnections")}</p>}
      {model.views.map((view) => (
        <article key={view.connection.connectionId} className={styles.setup}>
          <div className={styles.heading}>
            <h2>
              Muse{" "}
              <small>
                {t(
                  view.connection.status === "revoked"
                    ? "disconnected"
                    : view.connection.accountState === "relogin_required"
                      ? "relogin"
                      : view.identity
                        ? "connected"
                        : "pairPending",
                )}
              </small>
            </h2>
            {view.connection.status === "active" && (
              <button
                className={styles.secondary}
                disabled={model.busy}
                onClick={() => void model.disconnect(view.connection)}
              >
                {t("disconnect")}
              </button>
            )}
          </div>
          {view.error && <p role="status">{t("reviewNeeded")}</p>}
          {model.unlocked && view.connection.status === "active" && (
            <>
              <p>
                {t("permissionsCount", {
                  count:
                    view.policy?.permissions.filter((p: any) => p.status === "active").length ?? 0,
                })}
              </p>
              <button
                className={styles.primary}
                disabled={model.busy || !view.identity || !workspace.canWriteState}
                onClick={() => void inspect(view.connection)}
              >
                {t("reviewAccess")}
              </button>
              {view.pending && (
                <button
                  className={styles.secondary}
                  disabled={model.busy}
                  onClick={() => void model.resume(view.connection)}
                >
                  {t("resume")}
                </button>
              )}
              {view.policy?.permissions.some((p: any) => p.status === "active") && (
                <button
                  className={styles.secondary}
                  disabled={model.busy || !workspace.canWriteState}
                  onClick={() =>
                    void model.withdraw(
                      view.connection,
                      view
                        .policy!.permissions.filter((p: any) => p.status === "active")
                        .map((p: any) => p.permissionId),
                    )
                  }
                >
                  {t("withdraw")}
                </button>
              )}
              {view.tasks.map((task) => (
                <div className={styles.reconnect} key={task.taskId}>
                  <h3>{task.title}</h3>
                  <p>
                    {t("desired")}: {taskSchedule(task)}
                  </p>
                  <p>
                    {t("reported")}:{" "}
                    {t(
                      task.plan?.reported
                        ? task.plan.reported.taskPublicationFingerprint !==
                          task.plan.desired?.taskPublicationFingerprint
                          ? "planOutOfSync"
                          : `plan_${task.plan.reported.reportedStatus}`
                        : "plan_unconfirmed",
                    )}
                  </p>
                  <p>
                    {t("observed")}:{" "}
                    {task.plan?.observed
                      ? `${date(task.plan.observed.receivedAt ?? task.plan.observed.runCreatedAt)} · ${t(task.plan.observed.resultId ? "reportReceived" : "runReceived")}`
                      : t("notObserved")}
                  </p>
                  <p className={styles.note}>{t("planEvidenceHelp")}</p>
                  <a href="/inbox">{t("openInbox")}</a>
                </div>
              ))}
            </>
          )}
          <details>
            <summary>{t("details")}</summary>
            <p>
              {t("linkedAt")}: {date(view.connection.linkedAt)}
            </p>
            <p>
              {t("connectionId")}: <code>{view.connection.connectionId}</code>
            </p>
          </details>
        </article>
      ))}
      {currentReview && (
        <div className={styles.confirmation}>
          <h2>{t("accessTitle")}</h2>
          <p>{t("accessHelp")}</p>
          {model.tasks.map((task) => (
            <label key={task.taskId} style={{ display: "block", margin: "12px 0" }}>
              <input
                type="checkbox"
                checked={currentReview.tasks.includes(task.taskId)}
                onChange={(e) =>
                  setReview((r) =>
                    r
                      ? {
                          ...r,
                          tasks: e.target.checked
                            ? [...r.tasks, task.taskId]
                            : r.tasks.filter((id) => id !== task.taskId),
                          confirmed: false,
                        }
                      : r,
                  )
                }
              />
              {task.title} ·{" "}
              {task.packet.metadata.resourceBindings
                .map((b: any) => t(`resource_${b.ref.kind}`))
                .join("、")}
            </label>
          ))}
          <label style={{ display: "block", margin: "12px 0" }}>
            <input
              type="checkbox"
              checked={currentReview.reassign}
              onChange={(e) =>
                setReview((r) => (r ? { ...r, reassign: e.target.checked, confirmed: false } : r))
              }
            />
            {t("reassign")}
          </label>
          <label style={{ display: "block", margin: "12px 0" }}>
            <input
              type="checkbox"
              checked={currentReview.confirmed}
              onChange={(e) => setReview((r) => (r ? { ...r, confirmed: e.target.checked } : r))}
            />
            {t("confirmAccess")}
          </label>
          <button
            className={styles.primary}
            disabled={model.busy || !currentReview.tasks.length || !currentReview.confirmed}
            onClick={async () => {
              const original = live.current.scope;
              const success = await model.approve(
                currentReview.connection,
                model.tasks.filter((task) => currentReview.tasks.includes(task.taskId)),
                currentReview.value,
                currentReview.reassign,
              );
              if (success && original === live.current.scope) setReview(null);
            }}
          >
            {t("allowSelected")}
          </button>
          <button className={styles.secondary} onClick={() => setReview(null)}>
            {t("cancel")}
          </button>
        </div>
      )}
    </section>
  );
}
