"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useResourceLibrary, type ResourceLibraryModel } from "./useResourceLibrary";
import {
  resourceSelection,
  type ChannelInput,
  type ResourceGroup,
  type ResourceKind,
  type ResourceSelection,
} from "@/lib/resource-library";
import styles from "./ResourceLibrary.module.css";
import type { WatchlistModel } from "./useWatchlist";
import { LoadingIndicator, InlineError } from "./WorkspaceFeedback";

const kinds: ResourceKind[] = ["holdings", "watchlist", "channel_follows"];
const blank: ChannelInput = { name: "", handleOrUrl: "", note: "" };
function FollowsEditor({ model }: { model: ResourceLibraryModel }) {
  const t = useTranslations("resourceLibrary");
  const [draft, setDraft] = useState<ChannelInput>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [localError, setLocalError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const data = model.follows.data;
  const disabled = model.busy || model.follows.loading || model.follows.stale || !data;
  const owner = model.owner;
  const live = useRef(owner);
  live.current = owner;
  const reset = () => {
    setDraft(blank);
    setEditing(null);
    setOpened(false);
    setRemoving(null);
    setLocalError("");
  };
  const inputs = () =>
    data!.items.map(({ name, handleOrUrl, note }) => ({ name, handleOrUrl, note }));
  const save = async () => {
    if (disabled) return;
    const list = inputs();
    if (editing) {
      const index = data!.items.findIndex((item) => item.followId === editing);
      if (index < 0) {
        setLocalError("edited_removed");
        return;
      }
      list[index] = draft;
    } else list.push(draft);
    if ((await model.saveFollows(list)) && live.current === owner) reset();
  };
  const remove = async () => {
    if (disabled || !removing) return;
    const list = inputs().filter((_item, index) => data!.items[index].followId !== removing);
    if ((await model.saveFollows(list)) && live.current === owner) reset();
  };
  return (
    <>
      <details className={styles.note}>
        <summary>{t("aboutFollows")}</summary>
        <p>{t("followsPrivacy")}</p>
      </details>
      {model.follows.loading ? (
        <LoadingIndicator busy label={t("loading")} />
      ) : model.follows.error ? (
        <Failure code={model.follows.error} retry={() => void model.reload("follows")} />
      ) : (
        data && (
          <>
            {!data.items.length && <p className={styles.empty}>{t("noFollows")}</p>}
            <ul className={styles.list}>
              {data.items.map((item) => (
                <li key={item.followId}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.handleOrUrl}</small>
                    {item.note && <p>{item.note}</p>}
                    <small>{t("userProvided")}</small>
                  </div>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setEditing(item.followId);
                        setDraft({
                          name: item.name,
                          handleOrUrl: item.handleOrUrl,
                          note: item.note,
                        });
                        setOpened(true);
                        setRemoving(null);
                      }}
                    >
                      {t("edit")}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setRemoving(item.followId);
                        setOpened(false);
                      }}
                    >
                      {t("remove")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className={styles.note}>
              {t("followCount", { count: data.items.length, limit: data.limit })}
            </p>
            {!opened && !removing && (
              <button
                type="button"
                className={styles.primary}
                disabled={disabled || data.items.length >= data.limit}
                onClick={() => {
                  setDraft(blank);
                  setEditing(null);
                  setOpened(true);
                }}
              >
                {t("addFollow")}
              </button>
            )}
            {opened && (
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <h3>{t(editing ? "editFollow" : "addFollow")}</h3>
                <label>
                  {t("name")}
                  <input
                    required
                    maxLength={120}
                    value={draft.name}
                    disabled={model.busy}
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, name: event.target.value }))
                    }
                  />
                </label>
                <label>
                  {t("locator")}
                  <input
                    required
                    maxLength={256}
                    value={draft.handleOrUrl}
                    placeholder="@channel"
                    disabled={model.busy}
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, handleOrUrl: event.target.value }))
                    }
                  />
                </label>
                <p className={styles.note}>{t("locatorHelp")}</p>
                <label>
                  {t("note")}
                  <textarea
                    maxLength={1000}
                    rows={3}
                    value={draft.note}
                    disabled={model.busy}
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, note: event.target.value }))
                    }
                  />
                </label>
                <div className={styles.actions}>
                  <button type="submit" className={styles.primary} disabled={disabled}>
                    {t(model.busy ? "saving" : "save")}
                  </button>
                  <button type="button" disabled={model.busy} onClick={reset}>
                    {t("cancel")}
                  </button>
                </div>
              </form>
            )}
            {removing && (
              <div className={styles.warning} role="group" aria-label={t("confirmRemove")}>
                <p>{t("confirmRemove")}</p>
                <div className={styles.actions}>
                  <button type="button" disabled={disabled} onClick={() => void remove()}>
                    {t("remove")}
                  </button>
                  <button type="button" disabled={model.busy} onClick={reset}>
                    {t("cancel")}
                  </button>
                </div>
              </div>
            )}
            {localError && (
              <p role="alert" className={styles.warning}>
                {t(`errors.${localError}`)}
              </p>
            )}
            {model.writeError && (
              <p role="alert" className={styles.warning}>
                {t(`errors.${model.writeError}`)}
              </p>
            )}
            {model.follows.stale && (
              <div className={styles.warning}>
                <p>{t("reloadBeforeWrite")}</p>
                <button
                  type="button"
                  disabled={model.busy}
                  onClick={() => void model.reload("follows")}
                >
                  {t("reloadLatest")}
                </button>
              </div>
            )}
          </>
        )
      )}
    </>
  );
}
function Failure({ code, retry }: { code: string; retry: () => void }) {
  const t = useTranslations("resourceLibrary");
  return (
    <div className={styles.warning} role="alert">
      <p>{t(`errors.${code}`)}</p>
      <button type="button" onClick={retry}>
        {t("retry")}
      </button>
    </div>
  );
}
function CatalogueDetail({
  group,
  model,
  onCreateTask,
}: {
  group?: ResourceGroup;
  model: ResourceLibraryModel;
  onCreateTask?: (selection: ResourceSelection) => void;
}) {
  const t = useTranslations("resourceLibrary");
  if (!onCreateTask || !model.authenticated) return null;
  const items =
    group?.items.filter(
      (item) => resourceSelection(item) && ["ready", "active"].includes(item.state),
    ) ?? [];
  return (
    <div className={styles.actions}>
      {items.map((item) => (
        <button
          type="button"
          key={item.ref!.resourceId}
          disabled={model.catalogue.loading}
          onClick={() => model.useForTask(item, onCreateTask)}
        >
          {t("useInTask")}
        </button>
      ))}
      {model.catalogue.loading && (
        <LoadingIndicator busy hasContent={items.length > 0} label={t("loading")} />
      )}
      {model.catalogue.error && (
        <InlineError
          message={t("taskUnavailable")}
          onRetry={() => void model.reload("catalogue")}
          retryLabel={t("retry")}
        />
      )}
    </div>
  );
}
export function ResourceLibraryView({
  model,
  children,
  onOpenWatchlist,
  onCreateTask,
  watchlist: sharedWatchlist,
}: {
  model: ResourceLibraryModel;
  watchlist?: WatchlistModel;
  children: ReactNode | ((model: ResourceLibraryModel) => ReactNode);
  onOpenWatchlist?: () => void;
  onCreateTask?: (selection: ResourceSelection) => void;
}) {
  const t = useTranslations("resourceLibrary");
  const [filter, setFilter] = useState<ResourceKind>("holdings");
  const [symbol, setSymbol] = useState("");
  const shared = sharedWatchlist?.sessionKey === model.owner ? sharedWatchlist : null;
  const watchlist = sharedWatchlist
    ? {
        data: shared ? { items: shared.items, limit: shared.limit } : null,
        loading: !shared || shared.loading,
        error: shared?.error ?? "",
        stale: false,
      }
    : model.watchlist;
  const submitWatchlist = (event: React.FormEvent) => {
    event.preventDefault();
    if (shared && !shared.busy && symbol.trim()) {
      void shared.add(symbol.trim().toUpperCase());
      setSymbol("");
    }
  };
  const listSignature = shared?.items.map((i) => i.symbol).join("|");
  const prior = useRef(listSignature);
  useEffect(() => {
    if (prior.current !== listSignature) {
      prior.current = listSignature;
      if (model.authenticated && model.configured) void model.reload("catalogue");
    }
  }, [listSignature, model.authenticated, model.configured]);
  const group = (kind: ResourceKind) =>
    model.catalogue.data?.groups.find((item) => item.kind === kind);
  return (
    <div className={styles.library}>
      <div className={styles.filters} role="group" aria-label={t("filterLabel")}>
        {kinds.map((kind) => (
          <button
            type="button"
            key={kind}
            aria-pressed={filter === kind}
            onClick={() => setFilter(kind)}
          >
            {t(`kinds.${kind}`)}
          </button>
        ))}
      </div>
      {filter === "holdings" && (
        <section className={styles.section} aria-label={t("kinds.holdings")}>
          {typeof children === "function" ? children(model) : children}
        </section>
      )}
      {filter === "watchlist" && (
        <section className={styles.section} aria-labelledby="watchlist-library-title">
          <div className={styles.heading}>
            <div>
              <h2 id="watchlist-library-title">{t("kinds.watchlist")}</h2>
            </div>
            {!sharedWatchlist && onOpenWatchlist && (
              <button type="button" onClick={onOpenWatchlist}>
                {t("manageInMarket")} ↗
              </button>
            )}
          </div>
          {shared && (
            <form className={styles.addSymbol} onSubmit={submitWatchlist}>
              <label>
                <span className="sr-only">{t("symbolLabel")}</span>
                <input
                  aria-label={t("symbolLabel")}
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  maxLength={20}
                  placeholder={t("symbolPlaceholder")}
                  disabled={shared.busy}
                />
              </label>
              <button type="submit" disabled={shared.busy || !symbol.trim()}>
                {t("addStock")}
              </button>
            </form>
          )}
          {!model.authenticated ? (
            <p className={styles.empty}>{t("signInLists")}</p>
          ) : watchlist.loading ? (
            <LoadingIndicator busy label={t("loading")} />
          ) : watchlist.error ? (
            <Failure
              code={sharedWatchlist ? "unavailable" : watchlist.error}
              retry={() => (shared ? void shared.reload() : void model.reload("watchlist"))}
            />
          ) : (
            watchlist.data && (
              <>
                {!watchlist.data.items.length && <p className={styles.empty}>{t("noWatchlist")}</p>}
                <ul className={styles.list}>
                  {watchlist.data.items.map((item) => (
                    <li key={item.symbol}>
                      <strong>{item.symbol}</strong>
                      <span>{item.name}</span>
                      <small>{t(`instruments.${item.instrumentType}`)}</small>
                      {shared && (
                        <button
                          type="button"
                          disabled={shared.busy}
                          aria-label={t("removeStock", { symbol: item.symbol })}
                          onClick={() => void shared.remove(item.symbol)}
                        >
                          {t("remove")}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )
          )}
          <CatalogueDetail group={group("watchlist")} model={model} onCreateTask={onCreateTask} />
        </section>
      )}
      {filter === "channel_follows" && (
        <section className={styles.section} aria-labelledby="follows-library-title">
          <div className={styles.heading}>
            <div>
              <h2 id="follows-library-title">{t("kinds.channel_follows")}</h2>
              <p>{t("manualOnly")}</p>
            </div>
          </div>
          {!model.authenticated ? (
            <p className={styles.empty}>{t("signInLists")}</p>
          ) : (
            <FollowsEditor key={model.owner} model={model} />
          )}
          <CatalogueDetail
            group={group("channel_follows")}
            model={model}
            onCreateTask={onCreateTask}
          />
        </section>
      )}
    </div>
  );
}
export default function ResourceLibrary({
  active = true,
  holdingsVersion = "",
  watchlist,
  ...props
}: {
  active?: boolean;
  holdingsVersion?: string;
  watchlist?: WatchlistModel;
  children: ReactNode | ((model: ResourceLibraryModel) => ReactNode);
  onOpenWatchlist?: () => void;
  onCreateTask?: (selection: ResourceSelection) => void;
}) {
  const model = useResourceLibrary({ active, externalWatchlist: Boolean(watchlist) });
  const previousVersion = useRef(holdingsVersion);
  useEffect(() => {
    if (previousVersion.current !== holdingsVersion) {
      previousVersion.current = holdingsVersion;
      if (active && model.authenticated && model.configured) void model.reload("catalogue");
    }
  }, [holdingsVersion, active, model.authenticated, model.configured, model.reload]);
  return (
    <ResourceLibraryView
      key={model.owner ?? "guest"}
      model={model}
      watchlist={watchlist}
      {...props}
    />
  );
}
