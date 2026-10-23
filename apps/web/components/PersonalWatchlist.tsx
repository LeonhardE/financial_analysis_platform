"use client";

import { useTranslations, useLocale } from "next-intl";
import { localizeMessage } from "@/lib/ui-messages";
import { useAuth } from "@/components/AuthProvider";
import type { WatchlistModel } from "@/components/useWatchlist";
import type { Instrument } from "@/lib/market-data";

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
}: {
  watchlist: WatchlistModel;
  selectedSymbol: string;
  onSelect: (instrument: Instrument) => void;
  headingId?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
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
            <ul className="saved-stock-list" aria-label={t("watchlist.saved")}>
              {watchlist.items.map((item) => (
                <li key={item.symbol} className={item.symbol === selectedSymbol ? "active" : ""}>
                  <button
                    className="saved-stock-select"
                    type="button"
                    aria-pressed={item.symbol === selectedSymbol}
                    onClick={() => onSelect(item)}
                  >
                    <span className="symbol-block">
                      <strong>{item.symbol}</strong>
                      <small>{item.name}</small>
                    </span>
                  </button>
                  <button
                    className="saved-stock-remove"
                    type="button"
                    aria-label={t("watchlist.removeSymbol", { symbol: item.symbol })}
                    disabled={watchlist.busy || !watchlist.loaded}
                    onClick={() => void watchlist.remove(item.symbol)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
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
            {watchlist.message && <p>{localizeMessage(watchlist.message, t, locale)}</p>}
          </div>
        </>
      )}
    </section>
  );
}
