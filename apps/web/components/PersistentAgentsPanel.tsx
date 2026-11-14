"use client";
import { useEffect, useRef, useState, type MouseEvent } from "react";
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
import { providerGroups } from "@/lib/provider-groups";
import { ProviderMark } from "./ProviderMark";
import { ReportDialog } from "./ReportDialog";
import { LoadingIndicator, InlineError } from "./WorkspaceFeedback";
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
  } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setAuthorization(null);
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
    if (!value) return "statusUnavailable";
    if (!["active", "expiring"].includes(value.status) || value.expiresAt <= now)
      return "reauthorize";
    return value.expiresAt - now <= 604800 ? "expiring" : "connected";
  };
  const ready = model.loaded,
    readError = model.loadError,
    refreshing = model.loading,
    checking = model.unlocked && !ready && !readError,
    canChangeConnection = ready && !readError && !model.busy;
  const groups = providerGroups(ready ? model.views : [], ready ? model.providerStates : {}, now);
  const taskLink = (event: MouseEvent<HTMLAnchorElement>, taskId: string) => {
    if (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      window.history.pushState(null, "", `/tasks#task/${taskId}`);
    }
  };
  const currentAuthorization = authorization?.scope === scope ? authorization : null,
    currentAccount = account?.owner === model.owner ? account.value : null;
  const cancel = () => {
    handoff.current = null;
    setHandoffReady(false);
    setAuthorization(null);
  };
  const loadState =
    !workspace.authenticated ||
    !model.unlocked ||
    workspace.phase !== "unlocked" ||
    workspace.owner !== model.owner
      ? "locked"
      : readError || linkError || model.error
        ? "error"
        : !active ||
            !origin ||
            refreshing ||
            checking ||
            model.busy ||
            !ready ||
            model.displayState !== "ready"
          ? "loading"
          : "ready";
  return (
    <section
      className={styles.panel}
      aria-labelledby="agent-access-title"
      data-load-scope="agent-connections"
      data-load-state={loadState}
      aria-busy={checking || refreshing || model.busy}
    >
      <header className={styles.heading}>
        <div>
          <h1 id="agent-access-title">{t("title")}</h1>
          <p>{t("description")}</p>
        </div>
        <button
          className={styles.secondary}
          disabled={model.busy || model.loading}
          onClick={() => {
            void model.reload();
          }}
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
              onClick={() => void workspace.unlock({ forResults: true, enableState: true })}
            >
              {t("unlock")}
            </button>
          )}
        </div>
      ) : null}
      {model.waitingForService && <p role="status">{t("waitingForService")}</p>}
      {(linkError || (model.error && !model.loadError)) && (
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
                {currentAuthorization.value.providerState
                  ? t("replaceReview", {
                      count: currentAuthorization.value.providerState.retirementCandidates.length,
                    })
                  : t(currentAuthorization.value.renewing ? "restoreHelp" : "chooseTasks", {
                      provider: providerName(currentAuthorization.value.connection.provider),
                    })}
              </p>
              {currentAuthorization.value.providerState && (
                <p className={styles.note}>{t("taskReview")}</p>
              )}
              {!currentAuthorization.value.providerState &&
                (currentAuthorization.value.tasks.length ? (
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
                ))}
              <details>
                <summary>{t("moreOptions")}</summary>
                <AgentConnectionDuration
                  seconds={currentAuthorization.lifetimeSeconds}
                  pending={currentAuthorization.value.pendingLifetimeSeconds != null}
                  busy={model.busy}
                  onChange={(lifetimeSeconds) =>
                    setAuthorization((v) => (v ? { ...v, lifetimeSeconds } : v))
                  }
                />
              </details>
              <button
                className={styles.primary}
                disabled={model.busy || !workspace.canWriteState}
                onClick={() => void confirmAuthorization()}
              >
                {t(
                  currentAuthorization.value.renewing && !currentAuthorization.value.providerState
                    ? "confirmRestore"
                    : "confirm",
                )}
              </button>
            </>
          )}
          <button className={styles.textButton} disabled={model.busy} onClick={cancel}>
            {t("cancel")}
          </button>
        </div>
      )}
      <LoadingIndicator
        busy={checking || refreshing}
        hasContent={ready}
        label={t(ready ? "refreshing" : "loading")}
      />
      {model.unlocked && readError && (
        <InlineError
          message={t(ready ? "refreshFailed" : "loadFailed")}
          retryLabel={t("refresh")}
          onRetry={() => {
            void model.reload();
          }}
        />
      )}
      <div className={styles.connectionGrid}>
        {groups.map((group) => {
          const view = group.current,
            value = !model.unlocked
              ? "unlockStatus"
              : !ready
                ? readError
                  ? "statusUnavailable"
                  : "loading"
                : group.reviewRequired
                  ? "reviewRequired"
                  : view
                    ? status(view)
                    : "disconnected";
          return (
            <article
              key={group.provider}
              className={styles.setup}
              aria-busy={checking || refreshing}
            >
              <div className={styles.heading}>
                <div className={styles.providerHeader}>
                  <ProviderMark provider={group.provider} />
                  <h2>{providerName(group.provider)}</h2>
                </div>
                <span className={styles.stateBadge} data-checking={checking || refreshing}>
                  {t(value)}
                </span>
              </div>
              {view?.credential?.expiresAt && model.unlocked && (
                <p className={styles.note}>
                  {t("expires", { date: date(view.credential.expiresAt) })}
                </p>
              )}
              {group.reviewRequired && <p className={styles.note}>{t("reviewConnections")}</p>}
              {model.unlocked && view?.tasks.length ? (
                <ul className={styles.taskLinks}>
                  {view.tasks.map((task) => (
                    <li key={task.taskId}>
                      <a
                        href={`/tasks#task/${task.taskId}`}
                        onClick={(e) => taskLink(e, task.taskId)}
                      >
                        {task.title}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={!origin || !model.enabled || !canChangeConnection}
                  onClick={() => {
                    setHelp(group.provider);
                    setCopied(false);
                  }}
                >
                  {t(view ? "reauthorizeButton" : "connect", {
                    provider: providerName(group.provider),
                  })}
                </button>
                {view?.pending && (
                  <button
                    className={styles.secondary}
                    disabled={!canChangeConnection || !workspace.canWriteState}
                    onClick={() => void model.continueOperation(view.connection)}
                  >
                    {t("continue")}
                  </button>
                )}
                {view?.connection.status === "active" && (
                  <button
                    className={styles.textButton}
                    disabled={!canChangeConnection}
                    onClick={() => {
                      void model.disconnect(view.connection);
                    }}
                  >
                    {t("disconnect")}
                  </button>
                )}
              </div>
              {group.history.length > 0 && (
                <details className={styles.connectionHistory}>
                  <summary>{t("history", { count: group.history.length })}</summary>
                  {group.history.map((old) => (
                    <div className={styles.historyRow} key={old.connection.connectionId}>
                      <span>
                        {t(
                          old.credential || old.connection.status === "revoked"
                            ? status(old)
                            : "previousConnection",
                        )}
                        {old.credential?.expiresAt && model.unlocked
                          ? ` · ${date(old.credential.expiresAt)}`
                          : ""}
                      </span>
                      {old.pending && (
                        <button
                          disabled={!canChangeConnection || !workspace.canWriteState}
                          onClick={() => void model.continueOperation(old.connection)}
                        >
                          {t("continue")}
                        </button>
                      )}
                      {old.connection.status === "active" && (
                        <button
                          disabled={!canChangeConnection}
                          onClick={() => {
                            void model.disconnect(old.connection);
                          }}
                        >
                          {t("disconnect")}
                        </button>
                      )}
                    </div>
                  ))}
                </details>
              )}
            </article>
          );
        })}
        {["claude", "gemini"].map((provider) => (
          <article className={styles.unsupported} key={provider}>
            <ProviderMark provider={provider} />
            <strong>{provider === "claude" ? "Claude" : "Gemini"}</strong>
            <span>{t("notSupported")}</span>
          </article>
        ))}
      </div>
      <ReportDialog
        id="connect-agent"
        open={Boolean(help)}
        identity={`${model.owner}:${help}`}
        title={t("connect", { provider: providerName(help ?? "muse") })}
        closeLabel={t("close")}
        onClose={() => setHelp(null)}
      >
        <p>{t("reconnectHelp", { provider: providerName(help ?? "muse") })}</p>
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
      </ReportDialog>
      {workspace.authenticated && model.loaded && !model.enabled && !model.busy && (
        <p className={styles.note}>{t("notReady")}</p>
      )}
    </section>
  );
}
