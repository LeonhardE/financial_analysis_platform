"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import { useAgentConnections, type AgentConnectionsModel } from "./useAgentConnections";
import { useAgentLinkConfiguration } from "./useAgentLinkConfiguration";
import type { AgentLinkConfiguration } from "@/lib/agent-link";
import styles from "./AgentsPanel.module.css";
import { AgentConsentCard } from "./AgentConsentCard";
import { useAgentConsent } from "./useAgentConsent";
import { consentHandoff, type ConsentHandoff } from "@/lib/owner-consent-bridge";

type PublicConfiguration = {
  data: AgentLinkConfiguration | null;
  loading: boolean;
  error: boolean;
};
export function AgentsView({
  workspace,
  model,
  configuration,
  consent,
}: {
  workspace: HoldingsWorkspace;
  model: AgentConnectionsModel;
  configuration: PublicConfiguration;
  consent?: ReactNode;
}) {
  const t = useTranslations("agents"),
    locale = useLocale();
  const [copyNotice, setCopyNotice] = useState(false);
  const currentOwner = useRef(model.owner);
  currentOwner.current = model.owner;
  const selected = model.selected;
  const privateTask =
    model.unlocked &&
    workspace.owner === model.owner &&
    workspace.authenticated &&
    workspace.phase === "unlocked"
      ? model.privateTask
      : null;
  const date = (value: number) =>
    Number.isSafeInteger(value) && Number.isFinite(new Date(value * 1000).getTime())
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(value * 1000),
        )
      : "—";
  const short = (value: string) =>
    value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
  const mcp = configuration.data?.enabled ? `${configuration.data.hubOrigin}/mcp/v2` : null;
  const copy = async () => {
    const owner = model.owner;
    if (!mcp || !owner) return;
    try {
      await navigator.clipboard.writeText(mcp);
      if (currentOwner.current === owner) setCopyNotice(true);
    } catch {
      if (currentOwner.current === owner) setCopyNotice(false);
    }
  };
  return (
    <section className={styles.panel} aria-labelledby="agents-title">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 id="agents-title">{t("title")}</h1>
          <p>{t("description")}</p>
        </div>
        {model.authenticated && model.configured && (
          <button
            className={styles.secondary}
            disabled={model.loading || model.busy}
            onClick={() => void model.reload()}
          >
            {t("refresh")}
          </button>
        )}
      </header>
      <div className={styles.providers} aria-label={t("providers")}>
        <div className={styles.provider} data-selected="true">
          <span className={styles.providerMark}>M</span>
          <div>
            <strong>Meta Muse</strong>
            <small>{t("museFirst")}</small>
          </div>
          <span className={styles.badge}>{t("foreground")}</span>
        </div>
        {["ChatGPT", "Gemini", "Claude"].map((name) => (
          <button key={name} className={styles.provider} disabled>
            <span className={styles.providerMark}>{name.slice(0, 1)}</span>
            <span>
              <strong>{name}</strong>
              <small>{t("later")}</small>
            </span>
          </button>
        ))}
      </div>
      {!model.configured ? (
        <div className={styles.empty}>
          <h2>{t("unavailableTitle")}</h2>
          <p>{t("unavailable")}</p>
        </div>
      ) : !model.authenticated ? (
        <div className={styles.empty}>
          <h2>{t("signInTitle")}</h2>
          <p>{t("signInHelp")}</p>
          <button
            className={styles.primary}
            disabled={!["anonymous", "error"].includes(workspace.authStatus)}
            onClick={() => void workspace.signIn()}
          >
            {t("signIn")}
          </button>
        </div>
      ) : (
        <>
          <details className={styles.setup}>
            <summary>{t("setupTitle")}</summary>
            <p>{t("setupHelp")}</p>
            <ol>
              <li>{t("setupSteps.add")}</li>
              <li>{t("setupSteps.approve")}</li>
              <li>{t("setupSteps.foreground")}</li>
            </ol>
            {configuration.loading ? (
              <p role="status">{t("loading")}</p>
            ) : mcp ? (
              <div className={styles.address}>
                <code>{mcp}</code>
                <button className={styles.secondary} onClick={() => void copy()}>
                  {t("copyAddress")}
                </button>
                {copyNotice && <span role="status">{t("copied")}</span>}
              </div>
            ) : (
              <p>{t("addressUnavailable")}</p>
            )}
            <p className={styles.note}>{t("setupNoSchedule")}</p>
          </details>
          {consent}
          {model.error && (
            <div className={styles.warning} role="alert">
              <strong>{t("attention")}</strong>
              <p>
                {t(
                  t.has(`errors.${model.error}`)
                    ? `errors.${model.error}`
                    : "errors.request_failed",
                )}
              </p>
              {model.uncertain && (
                <button
                  className={styles.secondary}
                  disabled={model.busy}
                  onClick={() => void model.reload()}
                >
                  {t("checkLatest")}
                </button>
              )}
            </div>
          )}
          {model.notice === "revoked" && (
            <p className={styles.feedback} role="status">
              {t("revokedNotice")}
            </p>
          )}
          <div className={styles.layout}>
            <aside className={styles.listColumn}>
              <h2>{t("connections")}</h2>
              {model.loading && <p role="status">{t("loading")}</p>}
              {!model.loading && model.items.length === 0 && (
                <div className={styles.empty}>
                  <h3>{t("noConnections")}</h3>
                  <p>{t("noConnectionsHelp")}</p>
                </div>
              )}
              {model.items.map((connection, index) => (
                <button
                  key={connection.connectionId}
                  className={styles.connection}
                  data-selected={connection.connectionId === selected?.connectionId}
                  disabled={model.busy}
                  onClick={() => model.select(connection.connectionId)}
                >
                  <strong>{t("connectionName", { number: index + 1 })}</strong>
                  <span>{short(connection.connectionId)}</span>
                  <div>
                    <span>{t(`statuses.${connection.status}`)}</span>
                    <span>{t("taskCount", { count: connection.grants.length })}</span>
                  </div>
                  <small>{t("authorizedAt", { date: date(connection.authorizedAt) })}</small>
                </button>
              ))}
            </aside>
            {selected ? (
              <article className={styles.detail}>
                <div className={styles.detailTop}>
                  <h2>Meta Muse</h2>
                  <span className={styles.badge}>{t(`statuses.${selected.status}`)}</span>
                </div>
                <p className={styles.identifier}>{selected.connectionId}</p>
                <dl className={styles.facts}>
                  <dt>{t("client")}</dt>
                  <dd>{selected.clientId}</dd>
                  <dt>{t("expires")}</dt>
                  <dd>{date(selected.expiresAt)}</dd>
                  <dt>{t("apiAccess")}</dt>
                  <dd>{t(selected.status === "active" ? "apiAuthorized" : "apiInactive")}</dd>
                </dl>
                <p className={styles.note}>{t("permissionSeparation")}</p>
                <details>
                  <summary>{t("scopes")}</summary>
                  <ul>
                    {selected.approvedScopes.map((scope) => (
                      <li key={scope}>{t(`scopesList.${scope.replaceAll(":", "_")}`)}</li>
                    ))}
                  </ul>
                </details>
                <div className={styles.grants}>
                  <h3>{t("authorizedTasks")}</h3>
                  {selected.grants.map((grant) => (
                    <section key={grant.grantId} className={styles.grant}>
                      <div className={styles.detailTop}>
                        <strong>
                          {privateTask?.metadata.taskId === grant.taskId &&
                          privateTask.metadata.taskVersion === grant.taskVersion
                            ? privateTask.content.name
                            : t("encryptedTask")}
                        </strong>
                        <span className={styles.badge}>{t(`statuses.${grant.status}`)}</span>
                      </div>
                      <p className={styles.identifier}>
                        {grant.taskId} · {t("version", { version: grant.taskVersion })}
                      </p>
                      <ul className={styles.evidence}>
                        <li>{t(grant.signedGrantPresent ? "grantStored" : "noContentGrant")}</li>
                        <li>{t(grant.readObserved ? "readObserved" : "notReadObserved")}</li>
                        <li>{t(grant.resultSaved ? "resultSaved" : "noResultSaved")}</li>
                      </ul>
                      <p className={styles.note}>{t("evidenceHelp")}</p>
                      <ul className={styles.resourceList}>
                        {grant.resourceBindings.map((binding) => (
                          <li key={binding.ref.resourceId}>
                            {t(`kinds.${binding.ref.kind}`)} · {short(binding.ref.resourceId)} ·{" "}
                            {t("sourceEpoch", { epoch: binding.sourceEpoch })}
                          </li>
                        ))}
                      </ul>
                      <div className={styles.actions}>
                        <button
                          className={styles.secondary}
                          disabled={!model.unlocked || model.busy}
                          onClick={() =>
                            void model.inspectGrant(selected.connectionId, grant.grantId)
                          }
                        >
                          {t("inspectTask")}
                        </button>
                        <button
                          className={styles.textButton}
                          disabled={
                            model.busy ||
                            model.loading ||
                            model.uncertain ||
                            selected.status === "revoked" ||
                            grant.status === "revoked"
                          }
                          onClick={() =>
                            model.reviewRevoke({
                              connectionId: selected.connectionId,
                              grantId: grant.grantId,
                            })
                          }
                        >
                          {t("revokeTask")}
                        </button>
                      </div>
                    </section>
                  ))}
                </div>
                {!model.unlocked && (
                  <div className={styles.unlock}>
                    <p>{t("unlockHelp")}</p>
                    <button
                      className={styles.secondary}
                      disabled={Boolean(workspace.busy)}
                      onClick={() => void workspace.unlock({ forResults: true })}
                    >
                      {t("unlock")}
                    </button>
                  </div>
                )}
                {privateTask && (
                  <div className={styles.privateTask}>
                    <span className={styles.badge}>{t("localPreview")}</span>
                    <h3>{privateTask.content.name}</h3>
                    <p>{privateTask.content.goal}</p>
                    <ol>
                      {privateTask.content.outputSpec.sections.map((section) => (
                        <li key={section.sectionId}>
                          <strong>{section.title}</strong>
                          <p>{section.instructions}</p>
                        </li>
                      ))}
                    </ol>
                    <p className={styles.note}>{t("versionReadOnly")}</p>
                  </div>
                )}
                <div className={styles.revoke}>
                  <h3>{t("revokeConnection")}</h3>
                  <p>{t("revokeHelp")}</p>
                  <button
                    className={styles.secondary}
                    disabled={
                      model.busy ||
                      model.loading ||
                      model.uncertain ||
                      selected.status === "revoked"
                    }
                    onClick={() =>
                      model.reviewRevoke({ connectionId: selected.connectionId, grantId: null })
                    }
                  >
                    {t("reviewRevoke")}
                  </button>
                </div>
              </article>
            ) : (
              <div className={styles.empty}>
                <h2>{t("selectTitle")}</h2>
                <p>{t("selectHelp")}</p>
              </div>
            )}
          </div>
          {model.confirmation && (
            <div className={styles.confirmation} role="group" aria-label={t("confirmTitle")}>
              <h2>{t("confirmTitle")}</h2>
              <p>{t(model.confirmation.grantId === null ? "confirmConnection" : "confirmTask")}</p>
              <p>{t("retentionWarning")}</p>
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={model.busy}
                  onClick={() => void model.revoke()}
                >
                  {t("confirmRevoke")}
                </button>
                <button
                  className={styles.secondary}
                  disabled={model.busy}
                  onClick={model.cancelRevoke}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}
          <details className={styles.attempts}>
            <summary>{t("attempts")}</summary>
            {model.attempts.length === 0 ? (
              <p>{t("noAttempts")}</p>
            ) : (
              <ul>
                {model.attempts.map((attempt) => (
                  <li key={attempt.requestId}>
                    <span>{short(attempt.requestId)}</span>
                    <strong>{t(`attemptStatuses.${attempt.status}`)}</strong>
                    <small>{date(attempt.updatedAt)}</small>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </>
      )}
    </section>
  );
}

export default function AgentsPanel({
  workspace,
  active,
}: {
  workspace: HoldingsWorkspace;
  active: boolean;
}) {
  const model = useAgentConnections(workspace, { active });
  const configuration = useAgentLinkConfiguration(active);
  const [handoff, setHandoff] = useState<ConsentHandoff | null>(null);
  const [invalidHandoff, setInvalidHandoff] = useState(false);
  useEffect(() => {
    try {
      setHandoff(consentHandoff(window.location.search));
    } catch {
      setInvalidHandoff(true);
    }
  }, []);
  const consent = useAgentConsent(workspace, configuration.data, handoff, active);
  return (
    <AgentsView
      workspace={workspace}
      model={model}
      configuration={configuration}
      consent={
        <AgentConsentCard workspace={workspace} model={consent} invalidHandoff={invalidHandoff} />
      }
    />
  );
}
