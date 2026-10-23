"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useCachedMarketResource } from "@/components/useCachedMarketResource";
import { formatFetchedAt, type CandleResponse, type Instrument } from "@/lib/market-data";
import {
  formatMarketCap,
  formatMetricNumber,
  latestSessionVolume,
  readInstrumentMetrics,
} from "@/lib/instrument-metrics";
import { localizeMessage } from "@/lib/ui-messages";
import styles from "./InstrumentMetrics.module.css";

export function InstrumentMetrics({
  instrument,
  candleData,
}: {
  instrument: Instrument;
  candleData: CandleResponse | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [reload, setReload] = useState(0);
  const readySymbol = useRef<string | null>(null);
  const chartReady = candleData?.symbol === instrument.symbol && candleData.candles.length > 0;
  if (instrument.instrumentType === "stock" && chartReady) readySymbol.current = instrument.symbol;
  // Fundamentals begin after usable candles exist, keeping the initial chart request first.
  // Once ready, changing the chart range must not restart this independent snapshot.
  const path =
    instrument.instrumentType === "stock" && readySymbol.current === instrument.symbol
      ? `/api/stocks/${encodeURIComponent(instrument.symbol)}/metrics`
      : null;
  const resource = useCachedMarketResource<unknown>(path, reload);
  const metrics = readInstrumentMetrics(resource.data, instrument.symbol);
  const latestCandle = chartReady ? candleData.candles.at(-1) : null;
  const candlePrice = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const volume = latestSessionVolume(instrument, candleData);
  const failed = Boolean(resource.error || resource.refreshError || (resource.data && !metrics));
  const warning = metrics?.warning ? localizeMessage(metrics.warning, t, locale) : "";

  return (
    <section className={styles.panel} aria-label={t("metrics.title")}>
      <dl className={styles.values}>
        {(["open", "high", "low", "close"] as const).map((field) => {
          const value = latestCandle?.[field];
          return (
            <div key={field} title={t("chart.latestCandle")}>
              <dt>{t(`chart.${field}`)}</dt>
              <dd>{value != null && Number.isFinite(value) ? candlePrice.format(value) : "—"}</dd>
            </div>
          );
        })}
        <div>
          <dt>{t("metrics.pe")}</dt>
          <dd>{formatMetricNumber(metrics?.trailingPE ?? null, locale)}</dd>
        </div>
        <div>
          <dt>{t("metrics.sessionVolume")}</dt>
          <dd>{formatMetricNumber(volume.value, locale, true)}</dd>
        </div>
        <div>
          <dt>{t("metrics.marketCap")}</dt>
          <dd>{formatMarketCap(metrics?.marketCap ?? null, metrics?.currency ?? null, locale)}</dd>
        </div>
      </dl>
      <div className={styles.meta}>
        <details className={styles.details}>
          <summary>{t("metrics.about")}</summary>
          <div>
            {instrument.instrumentType === "index" ? (
              <p>{t("metrics.index")}</p>
            ) : (
              <>
                <p>{t("metrics.peHelp")}</p>
                <p>{t("metrics.volumeHelp")}</p>
                <p>
                  {t("metrics.volumeTiming", {
                    date: volume.date ?? "—",
                    time: formatFetchedAt(candleData?.fetchedAt, locale),
                  })}
                </p>
                {volume.isPartial && <p>{t("metrics.partial")}</p>}
                {(candleData?.isMock || metrics?.isMock) && <p>{t("metrics.mock")}</p>}
                {metrics && !metrics.isMock && (
                  <>
                    <p>{t("metrics.source")}</p>
                    <p>
                      {t("metrics.metricsTiming", {
                        time: formatFetchedAt(metrics.fetchedAt, locale),
                      })}
                    </p>
                    {metrics.currency && (
                      <p>{t("metrics.currency", { currency: metrics.currency })}</p>
                    )}
                    {metrics.isStale && <p>{t("metrics.stale")}</p>}
                  </>
                )}
                {warning && <p>{warning}</p>}
              </>
            )}
          </div>
        </details>
        <span className={styles.status} role="status" aria-live="polite">
          {failed
            ? t("metrics.unavailable")
            : resource.loading
              ? t("metrics.loading")
              : resource.refreshing
                ? t("metrics.updating")
                : ""}
          {failed && (
            <button
              type="button"
              className="text-button"
              onClick={() => setReload((value) => value + 1)}
            >
              {t("metrics.retry")}
            </button>
          )}
        </span>
      </div>
    </section>
  );
}
