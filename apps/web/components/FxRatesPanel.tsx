"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFxFollows } from "./useFxFollows";
import { useFxRates } from "./useFxRates";
import { InlineError, LoadingIndicator } from "./WorkspaceFeedback";
import {
  PORTFOLIO_CURRENCIES,
  type PortfolioCurrency as Currency,
} from "@/lib/currency-preferences";
import { pairKey } from "@/lib/fx-follows";
import { rateLabel } from "@/lib/fx-market";
import styles from "./FxRatesPanel.module.css";

export default function FxRatesPanel({ active }: { active: boolean }) {
  const t = useTranslations("fx"),
    locale = useLocale(),
    follows = useFxFollows(active),
    rates = useFxRates(follows.pairs, follows.owner, active && Boolean(follows.snapshot));
  const [base, setBase] = useState<Currency>("USD"),
    [quote, setQuote] = useState<Currency>("CAD");
  useEffect(() => {
    setBase("USD");
    setQuote("CAD");
  }, [follows.owner]);
  const manual = follows.snapshot?.preferences?.pairs ?? [],
    chosen = { base, quote },
    subscribed = manual.some((p) => pairKey(p) === pairKey(chosen)),
    full = manual.length >= 12;
  const priceMap = new Map(rates.data?.items.map((i) => [pairKey(i), i]) ?? []),
    dates = [
      ...new Set(rates.data?.items.flatMap((i) => (i.sourceDate ? [i.sourceDate] : [])) ?? []),
    ].sort();
  const dateLabel = (date: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(
      new Date(date + "T00:00:00Z"),
    );
  return (
    <section className={styles.panel} aria-labelledby="fx-title">
      <header className={styles.header}>
        <h2 id="fx-title">{t("title")}</h2>
        <button
          type="button"
          className={styles.refresh}
          aria-label={t("refresh")}
          disabled={!active || !follows.pairs.length || rates.loading || rates.refreshing}
          onClick={() => {
            follows.retry();
            rates.refresh();
          }}
        >
          ↻
        </button>
      </header>
      {follows.checking ? (
        <LoadingIndicator busy label={t("loadingFollows")} />
      ) : !follows.authenticated ? (
        <div className={styles.empty}>
          <p>{t("signInHelp")}</p>
          <button type="button" disabled={!follows.canSignIn} onClick={() => void follows.signIn()}>
            {t("signIn")}
          </button>
        </div>
      ) : (
        <>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (follows.canChange && !subscribed && !full) follows.add(chosen);
            }}
          >
            <label>
              <span className="sr-only">{t("base")}</span>
              <select
                value={base}
                disabled={!follows.canChange}
                onChange={(e) => {
                  const next = e.target.value as Currency;
                  setBase(next);
                  if (next === quote) setQuote(next === "USD" ? "CAD" : "USD");
                }}
              >
                {PORTFOLIO_CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <span className={styles.to} aria-hidden="true">
              /
            </span>
            <label>
              <span className="sr-only">{t("quote")}</span>
              <select
                value={quote}
                disabled={!follows.canChange}
                onChange={(e) => setQuote(e.target.value as Currency)}
              >
                {PORTFOLIO_CURRENCIES.filter((c) => c !== base).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={!follows.canChange || subscribed || full}>
              {t(subscribed ? "subscribed" : "subscribe")}
            </button>
          </form>
          {follows.loading && (
            <LoadingIndicator
              busy
              hasContent={Boolean(follows.snapshot)}
              label={t("loadingFollows")}
            />
          )}
          {follows.saving && <LoadingIndicator busy hasContent label={t("saving")} />}
          {follows.error && (
            <InlineError
              message={t(follows.uncertain ? "checkSave" : "followsError")}
              onRetry={follows.retry}
              retryLabel={t("retry")}
            />
          )}
          {follows.currencyLoading && <LoadingIndicator busy label={t("loadingCurrency")} />}
          {follows.currencyError && (
            <InlineError
              message={t("currencyError")}
              onRetry={follows.currencyRetry}
              retryLabel={t("retry")}
            />
          )}
          {(rates.loading || rates.refreshing) && (
            <LoadingIndicator busy hasContent={Boolean(rates.data)} label={t("loadingRates")} />
          )}
          {rates.error && (
            <InlineError
              message={t("ratesError")}
              onRetry={rates.refresh}
              retryLabel={t("retry")}
            />
          )}
          {follows.snapshot && !follows.pairs.length && !follows.loading && (
            <div className={styles.empty}>
              <p>{t("empty")}</p>
            </div>
          )}
          {follows.pairs.length > 0 && (
            <ul className={styles.list} tabIndex={0} aria-label={t("list")}>
              {follows.pairs.map((p) => {
                const rate = priceMap.get(pairKey(p)),
                  pending = !rate && (rates.loading || rates.refreshing);
                return (
                  <li key={pairKey(p)} className={styles.row}>
                    <div className={styles.pair}>
                      <strong>1 {p.base}</strong>
                      <span>=</span>
                      <div>
                        {pending ? (
                          <span className={styles.placeholder} aria-label={t("loadingRates")} />
                        ) : (
                          <strong>
                            {rateLabel(rate?.rate ?? null)} {p.quote}
                          </strong>
                        )}
                        <small>
                          {rate?.status === "stale"
                            ? t("stale")
                            : rate && !rate.rate
                              ? t("unavailable")
                              : p.origin === "default"
                                ? t("default")
                                : ""}
                          {rate?.sourceDate && (dates.length > 1 || rate.status === "stale")
                            ? ` · ${dateLabel(rate.sourceDate)}`
                            : ""}
                        </small>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.remove}
                      disabled={!follows.canChange}
                      aria-label={t("remove", { pair: pairKey(p) })}
                      onClick={() => follows.remove(p)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <footer className={styles.footer}>
        <a
          href="https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/"
          target="_blank"
          rel="noreferrer"
        >
          {t("source")}
        </a>
        {dates.length > 0 && (
          <span>
            {dates.length === 1
              ? dateLabel(dates[0])
              : `${dateLabel(dates[0])} – ${dateLabel(dates.at(-1)!)}`}
          </span>
        )}
      </footer>
    </section>
  );
}
