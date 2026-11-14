"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "@/components/PreferencesProvider";
import type { Preferences } from "@/lib/preferences";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import SettingsSecurityPanel from "./SettingsSecurityPanel";
import { useCurrencyPreferences } from "./CurrencyPreferencesProvider";
import { PORTFOLIO_CURRENCIES, type PortfolioCurrency } from "@/lib/currency-preferences";
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
  const currency = useCurrencyPreferences();
  const disabled = authenticated && (loading || error === "load" || error === "loadTimeout");
  const anySaving = saving || currency.saving;
  const anyError = error || currency.error;
  const wasSaving = useRef(false);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    // Restoring settings and returning to this page must not replay an old save.
    const saved =
      wasSaving.current &&
      authenticated &&
      !anySaving &&
      (status === "saved" || Boolean(currency.snapshot)) &&
      !anyError;
    wasSaving.current = authenticated && anySaving;
    setShowSaved(Boolean(saved));
    if (!saved) return;
    const timeout = window.setTimeout(() => setShowSaved(false), 3_000);
    return () => window.clearTimeout(timeout);
  }, [authenticated, anySaving, status, anyError, currency.snapshot]);

  return (
    <section className={styles.panel} aria-labelledby="settings-title">
      <header className={styles.heading}>
        <h1 id="settings-title">{t("title")}</h1>
      </header>
      <div className={styles.preferences}>
        <fieldset className={styles.row} disabled={disabled} aria-labelledby="appearance-title">
          <div className={styles.rowCopy}>
            <h2 id="appearance-title">{t("appearance")}</h2>
          </div>
          <div
            className={styles.choices}
            data-loading={disabled}
            data-error={Boolean(error)}
            aria-hidden={disabled}
            aria-busy={loading}
          >
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
        <fieldset className={styles.row} disabled={disabled} aria-labelledby="language-title">
          <div className={styles.rowCopy}>
            <h2 id="language-title">{t("language")}</h2>
          </div>
          <div
            className={styles.select}
            data-loading={disabled}
            data-error={Boolean(error)}
            aria-hidden={disabled}
            aria-busy={loading}
          >
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
              <option value="zh-Hant" lang="zh-Hant">
                繁體中文
              </option>
            </select>
            <SelectChevron />
          </div>
        </fieldset>
        <fieldset className={styles.row} disabled={disabled} aria-labelledby="chart-range-title">
          <div className={styles.rowCopy}>
            <h2 id="chart-range-title">{t("chartRange")}</h2>
          </div>
          <div
            className={styles.select}
            data-loading={disabled}
            data-error={Boolean(error)}
            aria-hidden={disabled}
            aria-busy={loading}
          >
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
        <fieldset
          className={styles.row}
          disabled={!currency.authenticated || !currency.loaded}
          aria-labelledby="currency-title"
          aria-describedby="currency-help"
        >
          <div className={styles.rowCopy}>
            <h2 id="currency-title">{t("currency")}</h2>
            <p id="currency-help">{t("currencyHelp")}</p>
          </div>
          <div className={styles.currencyControl}>
            <div
              className={styles.select}
              data-loading={currency.authenticated && !currency.loaded}
              data-error={Boolean(currency.error)}
              aria-hidden={currency.authenticated && !currency.loaded}
              aria-busy={currency.loading}
            >
              <label className="sr-only" htmlFor="preference-currency">
                {t("currency")}
              </label>
              <select
                id="preference-currency"
                value={currency.selected}
                onChange={(event) => currency.select(event.target.value as PortfolioCurrency)}
              >
                {PORTFOLIO_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
            {currency.saving && (
              <span className={styles.fieldStatus} role="status">
                <span className={styles.spinner} aria-hidden="true" />
                {t("saving")}
              </span>
            )}
          </div>
        </fieldset>
      </div>
      {!authenticated && <p className={styles.accountNote}>{t("guestNote")}</p>}
      {currency.error && (
        <div className={styles.error} role="alert">
          <p>{t(`currencyErrors.${currency.error}`)}</p>
          <button type="button" className={styles.retry} onClick={currency.retry}>
            {t("retry")}
          </button>
        </div>
      )}
      <div className={styles.saveState} aria-live="polite">
        {error ? (
          <div className={styles.error} role="alert">
            <p>{t(`errors.${error}`)}</p>
            <button type="button" className={styles.retry} onClick={retry}>
              {t("retry")}
            </button>
          </div>
        ) : authenticated && (loading || saving) ? (
          <p className={styles.fieldStatus}>
            <span className={styles.spinner} aria-hidden="true" />
            {t(loading ? "loading" : "saving")}
          </p>
        ) : null}
      </div>
      {showSaved && authenticated && !anySaving && !anyError && (
        <div className={styles.toast} role="status" aria-live="polite" aria-atomic="true">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
            <path d="m6 10 2.5 2.5L14 7" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>{t("saved")}</span>
        </div>
      )}
      {workspace && <SettingsSecurityPanel workspace={workspace} />}
    </section>
  );
}
