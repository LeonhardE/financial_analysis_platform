"use client";
import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ReportDialog } from "./ReportDialog";
import { LoadingIndicator, InlineError, UnreadDot } from "./WorkspaceFeedback";
import { SafeReportMarkdown } from "./SafeReportMarkdown";
import type { TaskResultsModel } from "./useTaskResults";
import type { ResultRow } from "@/lib/task-result-reader";
import styles from "./TaskResultsPanel.module.css";
const agentName = (p: string) => (p === "muse" ? "Muse" : p === "chatgpt" ? "ChatGPT" : "Agent");
export function TaskResultsPanel({ model, taskId }: { model: TaskResultsModel; taskId: string }) {
  const t = useTranslations("taskResults"),
    locale = useLocale(),
    list = useRef<HTMLDivElement>(null);
  const detail = model.scope && model.detail?.row.metadata.taskId === taskId ? model.detail : null;
  useEffect(() => {
    if (list.current) list.current.scrollTop = model.scroll.current.get(taskId) ?? 0;
  }, [taskId]);
  useEffect(() => {
    if (detail) model.presented(detail);
  }, [
    detail?.row.metadata.resultId,
    detail?.row.metadata.stateVersion,
    detail?.historical,
    model.scope,
    model.canWrite,
    model.pending,
  ]);
  const date = (v: string | number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(typeof v === "number" ? v * 1000 : v),
    );
  const close = () => {
    model.close();
    window.requestAnimationFrame(() => {
      if (!(document.activeElement as HTMLElement)?.closest?.("[data-result-key]"))
        list.current?.focus({ preventScroll: true });
    });
  };
  const message =
    model.error && t.has(`errors.${model.error}`)
      ? t(`errors.${model.error}`)
      : t("errors.request_failed");
  return (
    <section className={styles.panel} aria-label={t("title")}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {["all", "unread", "starred", "archived"].map((filter) => (
            <button
              key={filter}
              aria-pressed={model.filters.filter === filter}
              onClick={() => model.setFilter({ filter })}
            >
              {t(filter)}
            </button>
          ))}
        </div>
        <button
          className={styles.quiet}
          disabled={model.loading}
          onClick={() => void model.reload()}
        >
          {t("refresh")}
        </button>
      </div>
      <div className={styles.tools}>
        <label>
          <span className={styles.srOnly}>{t("agent")}</span>
          <select
            value={model.filters.actor}
            onChange={(e) => model.setFilter({ actor: e.target.value })}
          >
            <option value="all">{t("allAgents")}</option>
            {model.actors.map((p) => (
              <option key={p} value={p}>
                {agentName(p)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.search}>
          <span className={styles.srOnly}>{t("search")}</span>
          <input
            type="search"
            placeholder={t("search")}
            value={model.filters.query}
            onChange={(e) => model.setFilter({ query: e.target.value })}
          />
        </label>
      </div>
      {model.linkedBlocked && <InlineError message={t("errors.unsaved_edits")} />}
      {model.error && (
        <InlineError
          message={message}
          retryLabel={t("retry")}
          onRetry={() => void model.reload()}
        />
      )}
      {model.pending && (
        <div className={styles.notice} role="status">
          <span>{t("statePending")}</span>
          <button disabled={model.busy} onClick={model.retryState}>
            {t("retryOriginal")}
          </button>
          <button disabled={model.busy} onClick={model.discardState}>
            {t("reloadState")}
          </button>
        </div>
      )}
      <LoadingIndicator
        busy={model.loading || model.busy}
        hasContent={model.rows.length > 0}
        label={t("loading")}
      />
      <div
        id="task-results-list"
        ref={list}
        tabIndex={-1}
        className={styles.list}
        onScroll={(e) => model.scroll.current.set(taskId, e.currentTarget.scrollTop)}
      >
        {(model.scope ? model.rows : []).map((row) => (
          <ResultCard
            key={`${row.kind}:${row.metadata.resultId}`}
            row={row}
            model={model}
            date={date}
          />
        ))}
        {model.ready && !model.loading && !model.rows.length && !model.error && (
          <p className={styles.empty}>{t(model.complete ? "empty" : "historyPending")}</p>
        )}
      </div>
      {model.hasMore && (
        <button className={styles.more} disabled={model.loading} onClick={() => void model.more()}>
          {t("loadMore")}
        </button>
      )}
      {!model.hasMore && model.windowed && (
        <button className={styles.more} onClick={() => void model.reload()}>
          {t("returnLatest")}
        </button>
      )}
      <ReportDialog
        id="task-result"
        open={Boolean(detail) && Boolean(model.scope)}
        identity={`${model.scope}:${detail?.row.metadata.resultId}:${detail?.row.metadata.revision ?? 0}`}
        title={detail?.content.title ?? t("title")}
        closeLabel={t("close")}
        onClose={close}
      >
        {detail && (
          <article className={styles.report}>
            <div className={styles.meta}>
              <span>{agentName(model.providerFor(detail.row))}</span>
              <span>{t(`trigger.${detail.row.triggerKind}`)}</span>
              <time>{date(detail.row.metadata.receivedAt)}</time>
              {detail.historical && <span>{t("historical")}</span>}
            </div>
            {!detail.historical && (
              <div className={styles.reportActions}>
                <button
                  disabled={model.busy || model.pending || !model.canWrite}
                  aria-pressed={detail.row.metadata.starred}
                  onClick={() =>
                    void model.change(detail.row, { starred: !detail.row.metadata.starred })
                  }
                >
                  {t(detail.row.metadata.starred ? "unstar" : "star")}
                </button>
                <button
                  disabled={model.busy || model.pending || !model.canWrite}
                  onClick={() =>
                    void model.change(detail.row, { archived: !detail.row.metadata.archived })
                  }
                >
                  {t(detail.row.metadata.archived ? "unarchive" : "archive")}
                </button>
              </div>
            )}
            <p className={styles.summary}>{detail.content.summary}</p>
            {detail.content.sections.map((section, i) => (
              <section key={section.sectionId} aria-label={t("section", { number: i + 1 })}>
                <SafeReportMarkdown markdown={section.markdown} />
              </section>
            ))}
            {detail.content.limitations.length > 0 && (
              <details>
                <summary>{t("limitations")}</summary>
                <ul>
                  {detail.content.limitations.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </details>
            )}
            {model.history.length > 1 && (
              <details>
                <summary>{t("history")}</summary>
                <select
                  aria-label={t("history")}
                  value={detail.row.metadata.revision ?? ""}
                  onChange={(e) => void model.open(detail.row, Number(e.target.value))}
                >
                  {model.history.map((m) => (
                    <option key={m.revision} value={m.revision}>
                      {t("version", { number: m.revision })}
                    </option>
                  ))}
                </select>
                {model.historyHasMore && (
                  <button onClick={() => void model.moreHistory()}>{t("loadMore")}</button>
                )}
              </details>
            )}
          </article>
        )}
      </ReportDialog>
    </section>
  );
}
function ResultCard({
  row,
  model,
  date,
}: {
  row: ResultRow;
  model: TaskResultsModel;
  date: (v: string | number) => string;
}) {
  const t = useTranslations("taskResults"),
    title = model.title(row),
    node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      model.wantTitle(row);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) model.wantTitle(row);
          else model.stopTitle(row);
      },
      { root: el.parentElement, rootMargin: "100px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      model.stopTitle(row);
    };
  }, [row.kind, row.metadata.resultId, model.scope]);
  return (
    <div
      ref={node}
      className={styles.card}
      data-result-key=""
      data-selected={model.selection === `${row.kind}:${row.metadata.resultId}`}
    >
      {!row.metadata.read && (
        <span className={styles.dot} role="img" aria-label={t("unreadResult")}>
          <UnreadDot unread />
        </span>
      )}
      <button className={styles.open} onClick={() => void model.open(row)}>
        <strong>
          {title ??
            (model.titleFailed(row) ? (
              t("titleFailed")
            ) : (
              <span className={styles.skeleton} aria-label={t("loadingTitle")} />
            ))}
        </strong>
        <span className={styles.meta}>
          <span>{agentName(model.providerFor(row))}</span>
          <span>{t(`trigger.${row.triggerKind}`)}</span>
          <time>{date(row.metadata.receivedAt)}</time>
          {row.metadata.starred && <span aria-label={t("star")}>★</span>}
        </span>
      </button>
      {model.titleFailed(row) && (
        <button className={styles.quiet} onClick={() => model.retryTitle(row)}>
          {t("retry")}
        </button>
      )}
    </div>
  );
}
