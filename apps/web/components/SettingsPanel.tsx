"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "@/components/PreferencesProvider";
import type { Preferences } from "@/lib/preferences";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import VaultManagementPanel from "./VaultManagementPanel";
import styles from "./SettingsPanel.module.css";

function SelectChevron() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function SettingsPanel({ workspace }: { workspace?: HoldingsWorkspace } = {}) {
  const t = useTranslations("settings");
  const { preferences, authenticated, loading, saving, status, error, updatePreferences, retry } =
    usePreferences();
  const disabled = authenticated && (loading || error === "load" || error === "loadTimeout");
  const wasSaving = useRef(false);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    // Restoring settings and returning to this page must not replay an old save.
    const saved = wasSaving.current && authenticated && !saving && status === "saved" && !error;
    wasSaving.current = authenticated && saving;
    setShowSaved(Boolean(saved));
    if (!saved) return;
    const timeout = window.setTimeout(() => setShowSaved(false), 3_000);
    return () => window.clearTimeout(timeout);
  }, [authenticated, saving, status, error]);

  return (
    <section className={styles.panel} aria-labelledby="settings-title">
      <header className={styles.heading}>
        <h1 id="settings-title">{t("title")}</h1>
        <p>{t("description")}</p>
      </header>
      <div className={styles.preferences}>
        <fieldset
          className={styles.row}
          disabled={disabled}
          aria-labelledby="appearance-title"
          aria-describedby="appearance-help"
        >
          <div className={styles.rowCopy}>
            <h2 id="appearance-title">{t("appearance")}</h2>
            <p id="appearance-help">{t("appearanceHelp")}</p>
          </div>
          <div className={styles.choices}>
            {(["light", "dark", "system"] as const).map((theme) => (
              <label className={styles.choice} key={theme}>
                <input
                  type="radio"
                  name="theme"
                  value={theme}
                  checked={preferences.theme === theme}
                  onChange={() => updatePreferences({ theme })}
                />
                <span>{t(`themes.${theme}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset
          className={styles.row}
          disabled={disabled}
          aria-labelledby="language-title"
          aria-describedby="language-help"
        >
          <div className={styles.rowCopy}>
            <h2 id="language-title">{t("language")}</h2>
            <p id="language-help">{t("languageHelp")}</p>
          </div>
          <div className={styles.select}>
            <label className="sr-only" htmlFor="preference-language">
              {t("languageLabel")}
            </label>
            <select
              id="preference-language"
              value={preferences.language}
              onChange={(event) =>
                updatePreferences({ language: event.target.value as Preferences["language"] })
              }
            >
              <option value="en" lang="en">
                English
              </option>
              <option value="zh" lang="zh-CN">
                简体中文
              </option>
            </select>
            <SelectChevron />
          </div>
        </fieldset>
        <fieldset
          className={styles.row}
          disabled={disabled}
          aria-labelledby="chart-range-title"
          aria-describedby="chart-range-help"
        >
          <div className={styles.rowCopy}>
            <h2 id="chart-range-title">{t("chartRange")}</h2>
            <p id="chart-range-help">{t("chartRangeHelp")}</p>
          </div>
          <div className={styles.select}>
            <label className="sr-only" htmlFor="preference-range">
              {t("chartRangeLabel")}
            </label>
            <select
              id="preference-range"
              value={preferences.defaultChartRange}
              onChange={(event) =>
                updatePreferences({
                  defaultChartRange: event.target.value as Preferences["defaultChartRange"],
                })
              }
            >
              {(["1d", "1w", "1m", "3m", "1y"] as const).map((range) => (
                <option value={range} key={range}>
                  {t(`ranges.${range}`)}
                </option>
              ))}
            </select>
            <SelectChevron />
          </div>
        </fieldset>
      </div>
      <p className={styles.accountNote}>{t(authenticated ? "accountNote" : "guestNote")}</p>
      <div className={styles.saveState} aria-live="polite">
        {error ? (
          <div className={styles.error} role="alert">
            <p>{t(`errors.${error}`)}</p>
            <button type="button" className={styles.retry} onClick={retry}>
              {t("retry")}
            </button>
          </div>
        ) : authenticated && (loading || saving) ? (
          <p>{t(loading ? "loading" : "saving")}</p>
        ) : null}
      </div>
      {showSaved && authenticated && status === "saved" && !saving && !error && (
        <div className={styles.toast} role="status" aria-live="polite" aria-atomic="true">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
            <path d="m6 10 2.5 2.5L14 7" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>{t("saved")}</span>
        </div>
      )}
      {workspace && <VaultManagementPanel workspace={workspace} />}
    </section>
  );
}
