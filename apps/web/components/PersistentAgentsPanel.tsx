"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "./AuthProvider";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import type { PersistentWorkspaceModel } from "./usePersistentWorkspace";
import {
  DEFAULT_CONNECTION_SECONDS,
  TEMPORARY_CONNECTION_SECONDS,
  type PersistentConnection,
  type PersistentTask,
} from "@/lib/persistent-experience-controller";
import {
  agentAuthorizationHandoff,
  type AgentAuthorizationHandoff,
} from "@/lib/agent-authorization";
import {
  nativeHandoff,
  connectNativeOwnerBridge,
  type NativeOwnerBridge,
} from "@/lib/native-owner-bridge";
import styles from "./AgentsPanel.module.css";
const CONTRACT = "folioview.agent-workspace.v2.0";
type Json = Record<string, any>;
const providerName = (provider: string) => (provider === "chatgpt" ? "ChatGPT" : "Muse");
export function AgentConnectionDuration({
  seconds,
  pending,
  busy,
  onChange,
}: {
  seconds: number;
  pending: boolean;
  busy: boolean;
  onChange: (seconds: number) => void;
}) {
  const t = useTranslations("agentAccess");
  return (
    <>
      <label className={styles.durationChoice}>
        {t("durationLabel")}
        <select
          value={seconds}
          disabled={pending || busy}
          onChange={(e) => {
            const seconds = Number(e.target.value);
            if ([DEFAULT_CONNECTION_SECONDS, TEMPORARY_CONNECTION_SECONDS].includes(seconds))
              onChange(seconds);
          }}
        >
          <option value={DEFAULT_CONNECTION_SECONDS}>{t("duration90Days")}</option>
          <option value={TEMPORARY_CONNECTION_SECONDS}>{t("duration15Minutes")}</option>
        </select>
      </label>
      {pending && <p className={styles.note}>{t("durationPending")}</p>}
    </>
  );
}
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
  const t = useTranslations("agentAccess"),
    locale = useLocale(),
    auth = useAuth();
  const [accountBusy, setAccountBusy] = useState(false);
  const [bridge, setBridge] = useState<NativeOwnerBridge | null>(null),
    [account, setAccount] = useState<{ owner: string; value: Json } | null>(null),
    [help, setHelp] = useState<string | null>(null),
    [copied, setCopied] = useState(false),
    [handoffReady, setHandoffReady] = useState(false),
    [linkError, setLinkError] = useState(false),
    [now, setNow] = useState(() => Date.now() / 1000);
  const handoff = useRef<AgentAuthorizationHandoff | null>(null),
    oldOwner = useRef(model.owner);
  const scope = model.unlocked
    ? `${model.owner}:${workspace.vault?.vaultId ?? "unavailable"}:${workspace.vaultGeneration}`
    : null;
  const live = useRef({ scope, owner: model.owner, active });
  live.current = { scope, owner: model.owner, active };
  const [authorization, setAuthorization] = useState<{
      scope: string;
      value: Json;
      selected: string[];
      lifetimeSeconds: number;
    } | null>(null),
    [manage, setManage] = useState<{
      scope: string;
      connection: PersistentConnection;
      value: Json;
      selected: string[];
    } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setAuthorization(null);
    setManage(null);
  }, [scope]);
  useEffect(() => {
    if (oldOwner.current && oldOwner.current !== model.owner) {
      handoff.current = null;
      setHandoffReady(false);
      setAccount(null);
    }
    oldOwner.current = model.owner;
  }, [model.owner]);
  useEffect(() => {
    if (!active || !origin) return;
    try {
      const value = agentAuthorizationHandoff(window.location.hash, origin);
      if (value) {
        handoff.current = value;
        setHandoffReady(true);
        window.history.replaceState(null, "", "/agents");
      }
    } catch {
      setLinkError(true);
      window.history.replaceState(null, "", "/agents");
    }
    const abort = new AbortController();
    let attached: NativeOwnerBridge | null = null;
    try {
      const value = nativeHandoff(window.location.search);
      if (value)
        void connectNativeOwnerBridge(value, origin, abort.signal)
          .then((v) => {
            if (abort.signal.aborted) v.close();
            else {
              attached = v;
              setBridge(v);
            }
          })
          .catch(() => {
            if (!abort.signal.aborted) setLinkError(true);
          });
    } catch {
      setLinkError(true);
    }
    return () => {
      abort.abort();
      attached?.close();
      setBridge(null);
    };
  }, [active, origin]);
  useEffect(() => {
    if (!bridge || !model.owner || !active) return;
    const owner = model.owner,
      abort = new AbortController();
    void auth
      .requestNativeAccount(bridge, "pending", { contractVersion: CONTRACT }, owner, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted && live.current.owner === owner)
          setAccount({ owner, value: value as Json });
      })
      .catch(() => {
        if (!abort.signal.aborted) setLinkError(true);
      });
    return () => abort.abort();
  }, [bridge, model.owner, active, auth.requestNativeAccount]);
  const readAuthorization = async () => {
    const original = live.current.scope,
      value = handoff.current;
    if (!original || !value) return;
    const reviewed = await model.execute((c) => c.inspectAuthorization(value));
    if (reviewed && live.current.scope === original)
      setAuthorization({
        scope: original,
        value: reviewed,
        lifetimeSeconds: reviewed.pendingLifetimeSeconds ?? DEFAULT_CONNECTION_SECONDS,
        selected: reviewed.renewing
          ? reviewed.tasks.map((task: PersistentTask) => task.taskId)
          : [],
      });
  };
  const approveAccount = async () => {
    if (!bridge || !model.owner || !workspace.vault) return;
    if (accountBusy || !live.current.scope) return;
    const owner = model.owner;
    setAccountBusy(true);
    try {
      await auth.requestNativeAccount(
        bridge,
        "approve",
        { contractVersion: CONTRACT, vaultId: workspace.vault.vaultId },
        owner,
      );
      if (live.current.owner !== owner) return;
      setAccount(null);
      bridge.close();
      setBridge(null);
      window.history.replaceState(null, "", "/agents");
      await model.reload();
    } catch {
      if (live.current.owner === owner) setLinkError(true);
    } finally {
      setAccountBusy(false);
    }
  };
  const confirmAuthorization = async () => {
    const value = authorization?.scope === scope ? authorization : null,
      secret = handoff.current;
    if (!value || !secret) return;
    const result = await model.execute((c) =>
      c.authorize(secret, value.value, value.selected, value.lifetimeSeconds),
    );
    if (result && live.current.scope === value.scope) {
      handoff.current = null;
      setHandoffReady(false);
      setAuthorization(null);
      await model.reload();
    }
  };
  const reviewConnection = async (connection: PersistentConnection) => {
    const original = live.current.scope,
      value = await model.review(connection);
    if (value && original && live.current.scope === original)
      setManage({ scope: original, connection, value, selected: [] });
  };
  const date = (value: number) =>
    new Intl.DateTimeFormat(
      locale,
      Math.abs(value - now) <= 86400
        ? { dateStyle: "medium", timeStyle: "short" }
        : { dateStyle: "medium" },
    ).format(value * 1000);
  const status = (view: (typeof model.views)[number]) => {
    if (view.connection.status === "revoked") return "disconnected";
    const value = view.credential;
    if (!value || !["active", "expiring"].includes(value.status) || value.expiresAt <= now)
      return "reauthorize";
    return value.expiresAt - now <= 604800 ? "expiring" : "connected";
  };
  const currentAuthorization = authorization?.scope === scope ? authorization : null,
    currentManage = manage?.scope === scope ? manage : null,
    currentAccount = account?.owner === model.owner ? account.value : null;
  const cancel = () => {
    handoff.current = null;
    setHandoffReady(false);
    setAuthorization(null);
  };
  return (
    <section className={styles.panel} aria-labelledby="agent-access-title">
      <header className={styles.heading}>
        <div>
          <h1 id="agent-access-title">{t("title")}</h1>
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
        <div className={styles.unlock}>
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
      {model.waitingForService && <p role="status">{t("waitingForService")}</p>}
      {(linkError || model.error) && (
        <p role="alert" className={styles.warning}>
          {t(
            model.error === "review_changed"
              ? "reviewChanged"
              : model.error === "persistent_operation_pending"
                ? "continueHelp"
                : "requestFailed",
          )}
        </p>
      )}
      {currentAccount && (
        <div className={styles.setup}>
          <h2>
            {t("accountTitle", { provider: providerName(currentAccount.provider ?? "muse") })}
          </h2>
          <p>{t("accountHelp")}</p>
          <button
            className={styles.primary}
            disabled={accountBusy || !model.unlocked || !workspace.canWriteState}
            onClick={() => void approveAccount()}
          >
            {t("confirmAccount")}
          </button>
        </div>
      )}
      {handoffReady && (
        <div className={styles.setup}>
          <h2>{t("authorizeTitle")}</h2>
          {!currentAuthorization ? (
            <>
              <p>{t("authorizeHelp")}</p>
              <button
                className={styles.primary}
                disabled={!model.unlocked || model.busy || !model.enabled}
                onClick={() => void readAuthorization()}
              >
                {t("review")}
              </button>
            </>
          ) : (
            <>
              <p>
                {t(currentAuthorization.value.renewing ? "restoreHelp" : "chooseTasks", {
                  provider: providerName(currentAuthorization.value.connection.provider),
                })}
              </p>
              {currentAuthorization.value.tasks.length ? (
                <ul className={styles.taskChoices}>
                  {currentAuthorization.value.tasks.map((task: PersistentTask) => (
                    <li key={task.taskId}>
                      {currentAuthorization.value.renewing ? (
                        <span>{task.title}</span>
                      ) : (
                        <label>
                          <input
                            type="checkbox"
                            checked={currentAuthorization.selected.includes(task.taskId)}
                            onChange={(e) =>
                              setAuthorization((v) =>
                                v
                                  ? {
                                      ...v,
                                      selected: e.target.checked
                                        ? [...v.selected, task.taskId]
                                        : v.selected.filter((id) => id !== task.taskId),
                                    }
                                  : v,
                              )
                            }
                          />
                          {task.title}
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t("noAvailableTasks")}</p>
              )}
              <AgentConnectionDuration
                seconds={currentAuthorization.lifetimeSeconds}
                pending={currentAuthorization.value.pendingLifetimeSeconds != null}
                busy={model.busy}
                onChange={(lifetimeSeconds) =>
                  setAuthorization((v) => (v ? { ...v, lifetimeSeconds } : v))
                }
              />
              <button
                className={styles.primary}
                disabled={model.busy || !workspace.canWriteState}
                onClick={() => void confirmAuthorization()}
              >
                {t(currentAuthorization.value.renewing ? "confirmRestore" : "confirm")}
              </button>
            </>
          )}
          <button className={styles.textButton} disabled={model.busy} onClick={cancel}>
            {t("cancel")}
          </button>
        </div>
      )}
      <div className={styles.providers}>
        {["muse", "chatgpt"].map((provider) => (
          <button
            key={provider}
            className={styles.provider}
            disabled={!origin}
            onClick={() => {
              setHelp(provider);
              setCopied(false);
            }}
          >
            <strong>{t("connect", { provider: providerName(provider) })}</strong>
          </button>
        ))}
      </div>
      {help && (
        <div
          className={styles.setup}
          role="dialog"
          aria-label={t("connect", { provider: providerName(help) })}
        >
          <p>{t("reconnectHelp", { provider: providerName(help) })}</p>
          <button
            className={styles.secondary}
            disabled={!origin}
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
          <button className={styles.textButton} onClick={() => setHelp(null)}>
            {t("close")}
          </button>
        </div>
      )}
      {workspace.authenticated && !model.enabled && !model.busy && (
        <p className={styles.note}>{t("notReady")}</p>
      )}
      {!model.views.length && <p className={styles.empty}>{t("noConnections")}</p>}
      {model.views.map((view) => {
        const value = status(view),
          available = ["connected", "expiring"].includes(value);
        return (
          <article key={view.connection.connectionId} className={styles.setup}>
            <div className={styles.heading}>
              <h2>
                {providerName(view.connection.provider)} <small>{t(value)}</small>
              </h2>
              <div className={styles.actions}>
                <button
                  className={styles.secondary}
                  disabled={model.busy}
                  onClick={() => {
                    setHelp(view.connection.provider);
                    setCopied(false);
                  }}
                >
                  {t("reauthorizeButton")}
                </button>
                {view.connection.status === "active" && (
                  <button
                    className={styles.textButton}
                    disabled={model.busy}
                    onClick={() => void model.disconnect(view.connection)}
                  >
                    {t("disconnect")}
                  </button>
                )}
              </div>
            </div>
            {view.credential?.expiresAt && (
              <p>{t("expires", { date: date(view.credential.expiresAt) })}</p>
            )}
            {value === "expiring" && <p className={styles.warning}>{t("expiryHelp")}</p>}
            {value === "reauthorize" && (
              <p>{t("reauthorizeHelp", { provider: providerName(view.connection.provider) })}</p>
            )}
            {model.unlocked && view.tasks.length > 0 && (
              <ul>
                {view.tasks.map((task) => (
                  <li key={task.taskId}>
                    {task.title} ·{" "}
                    {t(
                      task.plan?.reported?.reportedStatus === "enabled" &&
                        task.plan.reported.taskPublicationFingerprint ===
                          task.plan.desired?.taskPublicationFingerprint
                        ? "planReported"
                        : "planWaiting",
                    )}
                    {task.content.deliveryExpectation && (
                      <small>
                        {" "}
                        · {task.content.deliveryExpectation.localTime} (
                        {task.content.deliveryExpectation.timeZone})
                      </small>
                    )}
                    {task.plan?.observed?.receivedAt != null && (
                      <small> · {t("reportReceived")}</small>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {view.pending && !available && (
              <button
                className={styles.secondary}
                disabled={model.busy || !workspace.canWriteState}
                onClick={() => void model.continueOperation(view.connection)}
              >
                {t("continue")}
              </button>
            )}
            {available && (
              <div className={styles.actions}>
                <button
                  className={styles.secondary}
                  disabled={model.busy || !workspace.canWriteState}
                  onClick={() => void model.resume(view.connection)}
                >
                  {t(view.pending ? "continue" : "restoreTasks")}
                </button>
                <button
                  className={styles.secondary}
                  disabled={model.busy || !workspace.canWriteState}
                  onClick={() => void reviewConnection(view.connection)}
                >
                  {t("manage")}
                </button>
                <button
                  className={styles.textButton}
                  disabled={model.busy || !workspace.canWriteState}
                  onClick={() => void model.synchronize(view.connection)}
                >
                  {t("sync")}
                </button>
              </div>
            )}
          </article>
        );
      })}
      {currentManage && (
        <div className={styles.setup} role="dialog" aria-label={t("manage")}>
          <h2>{t("manage")}</h2>
          <p>{t("chooseTasks", { provider: providerName(currentManage.connection.provider) })}</p>
          <ul className={styles.taskChoices}>
            {model.tasks
              .filter(
                (task) =>
                  !task.authority.authority ||
                  task.authority.authority.context.connectionId ===
                    currentManage.connection.connectionId,
              )
              .map((task) => (
                <li key={task.taskId}>
                  <label>
                    <input
                      type="checkbox"
                      checked={currentManage.selected.includes(task.taskId)}
                      onChange={(e) =>
                        setManage((v) =>
                          v
                            ? {
                                ...v,
                                selected: e.target.checked
                                  ? [...v.selected, task.taskId]
                                  : v.selected.filter((id) => id !== task.taskId),
                              }
                            : v,
                        )
                      }
                    />
                    {task.title}
                  </label>
                </li>
              ))}
          </ul>
          <button
            className={styles.primary}
            disabled={model.busy || !currentManage.selected.length}
            onClick={async () => {
              const result = await model.approve(
                currentManage.connection,
                model.tasks.filter((task) => currentManage.selected.includes(task.taskId)),
                currentManage.value,
                false,
              );
              if (result) setManage(null);
            }}
          >
            {t("approveTasks")}
          </button>
          {(currentManage.value.policy?.permissions ?? [])
            .filter((p: Json) => p.status === "active")
            .map((permission: Json) => (
              <div key={permission.permissionId} className={styles.actions}>
                <span>{t(permission.ref.kind)}</span>
                <button
                  className={styles.textButton}
                  disabled={model.busy}
                  onClick={async () => {
                    if (await model.withdraw(currentManage.connection, [permission.permissionId]))
                      setManage(null);
                  }}
                >
                  {t("withdraw")}
                </button>
              </div>
            ))}
          <button className={styles.textButton} onClick={() => setManage(null)}>
            {t("close")}
          </button>
        </div>
      )}
    </section>
  );
}
