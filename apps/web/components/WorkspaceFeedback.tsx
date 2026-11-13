"use client";
import { useEffect, useState, type ReactNode } from "react";
import styles from "./WorkspaceFeedback.module.css";

export function LoadingIndicator({
  busy,
  label,
  hasContent = false,
}: {
  busy: boolean;
  label: string;
  hasContent?: boolean;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!busy) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), 150);
    return () => window.clearTimeout(timer);
  }, [busy]);
  if (!busy || !shown) return null;
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
      {!hasContent && (
        <div className={styles.skeleton} aria-hidden="true">
          {[0, 1, 2].map((n) => (
            <span key={n} />
          ))}
        </div>
      )}
    </div>
  );
}
export function InlineError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.error} role="alert">
      <span aria-hidden="true">!</span>
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.empty} role="status">
      <svg
        viewBox="0 0 24 24"
        width="32"
        height="32"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden="true"
      >
        <path d="M3 6h7l2 2h9v12H3zM8 14h8" />
      </svg>
      <h2>{title}</h2>
      {detail && <p>{detail}</p>}
      {children}
    </div>
  );
}
export function UnreadBadge({ count, label }: { count: number; label: string }) {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  return (
    <span className={styles.badge} aria-label={label}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
export function UnreadDot({ unread }: { unread: boolean }) {
  return unread ? <span className={styles.dot} aria-hidden="true" /> : null;
}
/** Consumers must supply an authoritative Agent run state, never an owner HTTP busy flag. */
export function RunIndicator({ state, label }: { state: "waiting" | "running"; label: string }) {
  return (
    <span className={styles.run} role="status" aria-label={label} data-state={state}>
      <span className={state === "running" ? styles.spinner : styles.waiting} aria-hidden="true">
        {state === "waiting" ? "…" : null}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
