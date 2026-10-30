"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import { useInbox, type InboxModel } from "./useInbox";
import { SafeReportMarkdown, reportLink } from "./SafeReportMarkdown";
import {
  clearInboxResultLink,
  inboxResultHref,
  isAgentConsentHandoff,
  readInboxResultLink,
  type InboxResultLink,
} from "@/lib/inbox-link";
import styles from "./InboxPanel.module.css";
import { PasskeyHelp } from "./PasskeyHelp";

const FILTERS = ["all", "unread", "starred", "archived"] as const;
const ERRORS = new Set([
  "invalid_response",
  "service_unavailable",
  "session_expired",
  "insufficient_scope",
  "version_conflict",
  "request_timeout",
  "unlock_required",
  "verification_failed",
  "render_rejected",
  "not_found",
  "pending_state",
  "state_outcome_unknown",
  "passkey_unsupported",
  "passkey_cancelled",
  "unlock_failed",
  "wrong_account",
  "untrusted_vault",
]);
const NOTICES = new Set([
  "state_saved",
  "state_conflict",
  "state_recovered",
  "no_loaded_match",
  "new_results",
]);

export function InboxView({
  workspace,
  model,
}: {
  workspace: HoldingsWorkspace;
  model: InboxModel;
}) {
  const t = useTranslations("inbox");
  const locale = useLocale();
  const [copyConfirm, setCopyConfirm] = useState(false);
  const [copyNotice, setCopyNotice] = useState<"copied" | "copyFailed" | "">("");
  const unlocked =
    model.unlocked &&
    workspace.phase === "unlocked" &&
    workspace.authenticated &&
    !workspace.needsDeviceApproval;
  const selected = unlocked ? model.selected : null;
  const selectedLink =
    selected && inboxResultHref(selected.metadata.resultId, selected.metadata.revision);
  const selection = `${workspace.owner}:${workspace.vaultGeneration}:${selected?.metadata.resultId}:${selected?.metadata.revision}`;
  const currentSelection = useRef(selection);
  currentSelection.current = selection;
  useEffect(() => {
    setCopyConfirm(false);
    setCopyNotice("");
  }, [selection, unlocked]);
  const busy = Boolean(model.busy || workspace.busy);
  const date = (value: string) => {
    const timestamp = new Date(value);
    return Number.isFinite(timestamp.getTime())
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
          timestamp,
        )
      : "—";
  };
  const short = (value: string) =>
    value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-5)}` : value;
  const failure = model.error || (workspace.phase !== "unlocked" ? workspace.error : "");
  const copy = async () => {
    const original = currentSelection.current;
    const text = model.copyText();
    if (!text) {
      setCopyConfirm(false);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (currentSelection.current === original) setCopyNotice("copied");
    } catch {
      if (currentSelection.current === original) setCopyNotice("copyFailed");
    } finally {
      if (currentSelection.current === original) setCopyConfirm(false);
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="inbox-title">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 id="inbox-title">{t("title")}</h1>
          <p>{t("description")}</p>
        </div>
        {model.authenticated && model.configured && (
          <div className={styles.headerActions}>
            <span className={styles.badge} data-unlocked={unlocked}>
              {t(unlocked ? "unlocked" : "locked")}
            </span>
            {unlocked && (
              <button className={styles.secondary} onClick={workspace.lock}>
                {t("lock")}
              </button>
            )}
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={() => void model.reload()}
            >
              {t("refresh")}
            </button>
          </div>
        )}
      </header>
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
            disabled={workspace.authStatus !== "anonymous" && workspace.authStatus !== "error"}
            onClick={() => void workspace.signIn()}
          >
            {t("signIn")}
          </button>
        </div>
      ) : (
        <>
          {workspace.phase === "checking" ? (
            <p role="status">{t("loading")}</p>
          ) : (
            !unlocked && (
              <div className={styles.unlock}>
                <div>
                  <strong>
                    {t(workspace.phase === "needs-vault" ? "createTitle" : "unlockTitle")}
                  </strong>
                  <p>{t(workspace.phase === "needs-vault" ? "createHelp" : "unlockHelp")}</p>
                  <PasskeyHelp
                    workspace={workspace}
                    mode={workspace.phase === "needs-vault" ? "create" : "unlock"}
                    unlockOptions={{ forResults: true }}
                  />
                </div>
                <button
                  className={styles.primary}
                  disabled={Boolean(busy || workspace.needsDeviceApproval)}
                  onClick={() =>
                    void (workspace.phase === "needs-vault"
                      ? workspace.create()
                      : workspace.unlock({ forResults: true }))
                  }
                >
                  {t(
                    workspace.busy === "unlocking" || workspace.busy === "creating"
                      ? "unlocking"
                      : workspace.phase === "needs-vault"
                        ? "create"
                        : "unlock",
                  )}
                </button>
              </div>
            )
          )}
          {unlocked && !model.canWriteState && (
            <div className={styles.unlock}>
              <p>{t("readOnlyHelp")}</p>
              <PasskeyHelp
                workspace={workspace}
                unlockOptions={{ forResults: true, enableState: true }}
              />
              <button
                className={styles.secondary}
                disabled={Boolean(busy || workspace.needsDeviceApproval)}
                onClick={() => void workspace.unlock({ forResults: true, enableState: true })}
              >
                {t("enableChanges")}
              </button>
            </div>
          )}
          {failure && (
            <div className={styles.error} role="alert">
              <strong>{t("attention")}</strong>
              <p>{t(`errors.${ERRORS.has(failure) ? failure : "request_failed"}`)}</p>
              {failure === "version_conflict" && (
                <button
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => void model.reload()}
                >
                  {t("refresh")}
                </button>
              )}
            </div>
          )}
          {model.notice && NOTICES.has(model.notice) && (
            <p className={styles.feedback} role="status">
              {t(`notices.${model.notice}`)}
            </p>
          )}
          {model.pendingState && (
            <div className={styles.recovery} role="status">
              <div>
                <strong>{t("pendingTitle")}</strong>
                <p>{t("pendingHelp")}</p>
              </div>
              <div className={styles.headerActions}>
                <button
                  className={styles.secondary}
                  disabled={busy || !unlocked}
                  onClick={() => void model.retryPendingState()}
                >
                  {t("retryState")}
                </button>
                <button
                  className={styles.textButton}
                  disabled={busy}
                  onClick={() => void model.discardPendingState()}
                >
                  {t("discardState")}
                </button>
              </div>
            </div>
          )}
          <div className={styles.toolbar}>
            <div
              className={styles.filters}
              role="group"
              aria-label={t("filterLabel")}
              title={t("countsHelp")}
            >
              {FILTERS.map((filter) => (
                <button
                  key={filter}
                  aria-pressed={model.filter === filter}
                  onClick={() => model.setFilter(filter)}
                >
                  {t(`filters.${filter}`)}
                  <span>{model.counts?.[filter] ?? "—"}</span>
                </button>
              ))}
            </div>
            <label className={styles.search}>
              <span className="sr-only">{t("search")}</span>
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={unlocked ? model.query : ""}
                disabled={!unlocked}
                placeholder={t("search")}
                maxLength={200}
                onChange={(event) => model.setQuery(event.target.value)}
              />
            </label>
          </div>
          <p className={styles.scope}>{t(unlocked ? "searchScope" : "lockedScope")}</p>
          <div className={styles.grid}>
            <div className={styles.listColumn} data-detail={Boolean(selected)}>
              <div className={styles.list} aria-label={t("results")} aria-busy={model.loading}>
                {model.items.length ? (
                  model.items.map((item) => (
                    <button
                      className={styles.result}
                      key={item.metadata.resultId}
                      data-selected={selected?.metadata.resultId === item.metadata.resultId}
                      disabled={!unlocked || busy}
                      onClick={() => void model.openResult(item.metadata.resultId)}
                    >
                      <span className={styles.resultTop}>
                        <span className={styles.arrival}>{date(item.metadata.receivedAt)}</span>
                        <span>
                          {!item.metadata.read && (
                            <i className={styles.unread} aria-label={t("unread")} />
                          )}
                          {item.metadata.starred && <span aria-label={t("starred")}>★</span>}
                        </span>
                      </span>
                      <strong>
                        {unlocked && item.content ? item.content.title : t("encryptedResult")}
                      </strong>
                      <p>
                        {unlocked && item.content
                          ? item.content.summary
                          : t(unlocked ? "openToDecrypt" : "unlockToRead")}
                      </p>
                      <span className={styles.resultMeta}>
                        {t("revision", { revision: item.metadata.revision })}
                        <span>·</span>
                        {t("connection", { id: short(item.metadata.connectionId) })}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className={styles.listEmpty} role="status">
                    <span className={styles.emptyIcon} aria-hidden="true">
                      ▱
                    </span>
                    <strong>
                      {t(model.loading ? "loading" : model.query ? "noMatch" : "emptyTitle")}
                    </strong>
                    <p>{t(model.query ? "searchScope" : "emptyHelp")}</p>
                  </div>
                )}
              </div>
              {model.hasMore && (
                <button
                  className={styles.loadMore}
                  disabled={busy || model.loading}
                  onClick={() => void model.loadMore()}
                >
                  {t("loadMore")}
                </button>
              )}
            </div>
            {selected ? (
              <article className={styles.detail} aria-labelledby="result-title">
                <button className={styles.back} onClick={model.closeDetail}>
                  ← {t("back")}
                </button>
                <div className={styles.detailTop}>
                  <span className={styles.eyebrow}>{t("resultLabel")}</span>
                  <span className={styles.badge}>
                    {t(selected.historical ? "historical" : "latest")}
                  </span>
                </div>
                <h2 id="result-title">{selected.content.title}</h2>
                <p className={styles.summary}>{selected.content.summary}</p>
                <p className={styles.provenance}>
                  {t("connection", { id: selected.metadata.connectionId })} ·{" "}
                  {t("taskVersion", { version: selected.metadata.taskVersion })}
                </p>
                <div className={styles.actions} role="group" aria-label={t("resultActions")}>
                  <button
                    className={styles.secondary}
                    disabled={busy || model.pendingState || !model.canWriteState}
                    onClick={() => void model.updateState({ read: !selected.metadata.read })}
                  >
                    {t(selected.metadata.read ? "markUnread" : "markRead")}
                  </button>
                  <button
                    className={styles.secondary}
                    aria-pressed={selected.metadata.starred}
                    disabled={busy || model.pendingState || !model.canWriteState}
                    onClick={() => void model.updateState({ starred: !selected.metadata.starred })}
                  >
                    {t(selected.metadata.starred ? "unstar" : "star")}
                  </button>
                  <button
                    className={styles.secondary}
                    disabled={busy || model.pendingState || !model.canWriteState}
                    onClick={() =>
                      void model.updateState({ archived: !selected.metadata.archived })
                    }
                  >
                    {t(selected.metadata.archived ? "unarchive" : "archive")}
                  </button>
                  <button className={styles.textButton} onClick={() => setCopyConfirm(true)}>
                    {t("copy")}
                  </button>
                  <a
                    className={styles.textButton}
                    href={selectedLink ? `/${selectedLink}` : undefined}
                  >
                    {t("resultLink")}
                  </a>
                </div>
                <p className={styles.scope}>{t("stateScope")}</p>
                {copyConfirm && (
                  <div className={styles.recovery}>
                    <p>{t("copyWarning")}</p>
                    <div className={styles.headerActions}>
                      <button className={styles.secondary} onClick={() => void copy()}>
                        {t("confirmCopy")}
                      </button>
                      <button className={styles.textButton} onClick={() => setCopyConfirm(false)}>
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                )}
                {copyNotice && (
                  <p role="status" className={styles.feedback}>
                    {t(copyNotice)}
                  </p>
                )}
                {selected.historical && <p className={styles.historyNote}>{t("historicalHelp")}</p>}
                <div className={styles.sections}>
                  {selected.content.sections.map((section) => (
                    <section key={section.sectionId}>
                      <h2>{section.sectionId.replace(/[-_]/g, " ")}</h2>
                      <SafeReportMarkdown markdown={section.markdown} />
                    </section>
                  ))}
                </div>
                {selected.content.citations.length > 0 && (
                  <section className={styles.citations}>
                    <h3>{t("citations")}</h3>
                    <p>{t("citationHelp")}</p>
                    <ol>
                      {selected.content.citations.map((citation) => (
                        <li key={citation.citationId}>
                          {reportLink(citation.url) ? (
                            <a
                              href={citation.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              referrerPolicy="no-referrer"
                            >
                              {citation.title} ↗
                            </a>
                          ) : (
                            <span>{citation.title}</span>
                          )}
                          {citation.publishedAt && <small>{date(citation.publishedAt)}</small>}
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
                {selected.content.limitations.length > 0 && (
                  <section className={styles.limitations}>
                    <h3>{t("limitations")}</h3>
                    <ul>
                      {selected.content.limitations.map((value, i) => (
                        <li key={i}>{value}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <details className={styles.evidence}>
                  <summary>{t("evidence")}</summary>
                  <p>{t("evidenceHelp")}</p>
                  <dl>
                    <dt>{t("received")}</dt>
                    <dd>{date(selected.metadata.receivedAt)}</dd>
                    <dt>{t("revisionSaved")}</dt>
                    <dd>{date(selected.evidence.receipt.receivedAt)}</dd>
                    <dt>{t("run")}</dt>
                    <dd>{selected.metadata.runId}</dd>
                    <dt>{t("manifest")}</dt>
                    <dd>{selected.metadata.manifestId}</dd>
                  </dl>
                  <h4>{t("frozenInputs")}</h4>
                  <p>{t("frozenHelp")}</p>
                  <ul>
                    {selected.evidence.manifest.entries.map(
                      (
                        entry: {
                          ref: { kind: "holdings" | "watchlist" | "channel_follows" };
                          revision: number;
                          sourceEpoch: number;
                        },
                        i: number,
                      ) => (
                        <li key={i}>
                          {t(`sources.${entry.ref.kind}`)} ·{" "}
                          {t("sourceVersion", {
                            version: entry.revision,
                            epoch: entry.sourceEpoch,
                          })}
                        </li>
                      ),
                    )}
                  </ul>
                  {selected.evidence.manifest.entries.length === 0 && <p>{t("noFrozenInputs")}</p>}
                </details>
                <section className={styles.history}>
                  <h3>{t("history")}</h3>
                  <p>{t("historyHelp")}</p>
                  <div role="group" aria-label={t("history")}>
                    {model.history.map((revision) => (
                      <button
                        className={styles.historyRow}
                        key={revision.revision}
                        disabled={busy}
                        aria-pressed={revision.revision === selected.metadata.revision}
                        onClick={() => void model.openResult(revision.resultId, revision.revision)}
                      >
                        <span>{t("revision", { revision: revision.revision })}</span>
                        <span>
                          {revision.revision === selected.metadata.revision
                            ? t("viewing")
                            : t("viewRevision")}
                        </span>
                      </button>
                    ))}
                  </div>
                  {model.historyHasMore && (
                    <button
                      className={styles.textButton}
                      disabled={busy}
                      onClick={() => void model.loadMoreHistory()}
                    >
                      {t("moreHistory")}
                    </button>
                  )}
                </section>
              </article>
            ) : (
              <div className={styles.detailEmpty}>
                <span className={styles.emptyIcon} aria-hidden="true">
                  ▱
                </span>
                <h2>{t("selectTitle")}</h2>
                <p>{t("selectHelp")}</p>
                <span className={styles.privateNote}>{t("privacy")}</span>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default function InboxPanel({
  workspace,
  active,
}: {
  workspace: HoldingsWorkspace;
  active: boolean;
}) {
  const model = useInbox(workspace, { active });
  const [linked, setLinked] = useState<InboxResultLink | null>(null);
  const attempted = useRef<string | null>(null);
  const linkedOwner = useRef<string | null>(null);
  const ownerChanged = useRef(false);
  const liveOwner = useRef(workspace.owner);
  liveOwner.current = workspace.owner;
  if (linkedOwner.current && linkedOwner.current !== workspace.owner) ownerChanged.current = true;
  if (!linkedOwner.current && workspace.owner) linkedOwner.current = workspace.owner;
  useEffect(() => {
    const route = () => {
      const value = isAgentConsentHandoff(window.location.search)
        ? null
        : readInboxResultLink(window.location.hash);
      attempted.current = null;
      ownerChanged.current = false;
      linkedOwner.current = liveOwner.current;
      setLinked(value);
    };
    route();
    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", route);
    return () => {
      window.removeEventListener("hashchange", route);
      window.removeEventListener("popstate", route);
    };
  }, []);
  useEffect(() => {
    if (!active || document.visibilityState === "hidden" || !model.unlocked) {
      // Inactive/hidden operations are cancelled by useInbox. Preserve the
      // public navigation intent and try once when the same page is usable.
      attempted.current = null;
      return;
    }
    if (
      !linked ||
      ownerChanged.current ||
      !workspace.owner ||
      workspace.needsDeviceApproval ||
      !workspace.authenticated ||
      workspace.phase !== "unlocked"
    )
      return;
    const current = readInboxResultLink(window.location.hash);
    if (
      !current ||
      current.resultId !== linked.resultId ||
      current.revision !== linked.revision ||
      isAgentConsentHandoff(window.location.search)
    )
      return;
    // A link is a lookup request, never authority. useInbox still verifies the
    // current owner, vault generation, ciphertext, evidence and recipient keys.
    const key = `${workspace.owner}:${workspace.vaultGeneration}:${linked.resultId}:${linked.revision ?? "latest"}`;
    if (attempted.current === key) return;
    attempted.current = key;
    if (
      model.selected?.metadata.resultId === linked.resultId &&
      (linked.revision === undefined || model.selected.metadata.revision === linked.revision)
    )
      return;
    void model.openResult(linked.resultId, linked.revision);
  }, [linked, active, model, workspace]);
  const clearLink = () => {
    clearInboxResultLink();
    setLinked(null);
    attempted.current = null;
  };
  return (
    <InboxView
      workspace={workspace}
      model={{
        ...model,
        reload: (options) => {
          // An explicit refresh may retry a failed linked lookup; rerenders
          // and poll responses must never turn a 404 into a retry loop.
          attempted.current = null;
          return model.reload(options);
        },
        openResult: (resultId, revision) => {
          clearLink();
          return model.openResult(resultId, revision);
        },
        closeDetail: () => {
          clearLink();
          model.closeDetail();
        },
      }}
    />
  );
}
