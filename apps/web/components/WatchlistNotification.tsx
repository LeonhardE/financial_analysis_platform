"use client";

import { useLocale, useTranslations } from "next-intl";
import type { WatchlistModel } from "@/components/useWatchlist";
import { localizeMessage } from "@/lib/ui-messages";
import styles from "./WatchlistNotification.module.css";

export function WatchlistNotification({ watchlist }: { watchlist: WatchlistModel }) {
  const t = useTranslations();
  const locale = useLocale();
  if (!watchlist.authenticated || !watchlist.message) return null;
  return (
    <div className={styles.toast} key={watchlist.messageId}>
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="m6 10 2.5 2.5L14 7" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span role="status" aria-live="polite" aria-atomic="true">
        {localizeMessage(watchlist.message, t, locale)}
      </span>
      <button
        type="button"
        aria-label={t("watchlist.dismissNotification")}
        onClick={watchlist.dismissMessage}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
