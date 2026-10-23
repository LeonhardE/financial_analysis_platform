"use client";

import { useTranslations } from "next-intl";
import { usePreferences } from "@/components/PreferencesProvider";
import type { Preferences } from "@/lib/preferences";

export default function SettingsPanel() {
  const t = useTranslations("settings");
  const { preferences, authenticated, loading, saving, status, error, updatePreferences, retry } =
    usePreferences();
  const disabled = authenticated && (loading || error === "load" || error === "loadTimeout");

  return (
    <section className="settings-panel" aria-labelledby="settings-title">
      <header className="settings-heading">
        <p className="section-kicker">{t("eyebrow")}</p>
        <h1 id="settings-title">{t("title")}</h1>
        <p>{t("description")}</p>
      </header>
      <p className="settings-account-note">{t(authenticated ? "accountNote" : "guestNote")}</p>
      <div className="settings-grid">
        <fieldset className="preference-card" disabled={disabled}>
          <legend>{t("appearance")}</legend>
          <p>{t("appearanceHelp")}</p>
          <div className="preference-choices">
            {(["light", "dark", "system"] as const).map((theme) => (
              <label className="preference-choice" key={theme}>
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
        <fieldset className="preference-card" disabled={disabled}>
          <legend>{t("language")}</legend>
          <p>{t("languageHelp")}</p>
          <label className="preference-select-label" htmlFor="preference-language">
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
        </fieldset>
        <fieldset className="preference-card" disabled={disabled}>
          <legend>{t("chartRange")}</legend>
          <p>{t("chartRangeHelp")}</p>
          <label className="preference-select-label" htmlFor="preference-range">
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
        </fieldset>
      </div>
      <div className="settings-save-state" aria-live="polite">
        {error ? (
          <div className="settings-error" role="alert">
            <p>{t(`errors.${error}`)}</p>
            <button type="button" className="account-button secondary" onClick={retry}>
              {t("retry")}
            </button>
          </div>
        ) : (
          <p>
            {t(
              !authenticated
                ? "guestStatus"
                : loading
                  ? "loading"
                  : saving
                    ? "saving"
                    : status === "saved"
                      ? "saved"
                      : "ready",
            )}
          </p>
        )}
      </div>
    </section>
  );
}
