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
      <p className={styles.note}>{t("followsPrivacy")}</p>
      {model.follows.loading ? (
        <p role="status">{t("loading")}</p>
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
  if (!model.authenticated) return null;
  return (
    <div className={styles.discovery}>
      <h3>{t("sourceStatus")}</h3>
      {model.configured && (
        <button
          type="button"
          disabled={model.catalogue.loading}
          onClick={() => void model.reload("catalogue")}
        >
          {t("refreshVersion")}
        </button>
      )}
      <p className={styles.note}>{t("discoveryHelp")}</p>
      {!model.configured ? (
        <p className={styles.note}>{t("discoveryDisabled")}</p>
      ) : model.catalogue.loading ? (
        <p role="status">{t("loading")}</p>
      ) : model.catalogue.error ? (
        <Failure code={model.catalogue.error} retry={() => void model.reload("catalogue")} />
      ) : !group ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          <p className={styles.note}>{t(`statuses.${group.status}`)}</p>
          {group.items.map((item, index) => (
            <div
              className={styles.pointer}
              key={item.ref ? `${item.ref.resourceId}:${item.ref.incarnation}` : index}
            >
              <span>{t(`states.${item.state}`)}</span>
              {item.revision !== null && (
                <small>{t("revision", { revision: item.revision })}</small>
              )}
              {item.updatedAt && <time dateTime={item.updatedAt}>{item.updatedAt}</time>}
              {onCreateTask &&
                resourceSelection(item) &&
                ["ready", "active"].includes(item.state) && (
                  <button type="button" onClick={() => model.useForTask(item, onCreateTask)}>
                    {t("useInTask")}
                  </button>
                )}
            </div>
          ))}
          <p className={styles.note}>{t("historyHelp")}</p>
        </>
      )}
    </div>
  );
}
export function ResourceLibraryView({
  model,
  children,
  onOpenWatchlist,
  onCreateTask,
}: {
  model: ResourceLibraryModel;
  children: ReactNode;
  onOpenWatchlist?: () => void;
  onCreateTask?: (selection: ResourceSelection) => void;
}) {
  const t = useTranslations("resourceLibrary");
  const [filter, setFilter] = useState<ResourceKind | "all">("all");
  const group = (kind: ResourceKind) =>
    model.catalogue.data?.groups.find((item) => item.kind === kind);
  const sourceStatus = (kind: ResourceKind) => {
    if (!model.authenticated) return t("signIn");
    const load =
      kind === "holdings"
        ? model.catalogue
        : kind === "watchlist"
          ? model.watchlist
          : model.follows;
    if (load.loading) return t("loading");
    if (load.error) return t("unavailable");
    if (kind === "holdings")
      return group(kind)
        ? t(`statuses.${group(kind)!.status}`)
        : t(model.configured ? "loading" : "discoveryDisabledShort");
    const list = kind === "watchlist" ? model.watchlist.data : model.follows.data;
    return list ? t("itemCount", { count: list.items.length }) : t("loading");
  };
  return (
    <div className={styles.library}>
      <div className={styles.filters} role="group" aria-label={t("filterLabel")}>
        {(["all", ...kinds] as const).map((kind) => (
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
      <div className={styles.cards}>
        {kinds
          .filter((kind) => filter === "all" || filter === kind)
          .map((kind) => (
            <button
              className={styles.card}
              type="button"
              key={kind}
              aria-pressed={filter === kind}
              onClick={() => setFilter(kind)}
            >
              <span className={styles.icon} aria-hidden="true">
                {kind === "holdings" ? "◈" : kind === "watchlist" ? "☆" : "▷"}
              </span>
              <strong>{t(`kinds.${kind}`)}</strong>
              <small>{t(`descriptions.${kind}`)}</small>
              <span className={styles.badge}>{sourceStatus(kind)}</span>
            </button>
          ))}
      </div>
      {(filter === "all" || filter === "holdings") && (
        <section className={styles.section} aria-label={t("kinds.holdings")}>
          <CatalogueDetail group={group("holdings")} model={model} onCreateTask={onCreateTask} />
          {children}
        </section>
      )}
      {(filter === "all" || filter === "watchlist") && (
        <section className={styles.section} aria-labelledby="watchlist-library-title">
          <div className={styles.heading}>
            <div>
              <h2 id="watchlist-library-title">{t("kinds.watchlist")}</h2>
              <p>{t("watchlistHelp")}</p>
            </div>
            {onOpenWatchlist && (
              <button type="button" onClick={onOpenWatchlist}>
                {t("manageInMarket")} ↗
              </button>
            )}
          </div>
          {!model.authenticated ? (
            <p className={styles.empty}>{t("signInLists")}</p>
          ) : model.watchlist.loading ? (
            <p role="status">{t("loading")}</p>
          ) : model.watchlist.error ? (
            <Failure code={model.watchlist.error} retry={() => void model.reload("watchlist")} />
          ) : (
            model.watchlist.data && (
              <>
                {!model.watchlist.data.items.length && (
                  <p className={styles.empty}>{t("noWatchlist")}</p>
                )}
                <ul className={styles.list}>
                  {model.watchlist.data.items.map((item) => (
                    <li key={item.symbol}>
                      <strong>{item.symbol}</strong>
                      <span>{item.name}</span>
                      <small>{t(`instruments.${item.instrumentType}`)}</small>
                    </li>
                  ))}
                </ul>
              </>
            )
          )}
          <CatalogueDetail group={group("watchlist")} model={model} onCreateTask={onCreateTask} />
        </section>
      )}
      {(filter === "all" || filter === "channel_follows") && (
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
  ...props
}: {
  active?: boolean;
  holdingsVersion?: string;
  children: ReactNode;
  onOpenWatchlist?: () => void;
  onCreateTask?: (selection: ResourceSelection) => void;
}) {
  const model = useResourceLibrary({ active });
  const previousVersion = useRef(holdingsVersion);
  useEffect(() => {
    if (previousVersion.current !== holdingsVersion) {
      previousVersion.current = holdingsVersion;
      if (active && model.authenticated && model.configured) void model.reload("catalogue");
    }
  }, [holdingsVersion, active, model.authenticated, model.configured, model.reload]);
  return <ResourceLibraryView key={model.owner ?? "guest"} model={model} {...props} />;
}
