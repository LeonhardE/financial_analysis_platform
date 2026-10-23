"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { localizeMessage } from "@/lib/ui-messages";
import { useAuth } from "@/components/AuthProvider";
import styles from "./AccountControls.module.css";

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.36Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.23-2.51c-.9.6-2.05.97-3.39.97-2.6 0-4.8-1.76-5.58-4.12H3.08v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.42 13.93A6 6 0 0 1 6.1 12c0-.67.12-1.32.32-1.93V7.48H3.08A10 10 0 0 0 2 12c0 1.61.38 3.14 1.08 4.52l3.34-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.95c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.92 5.48l3.34 2.59A5.96 5.96 0 0 1 12 5.95Z"
      />
    </svg>
  );
}

function AccountIcon({ kind }: { kind: "user" | "sign-out" | "retry" | "notice" }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "user" ? (
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
        </>
      ) : kind === "sign-out" ? (
        <>
          <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M13 7l5 5-5 5M8 12h10" />
        </>
      ) : kind === "retry" ? (
        <>
          <path d="M20 7v5h-5M4 17v-5h5" />
          <path d="M6.1 7a7 7 0 0 1 11.7-1L20 9M4 15l2.2 3A7 7 0 0 0 18 17" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6M12 17h.01" />
        </>
      )}
    </svg>
  );
}

function AccountAvatar({
  name,
  photoURL,
  guest,
}: {
  name: string;
  photoURL: string | null;
  guest: boolean;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  return (
    <span className={styles.avatar} aria-hidden="true">
      {photoURL && photoURL !== failedPhoto ? (
        <img
          src={photoURL}
          alt=""
          width="30"
          height="30"
          referrerPolicy="no-referrer"
          onError={() => setFailedPhoto(photoURL)}
        />
      ) : guest ? (
        <AccountIcon kind="user" />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

export function AccountControls({ collapsed = false }: { collapsed?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const { status, profile, error, hasFirebaseUser, signIn, signOut, retry } = useAuth();
  const pending = ["loading", "signing-in", "verifying", "signing-out"].includes(status);
  const accountName = profile?.displayName || profile?.email || t("account.googleAccount");
  const profileName = hasFirebaseUser ? accountName : t("account.guest");
  const notice = error
    ? localizeMessage(error, t, locale)
    : status === "unavailable"
      ? t("account.unavailable")
      : null;
  const statusText =
    status === "loading"
      ? t("account.checking")
      : status === "signing-in"
        ? t("account.opening")
        : status === "verifying"
          ? t("account.verifying")
          : status === "signing-out"
            ? t("account.signingOut")
            : null;

  return (
    <div className={`${styles.controls} ${collapsed ? styles.collapsed : ""}`}>
      {notice &&
        (collapsed ? (
          <details className={styles.notice}>
            <summary title={notice} aria-label={`${t("account.notice")}: ${notice}`}>
              <AccountIcon kind="notice" />
            </summary>
            <p role={error ? "alert" : "status"}>{notice}</p>
          </details>
        ) : (
          <p className={styles.message} role={error ? "alert" : "status"}>
            {notice}
          </p>
        ))}
      <div className={styles.profile} title={profile?.email ?? profileName}>
        <AccountAvatar
          name={profileName}
          photoURL={profile?.photoURL ?? null}
          guest={!hasFirebaseUser}
        />
        <span className={collapsed ? styles.visuallyHidden : styles.name}>{profileName}</span>
      </div>
      <span className={collapsed ? styles.visuallyHidden : styles.pending} role="status">
        {hasFirebaseUser ? statusText : null}
      </span>
      <div className={styles.actions}>
        {hasFirebaseUser ? (
          <>
            {status === "error" && (
              <button
                className={styles.button}
                onClick={() => void retry()}
                type="button"
                title={t("account.retry")}
                aria-label={t("account.retry")}
              >
                <AccountIcon kind="retry" />
                {!collapsed && <span>{t("account.retry")}</span>}
              </button>
            )}
            <button
              className={styles.button}
              disabled={status === "signing-out"}
              onClick={() => void signOut()}
              type="button"
              title={status === "signing-out" ? t("account.signingOut") : t("account.signOut")}
              aria-label={status === "signing-out" ? t("account.signingOut") : t("account.signOut")}
            >
              <AccountIcon kind="sign-out" />
              {!collapsed && (
                <span>
                  {status === "signing-out" ? t("account.signingOut") : t("account.signOut")}
                </span>
              )}
            </button>
          </>
        ) : (
          <button
            className={styles.button}
            disabled={pending || status === "unavailable"}
            onClick={() => void signIn()}
            type="button"
            title={statusText ?? t("account.signIn")}
            aria-label={statusText ?? t("account.signIn")}
          >
            <GoogleMark />
            {!collapsed && <span>{statusText ?? t("account.signIn")}</span>}
          </button>
        )}
      </div>
    </div>
  );
}
