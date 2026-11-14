"use client";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useCurrencyPreferences } from "./CurrencyPreferencesProvider";
import { useHoldingsValuation } from "./useHoldingsValuation";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import { ReportDialog } from "./ReportDialog";
import { EmptyState, InlineError, LoadingIndicator } from "./WorkspaceFeedback";
import { formatHoldingsTime } from "@/lib/holdings-facts";
import {
  allocation,
  instrumentKey,
  money,
  unitMoney,
  decimalLabel,
  weightLabel,
  sumAmounts,
  type AllocationSlice,
  type Currency,
  type HoldingsFacts,
  type HoldingsValuation as Valuation,
} from "@/lib/holdings-valuation";
import styles from "./HoldingsValuation.module.css";

const COLORS = [
  "#4263c7",
  "#9c60b5",
  "#008c91",
  "#be7936",
  "#5a8d49",
  "#b45179",
  "#7183be",
  "#a29437",
  "#4a8aab",
  "#af6c57",
  "#8074ad",
  "#6e7e84",
];
function Pie({ rows, label }: { rows: AllocationSlice[]; label: string }) {
  let offset = 0;
  return (
    <svg viewBox="0 0 200 200" className={styles.pie} role="img" aria-label={label}>
      {rows.map((row, n) => {
        const part = Math.min(100 - offset, Math.max(0, Number(row.weight))),
          start = (offset * Math.PI) / 50 - Math.PI / 2;
        offset += part;
        const end = (offset * Math.PI) / 50 - Math.PI / 2;
        return part >= 99.999999 ? (
          <circle key={row.key} cx="100" cy="100" r="86" fill={COLORS[n]} />
        ) : (
          <path
            key={row.key}
            fill={COLORS[n]}
            d={`M100 100 L${100 + 86 * Math.cos(start)} ${100 + 86 * Math.sin(start)} A86 86 0 ${part > 50 ? 1 : 0} 1 ${100 + 86 * Math.cos(end)} ${100 + 86 * Math.sin(end)} Z`}
          />
        );
      })}
    </svg>
  );
}
export function HoldingsAllocation({
  facts,
  valuation,
  identity,
  onClose,
}: {
  facts: HoldingsFacts;
  valuation: Valuation;
  identity: string;
  onClose: () => void;
}) {
  const t = useTranslations("holdingsValuation"),
    [kind, setKind] = useState<"pie" | "bar">("pie");
  const rows = useMemo(() => allocation(facts, valuation, t("others")), [facts, valuation, t]);
  return (
    <ReportDialog
      id="holdings-allocation"
      open
      identity={identity}
      title={t("allocation")}
      closeLabel={t("close")}
      onClose={onClose}
    >
      <div className={styles.chartHeader}>
        <strong>{money(valuation.subtotal, valuation.currency)}</strong>
        <div className={styles.segmented} role="group" aria-label={t("chartType")}>
          <button type="button" aria-pressed={kind === "pie"} onClick={() => setKind("pie")}>
            {t("pie")}
          </button>
          <button type="button" aria-pressed={kind === "bar"} onClick={() => setKind("bar")}>
            {t("bar")}
          </button>
        </div>
      </div>
      <p className={styles.note}>
        {t(valuation.complete ? "denominator" : "partialDenominator", {
          known: valuation.valuedCount,
          total: valuation.positionCount,
        })}
      </p>
      {!rows.length ? (
        <EmptyState title={t("emptyChart")} detail={t("emptyChartHelp")} />
      ) : (
        <div key={kind} className={styles.chart} data-kind={kind}>
          {kind === "pie" ? (
            <Pie rows={rows} label={t("allocation")} />
          ) : (
            <div className={styles.bars} role="img" aria-label={t("allocation")}>
              {rows.map((row, n) => (
                <div className={styles.barRow} key={row.key}>
                  <span>{row.label}</span>
                  <span className={styles.track}>
                    <span
                      style={{
                        width: `${Math.min(100, Number(row.weight))}%`,
                        background: COLORS[n],
                      }}
                    />
                  </span>
                </div>
              ))}
            </div>
          )}
          <ul className={styles.legend}>
            {rows.map((row, n) => (
              <li key={row.key}>
                <span
                  className={styles.swatch}
                  style={{ background: COLORS[n] }}
                  aria-hidden="true"
                />
                <span>
                  {row.label}
                  {row.detail && <small>{row.detail}</small>}
                  {row.positions > 1 && <small>{t("grouped", { count: row.positions })}</small>}
                </span>
                <span>
                  <strong>{money(row.value, valuation.currency)}</strong>
                  <small>{weightLabel(row.weight)}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className={styles.note}>{t("cashExcluded")}</p>
    </ReportDialog>
  );
}

export default function HoldingsValuation({
  model,
  onEdit,
  active = true,
}: {
  model: HoldingsWorkspace;
  onEdit?: (accountId: string, assetId: string) => void;
  active?: boolean;
}) {
  const t = useTranslations("holdingsValuation"),
    locale = useLocale(),
    preferences = useCurrencyPreferences();
  const view = useHoldingsValuation(model, preferences.defaultPortfolioCurrency, active);
  const [chart, setChart] = useState<string | null>(null);
  const identity = model.editScope;
  useEffect(() => setChart(null), [identity]);
  const quoteMap = useMemo(
    () =>
      new Map(
        view.prices?.quotes.flatMap((b) =>
          b.items.map((i) => [instrumentKey(i.instrument), i] as const),
        ) ?? [],
      ),
    [view.prices],
  );
  const rows = useMemo(
    () =>
      new Map(view.valuation?.rows.map((r) => [JSON.stringify([r.accountId, r.assetId]), r]) ?? []),
    [view.valuation],
  );
  const cash = useMemo(() => {
    const values = new Map<Currency, Array<string | null>>();
    for (const a of view.facts?.data.accounts ?? [])
      for (const b of a.balances)
        values.set(b.currency, [...(values.get(b.currency) ?? []), b.cashBalance]);
    return [...values].map(([currency, amounts]) => {
      const known = amounts.filter((v): v is string => v !== null);
      return {
        currency,
        amount: known.length ? sumAmounts(known) : null,
        complete: known.length === amounts.length,
      };
    });
  }, [view.facts]);
  if (!view.facts) return null;
  const times = [...quoteMap.values()].flatMap((q) => (q.sourceAsOf ? [q.sourceAsOf] : [])).sort();
  const fxDate = view.prices?.fx.items.find((i) => i.sourceDate)?.sourceDate;
  return (
    <div className={styles.workspace}>
      <div className={styles.summary}>
        <div>
          <span className={styles.caption}>
            {t(view.valuation && !view.valuation.complete ? "subtotal" : "total")}
          </span>
          <strong className={styles.total}>
            {view.currency ? money(view.valuation?.subtotal ?? null, view.currency) : "—"}
          </strong>
          {view.valuation && !view.valuation.complete && (
            <span className={styles.coverage}>
              {t("coverage", {
                known: view.valuation.valuedCount,
                total: view.valuation.positionCount,
              })}
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <label>
            <span className="sr-only">{t("displayCurrency")}</span>
            <select
              aria-label={t("displayCurrency")}
              value={view.currency ?? ""}
              disabled={!view.currency}
              onChange={(e) => view.select(e.target.value as Currency)}
            >
              {!view.currency && <option value="">—</option>}
              {view.options.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {!view.isDefault && (
            <button type="button" onClick={view.reset}>
              {t("reset")}
            </button>
          )}
          <button type="button" onClick={() => setChart(identity)} disabled={!view.valuation}>
            {t("visualize")}
          </button>
          <button type="button" onClick={view.refresh} disabled={view.busy || !view.currency}>
            {t("refresh")}
          </button>
        </div>
      </div>
      {!preferences.loaded && <LoadingIndicator busy label={t("loadingCurrency")} />}
      {preferences.error && (
        <InlineError
          message={t("currencyError")}
          onRetry={preferences.retry}
          retryLabel={t("retry")}
        />
      )}
      <LoadingIndicator
        busy={view.busy}
        hasContent
        label={t(view.progress?.phase === "cache" ? "loadingPrices" : "updating")}
      />
      {view.busy && view.progress && view.progress.total > 0 && (
        <progress
          className={styles.progress}
          aria-label={t(view.progress.phase === "cache" ? "loadingPrices" : "updating")}
          max={view.progress.total}
          value={view.progress.done}
        />
      )}
      {view.error && (
        <InlineError message={t("refreshError")} onRetry={view.refresh} retryLabel={t("retry")} />
      )}
      {view.valuation?.stale && (
        <p className={styles.note} role="status">
          {t("stale")}
        </p>
      )}
      {view.valuation && !view.valuation.complete && (
        <p className={styles.note}>
          {t("partialDenominator", {
            known: view.valuation.valuedCount,
            total: view.valuation.positionCount,
          })}
        </p>
      )}
      {view.facts.data.accounts.map((account) => (
        <section key={account.accountId} className={styles.account}>
          <h3>{account.displayName}</h3>
          {account.positions.length ? (
            <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t("table")}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("security")}</th>
                    <th>{t("value")}</th>
                    <th>{t("weight")}</th>
                    <th>{t("quantity")}</th>
                    <th>{t("quote")}</th>
                    <th>{t("unitCost")}</th>
                    {onEdit && (
                      <th>
                        <span className="sr-only">{t("edit")}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {account.positions.map((p) => {
                    const row = rows.get(JSON.stringify([account.accountId, p.assetId])),
                      quote = quoteMap.get(instrumentKey(p.instrument));
                    return (
                      <tr key={p.assetId}>
                        <td>
                          <strong>{p.instrument.symbol ?? "—"}</strong>
                          <small>{p.name}</small>
                        </td>
                        <td className={styles.number}>
                          <strong>
                            {view.currency ? money(row?.value ?? null, view.currency) : "—"}
                          </strong>
                          {row && row.status !== "valued" && <small>{t(row.status)}</small>}
                        </td>
                        <td className={styles.number}>{weightLabel(row?.weightPercent)}</td>
                        <td className={styles.number}>{decimalLabel(p.quantity)}</td>
                        <td className={styles.number}>
                          {unitMoney(quote?.price ?? null, p.instrument.currency)}
                          {quote?.status === "stale" && <small>{t("oldQuote")}</small>}
                        </td>
                        <td
                          className={styles.number}
                          aria-label={p.unitCost === null ? t("unknown") : undefined}
                        >
                          {unitMoney(p.unitCost?.amount ?? null, p.instrument.currency)}
                        </td>
                        {onEdit && (
                          <td>
                            <button
                              type="button"
                              className={styles.edit}
                              aria-label={t("editPosition", {
                                symbol: p.instrument.symbol ?? p.name ?? "—",
                              })}
                              onClick={() => onEdit(account.accountId, p.assetId)}
                            >
                              {t("edit")}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.note}>{t("emptyAccount")}</p>
          )}
        </section>
      ))}
      {cash.length > 0 && (
        <div className={styles.cash}>
          <span>{t("cash")}</span>
          {cash.map((c) => (
            <strong key={c.currency}>
              {c.amount === null ? `${c.currency} —` : money(c.amount, c.currency)}
              {!c.complete && c.amount !== null && <small>{t("partialCash")}</small>}
            </strong>
          ))}
          <small>{t("cashExcluded")}</small>
        </div>
      )}
      <details className={styles.details}>
        <summary>{t("dataDetails")}</summary>
        <dl>
          <div>
            <dt>{t("holdingsUpdated")}</dt>
            <dd>{formatHoldingsTime(view.facts.fetchedAt, locale)}</dd>
          </div>
          <div>
            <dt>{t("quoteTimes")}</dt>
            <dd>
              {times.length
                ? `${formatHoldingsTime(times[0], locale)}${times[0] !== times.at(-1) ? ` – ${formatHoldingsTime(times.at(-1)!, locale)}` : ""}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>{t("fxDate")}</dt>
            <dd>{fxDate ?? "—"}</dd>
          </div>
        </dl>
        <p>{t("costHelp")}</p>
        <p>{t("quoteSource")}</p>
        {cash.length > 0 && <p>{t("cashHelp")}</p>}
        {fxDate && (
          <p>
            <a
              href="https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/"
              target="_blank"
              rel="noreferrer"
            >
              {t("fxSource")}
            </a>
          </p>
        )}
        {view.facts.data.excludedAssets.length > 0 && (
          <p>{t("excluded", { count: view.facts.data.excludedAssets.length })}</p>
        )}
      </details>
      {chart === identity && view.valuation && (
        <HoldingsAllocation
          facts={view.facts}
          valuation={view.valuation}
          identity={identity}
          onClose={() => setChart(null)}
        />
      )}
    </div>
  );
}
