"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import type { IndependentAgentModel } from "./useIndependentAgent";
import { independentHandoff } from "@/lib/independent-agent";
import { independentBindingKey } from "@/lib/independent-experience-controller";
import styles from "./AgentsPanel.module.css";
export function IndependentAgentPanel({
  workspace,
  model,
  active,
}: {
  workspace: HoldingsWorkspace;
  model: IndependentAgentModel;
  active: boolean;
}) {
  const t = useTranslations("independentAgent"),
    p = useTranslations("persistent"),
    locale = useLocale();
  const [selected, setSelected] = useState<string[]>([]),
    [reviewing, setReviewing] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [reassign, setReassign] = useState(false),
    [revokeConfirmed, setRevokeConfirmed] = useState(false),
    [pendingId, setPendingId] = useState<string | null>(null),
    [pending, setPending] = useState<any>(null),
    [consentConfirmed, setConsentConfirmed] = useState(false),
    [handoffError, setHandoffError] = useState(false),
    [copied, setCopied] = useState(false),
    [oauthSubmitted, setOauthSubmitted] = useState(false);
  const live = useRef({ scope: model.scope, active });
  live.current = { scope: model.scope, active };
  useEffect(() => {
    setSelected([]);
    setReviewing(false);
    setConfirmed(false);
    setReassign(false);
    setRevokeConfirmed(false);
    setPending(null);
    setConsentConfirmed(false);
    setOauthSubmitted(false);
  }, [model.scope, active]);
  useEffect(() => {
    if (!active) return;
    try {
      setPendingId(independentHandoff(window.location.search));
    } catch {
      setHandoffError(true);
    }
  }, [active]);
  const cfg = model.configuration;
  if (!cfg) return null;
  const view = model.view,
    trusted = !!view && !model.error && !!model.scope;
  const permissions =
    view?.review.policy?.permissions.filter((r: any) => r.status === "active") ?? [];
  const allowed = new Set<string>(
    view?.verified.scope.resourceBindings.map(independentBindingKey) ?? [],
  );
  const tasks = view?.tasks ?? [];
  const withinScope = (task: any) =>
    task.packet.metadata.resourceBindings.every((r: any) => allowed.has(independentBindingKey(r)));
  const date = (n: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(n * 1000);
  const current = (scope: string | null) =>
    !!scope && live.current.scope === scope && live.current.active;
  return (
    <section className={styles.panel} aria-labelledby="independent-agent-title">
      <header className={styles.heading}>
        <div>
          <h1 id="independent-agent-title">{t("title")}</h1>
          <p>{t("description")}</p>
        </div>
        <button
          className={styles.secondary}
          disabled={model.busy || !model.scope}
          onClick={() => void model.reload()}
        >
          {p("refresh")}
        </button>
      </header>
      {!workspace.authenticated ? (
        <div className={styles.empty}>
          <p>{t("signInHelp")}</p>
          <button className={styles.primary} onClick={() => void workspace.signIn()}>
            {p("signIn")}
          </button>
        </div>
      ) : !model.scope ? (
        <div className={styles.unlock}>
          <p>{p("unlockHelp")}</p>
          {workspace.phase === "needs-device" ? (
            <a href="/settings">{p("deviceNeeded")}</a>
          ) : (
            <button
              className={styles.primary}
              disabled={!!workspace.busy}
              onClick={() => void workspace.unlock()}
            >
              {p("unlock")}
            </button>
          )}
        </div>
      ) : null}
      {(model.error || handoffError) && (
        <p className={styles.warning} role="alert">
          {t(
            model.error === "connection_revoked"
              ? "revoked"
              : model.error === "migration_required"
                ? "migration"
                : model.error === "scope_extension_required"
                  ? "scopeExtension"
                  : "unavailable",
          )}
        </p>
      )}
      <div className={styles.setup}>
        <h2>{t(trusted ? "bindingVerified" : "preparing")}</h2>
        <p>{t("scheduleUnconfirmed")}</p>
        <p>{t("acceptancePending")}</p>
        <div className={styles.address}>
          <code>{cfg.audience}</code>
          <button
            className={styles.secondary}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(cfg.audience);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {p(copied ? "copied" : "copyAddress")}
          </button>
        </div>
        <p>{t("connectHelp")}</p>
        {trusted && (
          <>
            <p>{t("purpose")}</p>
            <p>{t("recipients")}</p>
            <p>{t(permissions.length ? "resourcesApproved" : "resourcesPaused")}</p>
            <p>{t("approvalUntil", { date: date(view.verified.approvalExpiresAt) })}</p>
            <ul>
              {view.verified.scope.resourceBindings.map((r: any) => (
                <li key={independentBindingKey(r)}>{p(`resource_${r.ref.kind}`)}</li>
              ))}
            </ul>
            <button
              className={styles.primary}
              disabled={model.busy || !workspace.canWriteState}
              onClick={() => {
                setReviewing(true);
                setSelected([]);
                setConfirmed(false);
              }}
            >
              {t("reviewTasks")}
            </button>
            {permissions.length > 0 && (
              <button
                className={styles.secondary}
                disabled={model.busy || !workspace.canWriteState}
                onClick={async () => {
                  const scope = model.scope;
                  const result = await model.run(async (c) => {
                    await c.content.revoke(
                      c.connection(),
                      permissions.map((r: any) => r.permissionId),
                    );
                    return true;
                  });
                  if (result && current(scope)) await model.reload();
                }}
              >
                {t("pause")}
              </button>
            )}
            {view.pending && (
              <button
                className={styles.secondary}
                disabled={model.busy}
                onClick={() => void model.reload()}
              >
                {p("resume")}
              </button>
            )}
            <a href="/inbox">{p("openInbox")}</a>
            {tasks
              .filter(
                (task: any) => task.authority.authority?.context.connectionId === cfg.connectionId,
              )
              .map((task: any) => (
                <div className={styles.reconnect} key={task.taskId}>
                  <h3>{task.title}</h3>
                  <p>
                    {p("desired")}:{" "}
                    {task.content.deliveryExpectation
                      ? `${task.content.deliveryExpectation.localTime} · ${task.content.deliveryExpectation.timeZone}`
                      : p("manual")}
                  </p>
                  <p>{t("scheduleUnconfirmed")}</p>
                  <a href="/inbox">{t("reportReceipts")}</a>
                </div>
              ))}
          </>
        )}
      </div>
      {trusted && reviewing && (
        <div className={styles.confirmation}>
          <h2>{t("reviewTitle")}</h2>
          <p>{t("reviewHelp")}</p>
          <p>
            {t("purpose")} {t("recipients")}
          </p>
          {tasks.length === 0 && (
            <p>
              <a href="/tasks">{t("createTask")}</a>
            </p>
          )}
          {tasks.map((task: any) => (
            <label key={task.taskId} style={{ display: "block", margin: "12px 0" }}>
              <input
                type="checkbox"
                checked={selected.includes(task.taskId)}
                disabled={!withinScope(task)}
                onChange={(e) => {
                  setSelected((v) =>
                    e.target.checked ? [...v, task.taskId] : v.filter((id) => id !== task.taskId),
                  );
                  setConfirmed(false);
                }}
              />
              {task.title} ·{" "}
              {task.packet.metadata.resourceBindings
                .map((r: any) => p(`resource_${r.ref.kind}`))
                .join("、")}
              {!withinScope(task) && <small>{t("scopeExtension")}</small>}
            </label>
          ))}
          <label style={{ display: "block", margin: "12px 0" }}>
            <input
              type="checkbox"
              checked={reassign}
              onChange={(e) => {
                setReassign(e.target.checked);
                setConfirmed(false);
              }}
            />
            {p("reassign")}
          </label>
          <label style={{ display: "block", margin: "12px 0" }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t("confirmResources")}
          </label>
          <button
            className={styles.primary}
            disabled={model.busy || !selected.length || !confirmed}
            onClick={async () => {
              const scope = model.scope;
              const result = await model.run(async (c) => {
                await c.approve(
                  tasks.filter((v: any) => selected.includes(v.taskId)),
                  view.review,
                  reassign,
                );
                return true;
              });
              if (result && current(scope)) {
                setReviewing(false);
                await model.reload();
              }
            }}
          >
            {p("allowSelected")}
          </button>
          <button className={styles.secondary} onClick={() => setReviewing(false)}>
            {p("cancel")}
          </button>
        </div>
      )}
      {pendingId && (
        <div className={styles.confirmation}>
          <h2>{t("nativeTitle")}</h2>
          <p>{t("nativeHelp")}</p>
          {!pending ? (
            <button
              className={styles.primary}
              disabled={!trusted || model.busy || oauthSubmitted}
              onClick={async () => {
                const scope = model.scope,
                  value = await model.run((c) => c.authorize(pendingId));
                if (value && current(scope)) {
                  setPending(value.pending);
                  setConsentConfirmed(false);
                }
              }}
            >
              {t("reviewNative")}
            </button>
          ) : (
            <>
              <p>
                {t("purpose")} {t("recipients")}
              </p>
              <p>{t("nativeScope")}</p>
              <label>
                <input
                  type="checkbox"
                  checked={consentConfirmed}
                  onChange={(e) => setConsentConfirmed(e.target.checked)}
                />
                {t("confirmNative")}
              </label>
              <button
                className={styles.primary}
                disabled={
                  !trusted ||
                  model.busy ||
                  !consentConfirmed ||
                  oauthSubmitted ||
                  !workspace.canWriteState
                }
                onClick={async () => {
                  const scope = model.scope;
                  setOauthSubmitted(true);
                  const target = await model.run((c) => c.approveAuthorization(pendingId, pending));
                  if (target && current(scope)) window.location.assign(target);
                }}
              >
                {t("allowNative")}
              </button>
              {oauthSubmitted && <p role="status">{t("nativeRetry")}</p>}
            </>
          )}
        </div>
      )}
      {model.scope && (
        <div className={styles.reconnect}>
          <label>
            <input
              type="checkbox"
              checked={revokeConfirmed}
              onChange={(e) => setRevokeConfirmed(e.target.checked)}
            />
            {t("confirmRevoke")}
          </label>
          <button
            className={styles.secondary}
            disabled={model.busy || !revokeConfirmed || !workspace.canWriteState}
            onClick={async () => {
              const scope = model.scope;
              await model.run((c) => c.revoke());
              if (current(scope)) await model.reload();
            }}
          >
            {t("revoke")}
          </button>
        </div>
      )}
    </section>
  );
}
