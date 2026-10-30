/** Public result identifiers only. Fragments never carry report text or credentials. */
export type InboxResultLink = { resultId: string; revision?: number };

export function readInboxResultLink(hash: string): InboxResultLink | null {
  if (hash.length > 185) return null;
  const match =
    /^#inbox\/result\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})(?:\/revisions\/([1-9][0-9]?))?$/.exec(hash);
  if (!match || match[0] !== hash) return null;
  const revision = match[2] === undefined ? undefined : Number(match[2]);
  if (revision !== undefined && revision > 32) return null;
  return revision === undefined ? { resultId: match[1] } : { resultId: match[1], revision };
}

export function inboxResultHref(resultId: string, revision?: number): string | null {
  const href = `#inbox/result/${resultId}${revision === undefined ? "" : `/revisions/${revision}`}`;
  return readInboxResultLink(href) ? href : null;
}

export function isAgentConsentHandoff(search: string): boolean {
  const query = new URLSearchParams(search);
  return query.has("agent_request") || query.has("agent_nonce");
}

/** Clearing app navigation must not reload the page and discard an unlocked Worker. */
export function clearInboxResultLink(): void {
  if (window.location.hash.startsWith("#inbox/"))
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
}
