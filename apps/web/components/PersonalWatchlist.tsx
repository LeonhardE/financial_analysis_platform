"use client";

import { useTranslations, useLocale } from "next-intl";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { localizeMessage } from "@/lib/ui-messages";
import { useAuth } from "@/components/AuthProvider";
import type { WatchlistModel } from "@/components/useWatchlist";
import { formatChange, formatPrice, type Instrument, type StockSummary } from "@/lib/market-data";
import type { WatchlistItem } from "@/lib/watchlist";
import styles from "./PersonalWatchlist.module.css";

const ACTION_WIDTH = 80;

function SavedInstrument({
  item,
  quote,
  quotesLoading,
  selected,
  open,
  disabled,
  actionId,
  onReveal,
  onSelect,
  onRemove,
  onQuoteVisible,
}: {
  item: WatchlistItem;
  quote?: StockSummary;
  quotesLoading: boolean;
  selected: boolean;
  open: boolean;
  disabled: boolean;
  actionId: string;
  onReveal: (open: boolean) => void;
  onSelect: () => void;
  onRemove: () => void;
  onQuoteVisible?: (symbol: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const row = useRef<HTMLLIElement>(null);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    start: number;
    horizontal: boolean;
    cancelled: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState<number | null>(null);

  useEffect(() => {
    if (!onQuoteVisible || !row.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        onQuoteVisible(item.symbol);
        observer.disconnect();
      },
      { rootMargin: "80px 0px" },
    );
    observer.observe(row.current);
    return () => observer.disconnect();
  }, [item.symbol, onQuoteVisible]);

  function finishGesture(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    gesture.current = null;
    setOffset(null);
    if (!active.horizontal) return;
    suppressClick.current = !cancelled;
    if (!cancelled) onReveal(active.start + event.clientX - active.x < -ACTION_WIDTH / 2);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const change = quote?.changePercent;
  const direction =
    change == null || !Number.isFinite(change) ? "" : change >= 0 ? "positive" : "negative";
  return (
    <li
      ref={row}
      className={`${styles.row} ${selected ? styles.selected : ""}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        onReveal(false);
        actionsButton.current?.focus();
      }}
    >
      <div
        className={styles.foreground}
        data-dragging={offset !== null || undefined}
        style={{ transform: `translateX(${offset ?? (open ? -ACTION_WIDTH : 0)}px)` }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          suppressClick.current = false;
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            start: open ? -ACTION_WIDTH : 0,
            horizontal: false,
            cancelled: false,
          };
        }}
        onPointerMove={(event) => {
          const active = gesture.current;
          if (!active || active.id !== event.pointerId || active.cancelled) return;
          const dx = event.clientX - active.x;
          const dy = event.clientY - active.y;
          if (!active.horizontal) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
            if (Math.abs(dy) >= Math.abs(dx)) {
              active.cancelled = true;
              return;
            }
            active.horizontal = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          event.preventDefault();
          setOffset(Math.max(-ACTION_WIDTH, Math.min(0, active.start + dx)));
        }}
        onPointerUp={(event) => finishGesture(event)}
        onPointerCancel={(event) => finishGesture(event, true)}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button className={styles.select} type="button" aria-pressed={selected} onClick={onSelect}>
          <span className="symbol-block">
            <strong>{item.symbol}</strong>
            <small>{item.name}</small>
          </span>
          <span className="quote-block" aria-busy={quotesLoading && !quote}>
            <strong>{formatPrice(quote?.latestClose, item, locale)}</strong>
            <small className={direction}>
              {formatChange(change, locale)}
              {quote?.isStale && <span className="quote-stale"> · {t("market.cached")}</span>}
            </small>
          </span>
        </button>
        <button
          ref={actionsButton}
          className={styles.actionsButton}
          type="button"
          aria-label={t("watchlist.actionsSymbol", { symbol: item.symbol })}
          aria-expanded={open}
          aria-controls={actionId}
          onClick={() => onReveal(!open)}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">
            <circle cx="4" cy="10" r="1.4" />
            <circle cx="10" cy="10" r="1.4" />
            <circle cx="16" cy="10" r="1.4" />
          </svg>
        </button>
      </div>
      <div id={actionId} className={styles.removeArea} aria-hidden={!open}>
        <button
          className={styles.remove}
          type="button"
          aria-label={t("watchlist.removeSymbol", { symbol: item.symbol })}
          disabled={disabled}
          tabIndex={open ? 0 : -1}
          onClick={onRemove}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
            <path d="M4 5.5h12M8 5.5V3.5h4v2M6 5.5l.7 11h6.6l.7-11M8.5 8v5.5M11.5 8v5.5" />
          </svg>
          <span>{t("watchlist.delete")}</span>
        </button>
      </div>
    </li>
  );
}

function SignInToSave() {
  const t = useTranslations();
  const { status, hasFirebaseUser, signIn, retry } = useAuth();
  const pending = ["loading", "signing-in", "verifying", "signing-out"].includes(status);
  return (
    <button
      className="account-button secondary save-button"
      type="button"
      disabled={pending || status === "unavailable"}
      onClick={() => void (hasFirebaseUser ? retry() : signIn())}
    >
      {pending
        ? t("watchlist.checking")
        : hasFirebaseUser
          ? t("watchlist.verify")
          : t("watchlist.signIn")}
    </button>
  );
}

export function WatchlistAction({
  watchlist,
  instrument,
}: {
  watchlist: WatchlistModel;
  instrument: Instrument;
}) {
  const t = useTranslations();
  if (!watchlist.authenticated) return <SignInToSave />;
  const saved = watchlist.items.some((item) => item.symbol === instrument.symbol);
  const full = !saved && watchlist.items.length >= watchlist.limit;
  return (
    <button
      className={`account-button secondary save-button ${saved ? "saved" : ""}`}
      type="button"
      aria-pressed={saved}
      disabled={watchlist.busy || !watchlist.loaded || full}
      onClick={() =>
        void (saved ? watchlist.remove(instrument.symbol) : watchlist.add(instrument.symbol))
      }
    >
      {watchlist.pendingSymbol === instrument.symbol
        ? t("watchlist.saving")
        : watchlist.loading
          ? t("watchlist.loading")
          : saved
            ? t("watchlist.remove")
            : full
              ? t("watchlist.full")
              : t("watchlist.add")}
    </button>
  );
}

export function PersonalWatchlist({
  watchlist,
  selectedSymbol,
  onSelect,
  headingId = "personal-watchlist-title",
  quotes = {},
  quotesLoading = false,
  onQuoteVisible,
}: {
  watchlist: WatchlistModel;
  selectedSymbol: string;
  onSelect: (instrument: Instrument) => void;
  headingId?: string;
  quotes?: Readonly<Record<string, StockSummary>>;
  quotesLoading?: boolean;
  onQuoteVisible?: (symbol: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  useEffect(() => setOpenSymbol(null), [selectedSymbol, watchlist.authenticated]);
  return (
    <section className="watchlist personal-watchlist" aria-labelledby={headingId}>
      <div className="panel-heading">
        <h2 id={headingId}>{t("watchlist.title")}</h2>
        {watchlist.authenticated && (
          <span>
            {watchlist.items.length} / {watchlist.limit}
          </span>
        )}
      </div>
      {!watchlist.authenticated ? (
        <div className="watchlist-intro">
          <p>{t("watchlist.intro")}</p>
          <SignInToSave />
        </div>
      ) : (
        <>
          {watchlist.items.length > 0 && (
            <ul className={styles.list} aria-label={t("watchlist.saved")}>
              {watchlist.items.map((item) => (
                <SavedInstrument
                  key={item.symbol}
                  item={item}
                  quote={quotes[item.symbol]}
                  quotesLoading={quotesLoading}
                  selected={item.symbol === selectedSymbol}
                  open={openSymbol === item.symbol}
                  disabled={watchlist.busy || !watchlist.loaded}
                  actionId={`${headingId}-${item.symbol}-actions`}
                  onReveal={(open) => setOpenSymbol(open ? item.symbol : null)}
                  onSelect={() => {
                    setOpenSymbol(null);
                    onSelect(item);
                  }}
                  onRemove={() => void watchlist.remove(item.symbol)}
                  onQuoteVisible={onQuoteVisible}
                />
              ))}
            </ul>
          )}
          <div className="watchlist-feedback" role="status" aria-live="polite" aria-atomic="true">
            {watchlist.loading && <p>{t("watchlist.loadingPersonal")}</p>}
            {!watchlist.loading && watchlist.loaded && !watchlist.items.length && (
              <p>{t("watchlist.empty")}</p>
            )}
            {watchlist.error && (
              <>
                <p className="account-error">{localizeMessage(watchlist.error, t, locale)}</p>
                <button
                  className="text-button"
                  type="button"
                  disabled={watchlist.busy}
                  onClick={() => void watchlist.reload()}
                >
                  {t("watchlist.reload")}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
