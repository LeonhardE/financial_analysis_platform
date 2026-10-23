"use client";

import { useTranslations, useLocale } from "next-intl";
import { localizeMessage } from "@/lib/ui-messages";
import { useAuth } from "@/components/AuthProvider";

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

export function AccountControls() {
  const t = useTranslations();
  const locale = useLocale();
  const { status, profile, error, hasFirebaseUser, signIn, signOut, retry } = useAuth();
  const pending = ["loading", "signing-in", "verifying", "signing-out"].includes(status);
  const accountName = profile?.displayName || profile?.email || t("account.googleAccount");
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
    <div className="account-controls">
      <div className="account-actions">
        {profile && (
          <div className="account-profile" title={profile.email ?? accountName}>
            <span className="account-avatar" aria-hidden="true">
              {accountName.slice(0, 1).toUpperCase()}
            </span>
            <span className="account-name">{accountName}</span>
          </div>
        )}
        {hasFirebaseUser ? (
          <>
            {status === "verifying" && (
              <span className="account-pending">{t("account.verifying")}</span>
            )}
            {status === "error" && (
              <button
                className="account-button secondary"
                onClick={() => void retry()}
                type="button"
              >
                {t("account.retry")}
              </button>
            )}
            <button
              className="account-button secondary"
              disabled={status === "signing-out"}
              onClick={() => void signOut()}
              type="button"
            >
              {status === "signing-out" ? t("account.signingOut") : t("account.signOut")}
            </button>
          </>
        ) : (
          <button
            className="account-button google-sign-in"
            disabled={pending || status === "unavailable"}
            onClick={() => void signIn()}
            type="button"
          >
            <GoogleMark />
            {statusText ?? t("account.signIn")}
          </button>
        )}
      </div>
      <div className="account-message" aria-live="polite" aria-atomic="true">
        {error && <span className="account-error">{localizeMessage(error, t, locale)}</span>}
        {status === "unavailable" && <span>{t("account.unavailable")}</span>}
      </div>
    </div>
  );
}
