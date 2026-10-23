"use client";

import { useAuth } from "@/components/AuthProvider";
import type { WatchlistModel } from "@/components/useWatchlist";
import type { Instrument } from "@/lib/market-data";

function SignInToSave() {
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
        ? "Checking account…"
        : hasFirebaseUser
          ? "Verify account to save"
          : "Sign in to save"}
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
        ? "Saving…"
        : watchlist.loading
          ? "Loading watchlist…"
          : saved
            ? "Remove from watchlist"
            : full
              ? "Watchlist full"
              : "Add to watchlist"}
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
  return (
    <section className="watchlist personal-watchlist" aria-labelledby={headingId}>
      <div className="panel-heading">
        <h2 id={headingId}>My watchlist</h2>
        {watchlist.authenticated && (
          <span>
            {watchlist.items.length} / {watchlist.limit}
          </span>
        )}
      </div>
      {!watchlist.authenticated ? (
        <div className="watchlist-intro">
          <p>Keep your favorite stocks in one place, across devices.</p>
          <SignInToSave />
        </div>
      ) : (
        <>
          {watchlist.items.length > 0 && (
            <ul className="saved-stock-list" aria-label="Your saved instruments">
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
                    aria-label={`Remove ${item.symbol} from watchlist`}
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
            {watchlist.loading && <p>Loading your watchlist…</p>}
            {!watchlist.loading && watchlist.loaded && !watchlist.items.length && (
              <p>Your watchlist is empty. Open a stock and choose “Add to watchlist”.</p>
            )}
            {watchlist.error && (
              <>
                <p className="account-error">{watchlist.error}</p>
                <button
                  className="text-button"
                  type="button"
                  disabled={watchlist.busy}
                  onClick={() => void watchlist.reload()}
                >
                  Reload watchlist
                </button>
              </>
            )}
            {watchlist.message && <p>{watchlist.message}</p>}
          </div>
          <p className="overview-footnote">Only visible to your signed-in account</p>
        </>
      )}
    </section>
  );
}
