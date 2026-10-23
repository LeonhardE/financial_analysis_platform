/** Translate UI-owned responses at the presentation boundary; preserve unknown source details in English. */
type Translate = (key: string, values?: Record<string, string | number>) => string;
const messageKeys: Record<string, string> = {
  "Market data is temporarily unavailable. Please try again later.": "market",
  "Could not finish signing out. Please try again.": "signOut",
  "Could not restore your session. Please try again.": "session",
  "Market data is unavailable. Please try again shortly.": "market",
  "No market data is available for this symbol.": "noMarket",
  "Too many requests. Please wait before retrying.": "rateLimit",
  "Too many requests. Wait a moment before trying again.": "rateLimit",
  "The market data request timed out. Please try again shortly.": "marketTimeout",
  "Daily market data is temporarily unavailable. Please try again later.": "dailyUnavailable",
  "Showing previously fetched Yahoo data while a refresh is unavailable.": "stale",
  "Market refreshes are paused because the shared cache is unavailable.": "cacheUnavailable",
  "Fictional demonstration data; not real market prices.": "simulated",
  "Yahoo is temporarily unavailable; cached data will be used.": "yahooCooldown",
  "The shared daily market refresh limit has been reached.": "dailyLimit",
  "Market refreshes are temporarily limited. Please try again shortly.": "refreshLimit",
  "Cached snapshot; checking for newer data.": "refreshing",
  "Your watchlist is full. Remove an item before adding another.": "watchlistFull",
  "This instrument could not be saved. Try searching for it again.": "saveInstrument",
  "Your watchlist is temporarily unavailable. Please try again.": "watchlistUnavailable",
  "The watchlist request took too long. Reload your watchlist to try again.": "watchlistTimeout",
  "Invalid watchlist response": "invalidWatchlist",
  "Allow pop-ups for this site, then try signing in again.": "popup",
  "Could not connect to Google. Check your connection and try again.": "networkGoogle",
  "Google sign-in is temporarily unavailable. You can continue browsing.": "signIn",
  "Could not verify your account. Please try again.": "verify",
  "Account verification took too long. Please try again.": "verifyTimeout",
  "Your session could not be verified. Sign out and sign in again.": "session",
  "Sign-in is temporarily unavailable. Please try again.": "signInUnavailable",
  "Could not sign out. Please try again.": "signOut",
};
export function localizeMessage(value: string | null | undefined, t: Translate, locale = "en") {
  if (!value) return "";
  const key = messageKeys[value];
  if (key) return t(`errors.${key}`);
  const saved = /^([A-Z][A-Z0-9.-]*) (added to|removed from) your watchlist\.$/.exec(value);
  if (saved)
    return t(saved[2] === "added to" ? "watchlist.added" : "watchlist.removed", {
      symbol: saved[1],
    });
  const partial = /^Some quotes could not be refreshed: ([A-Z0-9., -]+)\.$/.exec(value);
  if (partial) return t("errors.partialQuotes", { symbols: partial[1] });
  // Unrecognized remote messages remain readable as source detail, never interpreted as markup.
  return locale === "en" ? value : `${t("errors.unknown")} (${value})`;
}
