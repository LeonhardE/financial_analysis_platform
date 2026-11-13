"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import type { PersistentWorkspaceModel } from "./usePersistentWorkspace";
import { DisplayLru } from "@/lib/workspace-cache";
import { SafeReportMarkdown, reportLink } from "./SafeReportMarkdown";
import type { ResultContent, ResultStatePacket } from "@/lib/encrypted-types";
import styles from "./InboxPanel.module.css";
type Meta = {
  resultId: string;
  taskId: string;
  runId: string;
  connectionId: string;
  receivedAt: number;
  stateVersion: number;
  read: boolean;
  starred: boolean;
  archived: boolean;
};
type Selected = { scope: string; metadata: Meta; content: ResultContent };
const CONTRACT = "folioview.agent-workspace.v2.0";
export function PersistentInboxPanel({
  workspace,
  model,
  active,
}: {
  workspace: HoldingsWorkspace;
  model: PersistentWorkspaceModel;
  active: boolean;
}) {
  const t = useTranslations("persistent"),
    locale = useLocale();
  const scope = model.unlocked
    ? `${model.owner}:${workspace.vault?.vaultId ?? "unavailable"}:${workspace.vaultGeneration}`
    : null;
  const [state, setState] = useState<{
      scope: string | null;
      items: Meta[];
      cursor: string | null;
    }>({ scope: null, items: [], cursor: null }),
    [selected, setSelected] = useState<Selected | null>(null),
    [filter, setFilter] = useState<"all" | "unread" | "starred" | "archived">("all"),
    [query, setQuery] = useState(""),
    [error, setError] = useState(false);
  const cache = useRef(
    workspace.displayCache?.reports ?? new DisplayLru<unknown>(10, 16 * 1024 * 1024),
  );
  const needsLoad = useRef(true);
  const pending = useRef<{
      scope: string;
      metadata: Meta;
      changes: Record<string, boolean>;
      packet: ResultStatePacket;
    } | null>(null),
    serial = useRef(0),
    live = useRef({ scope, active });
  live.current = { scope, active };
  const current = scope && state.scope === scope ? state : { scope: null, items: [], cursor: null },
    detail = scope && selected?.scope === scope ? selected : null;
  const load = async (more = false) => {
    if (!scope || !active || model.busy) return;
    needsLoad.current = false;
    const original = scope,
      id = ++serial.current;
    const data = await model.execute(async (_c, api, assert) => {
      const v = workspace.vault!.vaultId;
      const response = await api(
        `/api/v2/persistent-results/${v}?limit=20` +
          (more && current.cursor ? "&cursor=" + encodeURIComponent(current.cursor) : ""),
      );
      assert();
      return response;
    });
    if (data && live.current.scope === original && live.current.active && serial.current === id) {
      setError(false);
      setState((s) => ({
        scope: original,
        items: more
          ? ([
              ...new Map([...s.items, ...data.items].map((m: Meta) => [m.resultId, m])).values(),
            ].slice(-100) as Meta[])
          : data.items,
        cursor: data.nextCursor,
      }));
    }
  };
  useEffect(() => {
    ++serial.current;
    setSelected(null);
    setState({ scope: null, items: [], cursor: null });
    setQuery("");
    setError(false);
    pending.current = null;
    cache.current.clear();
    needsLoad.current = true;
  }, [scope]);
  useEffect(() => {
    ++serial.current;
    needsLoad.current = true;
  }, [active]);
  useEffect(() => {
    if (scope && active && !model.busy && needsLoad.current) void load();
  }, [scope, active, model.busy]);
  const open = async (meta: Meta) => {
    if (!scope) return;
    const original = scope,
      id = ++serial.current;
    const result = await model.execute(async (_c, api, assert) => {
      const record = await api(
        `/api/v2/persistent-results/${workspace.vault!.vaultId}/${meta.resultId}`,
      );
      const key = JSON.stringify(["persistent", original, meta.resultId, record]);
      const prior = cache.current.get(key) as ResultContent | undefined;
      const content =
        prior ?? (await workspace.openPersistentResult({ record, resultId: meta.resultId }));
      assert();
      if (live.current.scope !== original || !live.current.active || serial.current !== id)
        return null;
      cache.current.set(key, content);
      return { content, metadata: record.metadata };
    });
    if (live.current.scope !== original || !live.current.active || serial.current !== id) return;
    if (result) {
      setSelected({ scope: original, ...result });
      setError(false);
    } else setError(true);
  };
  const update = async (changes: Record<string, boolean>) => {
    if (!detail || !scope || !workspace.canWriteState) return;
    const original = scope;
    const result = await model.execute(async (_c, api, assert) => {
      let p = pending.current;
      if (p && (p.scope !== original || p.metadata.resultId !== detail.metadata.resultId))
        throw Error("pending");
      if (!p) {
        const packet = await workspace.signPersistentResultState({
          metadata: detail.metadata,
          changes,
        });
        assert();
        p = { scope: original, metadata: detail.metadata, changes, packet };
        pending.current = p;
      }
      const response = await api(
        `/api/v2/persistent-results/${workspace.vault!.vaultId}/${p.metadata.resultId}/state`,
        {
          method: "PATCH",
          json: { contractVersion: CONTRACT, command: p.packet.command },
          headers: {
            "Idempotency-Key": p.packet.operationId,
            "X-FolioView-Author-Key": p.packet.authorKeyId,
          },
        },
      );
      assert();
      if (
        response.resultId !== p.metadata.resultId ||
        response.taskId !== p.metadata.taskId ||
        response.runId !== p.metadata.runId ||
        response.connectionId !== p.metadata.connectionId ||
        response.receivedAt !== p.metadata.receivedAt ||
        response.stateVersion !== p.metadata.stateVersion + 1 ||
        !["read", "starred", "archived"].every(
          (k) => response[k] === (k in p!.changes ? p!.changes[k] : (p!.metadata as any)[k]),
        )
      )
        throw Error("receipt");
      pending.current = null;
      return response as Meta;
    });
    if (result && live.current.scope === original) {
      setSelected((s) =>
        s?.scope === original && s.metadata.resultId === result.resultId
          ? { ...s, metadata: result }
          : s,
      );
      setState((s) =>
        s.scope === original
          ? { ...s, items: s.items.map((m) => (m.resultId === result.resultId ? result : m)) }
          : s,
      );
      setError(false);
    } else if (live.current.scope === original) setError(true);
  };
  const items = current.items
    .filter((m) =>
      filter === "archived"
        ? m.archived
        : !m.archived &&
          (filter === "all" ||
            (filter === "unread" && !m.read) ||
            (filter === "starred" && m.starred)),
    )
    .filter((m) => !query || `${m.taskId} ${m.runId}`.toLowerCase().includes(query.toLowerCase()));
  const date = (n: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(n * 1000);
  return (
    <section className={styles.panel} aria-labelledby="persistent-inbox-title">
      <header className={styles.heading}>
        <div>
          <h1 id="persistent-inbox-title">{t("inboxTitle")}</h1>
          <p>{t("inboxHelp")}</p>
        </div>
        <button
          className={styles.secondary}
          disabled={model.busy || !scope}
          onClick={() => void load()}
        >
          {t("refresh")}
        </button>
      </header>
      {!scope ? (
        <p>
          {t("unlockHelp")} <a href="/resources">{t("openResources")}</a>
        </p>
      ) : (
        <>
          <div className={styles.headerActions}>
            {(["all", "unread", "starred", "archived"] as const).map((f) => (
              <button
                className={styles.secondary}
                aria-pressed={filter === f}
                key={f}
                onClick={() => setFilter(f)}
              >
                {t("filter_" + f)}
              </button>
            ))}
          </div>
          <p className={styles.scope}>{t("loadedReports", { count: current.items.length })}</p>
          {error && <p role="alert">{t("requestFailed")}</p>}
          <div className={styles.grid}>
            <div>
              {items.length === 0 && <p>{t("noReports")}</p>}
              {items.map((m) => (
                <button
                  key={m.resultId}
                  className={styles.secondary}
                  style={{ display: "block", width: "100%", marginBottom: 8, textAlign: "left" }}
                  disabled={model.busy || !!pending.current}
                  onClick={() => void open(m)}
                >
                  {date(m.receivedAt)} · {t(m.read ? "read" : "unread")}
                  {m.starred ? " ★" : ""}
                </button>
              ))}
              {current.cursor && (
                <button
                  className={styles.secondary}
                  disabled={model.busy}
                  onClick={() => void load(true)}
                >
                  {t("loadMore")}
                </button>
              )}
            </div>
            <article>
              {!detail ? (
                <p>{t("selectReport")}</p>
              ) : (
                <>
                  <h2>{detail.content.title}</h2>
                  <p>{date(detail.metadata.receivedAt)}</p>
                  <div className={styles.headerActions}>
                    <button
                      className={styles.secondary}
                      disabled={model.busy || !workspace.canWriteState || !!pending.current}
                      onClick={() => void update({ read: !detail.metadata.read })}
                    >
                      {t(detail.metadata.read ? "markUnread" : "markRead")}
                    </button>
                    <button
                      className={styles.secondary}
                      disabled={model.busy || !workspace.canWriteState || !!pending.current}
                      onClick={() => void update({ starred: !detail.metadata.starred })}
                    >
                      {t(detail.metadata.starred ? "unstar" : "star")}
                    </button>
                    <button
                      className={styles.secondary}
                      disabled={model.busy || !workspace.canWriteState || !!pending.current}
                      onClick={() => void update({ archived: !detail.metadata.archived })}
                    >
                      {t(detail.metadata.archived ? "unarchive" : "archive")}
                    </button>
                  </div>
                  {pending.current && (
                    <p>
                      {t("stateUnknown")}{" "}
                      <button
                        className={styles.secondary}
                        disabled={model.busy}
                        onClick={() => void update(pending.current!.changes)}
                      >
                        {t("resume")}
                      </button>
                    </p>
                  )}
                  <p>{detail.content.summary}</p>
                  <div className={styles.sections}>
                    {detail.content.sections.map((section) => (
                      <section key={section.sectionId}>
                        <h3>{section.sectionId}</h3>
                        <SafeReportMarkdown markdown={section.markdown} />
                      </section>
                    ))}
                  </div>
                  {detail.content.citations.length > 0 && (
                    <section>
                      <h3>{t("citations")}</h3>
                      <ol>
                        {detail.content.citations.map((c) => (
                          <li key={c.citationId}>
                            {reportLink(c.url) ? (
                              <a href={c.url} target="_blank" rel="noreferrer noopener">
                                {c.title}
                              </a>
                            ) : (
                              c.title
                            )}
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}
                  <details>
                    <summary>{t("evidence")}</summary>
                    <p>{t("verifiedHistory")}</p>
                    <p>
                      {t("connectionId")}: <code>{detail.metadata.connectionId}</code>
                    </p>
                    <p>
                      Run: <code>{detail.metadata.runId}</code>
                    </p>
                  </details>
                </>
              )}
            </article>
          </div>
        </>
      )}
    </section>
  );
}
