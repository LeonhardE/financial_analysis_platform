"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ReportDialog } from "./ReportDialog";
import { InlineError, LoadingIndicator } from "./WorkspaceFeedback";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import { asFacts, inputDecimal, type ConfirmedInstrument } from "@/lib/holdings-facts";
import {
  MARKET_LABELS,
  readInstrumentSearch,
  type InstrumentSearch,
} from "@/lib/instrument-search";
import { PORTFOLIO_CURRENCIES, type PortfolioCurrency } from "@/lib/currency-preferences";
import styles from "./ResourcesPanel.module.css";
const ORIGIN = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function HoldingsEditor({
  model,
  editing,
  onClose,
}: {
  model: HoldingsWorkspace;
  editing: {
    accountId: string | null;
    assetId: string | null;
    snapshotId: string | null;
    scope: string;
  };
  onClose: () => void;
}) {
  const t = useTranslations("holdingsEditor");
  const [facts] = useState(() => (model.content ? asFacts(model.content) : null));
  const newAccount = { accountId: "manual_account", displayName: t("manualAccount") };
  const accounts = facts?.data.accounts.length
    ? facts.data.accounts
    : [{ ...newAccount, positions: [] }];
  const original = facts?.data.accounts
    .find((a) => a.accountId === editing.accountId)
    ?.positions.find((p) => p.assetId === editing.assetId);
  const [accountId, setAccount] = useState(editing.accountId ?? accounts[0].accountId);
  const [ticker, setTicker] = useState(original?.instrument.symbol ?? "");
  const [quantity, setQuantity] = useState(original?.quantity ?? "");
  const [cost, setCost] = useState(original?.unitCost?.amount ?? "");
  const [currency, setCurrency] = useState<PortfolioCurrency>(
    original?.instrument.currency ?? "USD",
  );
  const [selected, setSelected] = useState<ConfirmedInstrument | null>(null);
  const [search, setSearch] = useState<InstrumentSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [removeConfirmed, setRemoveConfirmed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const scope = `${model.owner}:${model.vaultGeneration}:${model.selectedSourceId}`;
  const live = useRef(scope);
  live.current = scope;
  useEffect(() => () => request.current?.abort(), [scope]);
  const choose = (item: ConfirmedInstrument) => {
    setSelected(item);
    setTicker(item.symbol);
    setCurrency(item.currency);
    setError("");
  };
  const lookup = async () => {
    const query = ticker.trim();
    if (!query || query.length > 50) {
      setError("select_instrument");
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const start = scope;
    const active = () =>
      !controller.signal.aborted && request.current === controller && live.current === start;
    setSearching(true);
    setSearch(null);
    setSelected(null);
    setError("");
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await readInstrumentSearch(
        await fetch(`${ORIGIN}/api/valuation/instruments/search`, {
          method: "POST",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        }),
        controller.signal,
      );
      if (!active()) return;
      setSearch(result);
      if (result.status === "available" && result.complete && result.items.length === 1)
        choose(result.items[0]);
      else if (result.status === "missing") setError("search_failed");
    } catch {
      if (request.current === controller && live.current === start) setError("search_failed");
    } finally {
      clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        setSearching(false);
      }
    }
  };
  const unchangedIdentity = Boolean(
    original &&
    ticker.trim().toUpperCase() === original.instrument.symbol &&
    currency === original.instrument.currency,
  );
  const preview = () => {
    setError("");
    try {
      const count = inputDecimal(quantity, 12);
      if (count !== "0" && !selected && !unchangedIdentity) throw { code: "select_instrument" };
      if (selected && currency !== selected.currency) throw { code: "currency_mismatch" };
      if (cost !== "" || !original) inputDecimal(cost);
      if (
        model.stagePositionEdit(
          {
            accountId,
            assetId: editing.assetId,
            instrument: selected,
            quantity: count,
            unitCost: cost,
            removeConfirmed,
          },
          editing.snapshotId,
          !facts?.data.accounts.length ? newAccount : undefined,
          editing.scope,
        )
      )
        onClose();
    } catch (e) {
      setError((e as { code?: string }).code ?? "invalid_number");
    }
  };
  const shownError = error || model.error;
  if (model.phase !== "unlocked" || !model.authenticated) return null;
  return (
    <ReportDialog
      id="holdings-editor"
      open={model.phase === "unlocked"}
      identity={scope}
      title={t(original ? "editTitle" : "addTitle")}
      closeLabel={t("cancel")}
      onClose={onClose}
    >
      <form
        className={styles.positionForm}
        onSubmit={(event) => {
          event.preventDefault();
          preview();
        }}
      >
        {accounts.length > 1 && (
          <label>
            {t("account")}
            <select
              value={accountId}
              disabled={Boolean(original)}
              onChange={(e) => setAccount(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t("ticker")}
          <span className={styles.tickerSearch}>
            <input
              maxLength={50}
              value={ticker}
              autoComplete="off"
              onChange={(e) => {
                request.current?.abort();
                request.current = null;
                setSearching(false);
                setTicker(e.target.value);
                setSelected(null);
                setSearch(null);
              }}
            />
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void lookup()}
              disabled={searching || !ticker.trim()}
            >
              {t("search")}
            </button>
          </span>
        </label>
        <LoadingIndicator busy={searching} label={t("searching")} />
        {search && search.status !== "missing" && !selected && (
          <div className={styles.instrumentChoices}>
            {(!search.complete || search.items.length > 1 || search.status === "stale") && (
              <p>{t(search.status === "stale" ? "staleSearch" : "chooseMarket")}</p>
            )}
            {!search.items.length && search.complete && <p role="status">{t("noInstruments")}</p>}
            {search.items.map((item) => (
              <button
                type="button"
                className={styles.secondary}
                key={`${item.market}:${item.symbol}:${item.currency}`}
                onClick={() => choose(item)}
              >
                <strong>{item.symbol}</strong> · {MARKET_LABELS[item.market]} · {item.currency}
                <small>{item.name}</small>
              </button>
            ))}
          </div>
        )}
        {selected && (
          <p className={styles.selectedInstrument}>
            {selected.name} · {MARKET_LABELS[selected.market]} · {selected.currency}
          </p>
        )}
        <div className={styles.positionNumbers}>
          <label>
            {t("quantity")}
            <input
              inputMode="decimal"
              value={quantity}
              maxLength={40}
              onChange={(e) => {
                setQuantity(e.target.value);
                setRemoveConfirmed(false);
              }}
            />
          </label>
          <label>
            {t("unitCost")}
            <input
              inputMode="decimal"
              value={cost}
              maxLength={40}
              placeholder={original ? t("unknownCost") : ""}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
          <label>
            {t("currency")}
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as PortfolioCurrency)}
            >
              {PORTFOLIO_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        {original && /^0+(?:\.0+)?$/.test(quantity) && (
          <label className={styles.removeConfirmation}>
            <input
              type="checkbox"
              checked={removeConfirmed}
              onChange={(e) => setRemoveConfirmed(e.target.checked)}
            />
            {t("confirmRemoval", { symbol: original.instrument.symbol ?? original.name ?? "—" })}
          </label>
        )}
        {shownError && (
          <InlineError
            message={
              t.has(`errors.${shownError}`) ? t(`errors.${shownError}`) : t("errors.generic")
            }
          />
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            className={styles.primary}
            type="submit"
            disabled={Boolean(model.busy || model.hasPending)}
          >
            {t("preview")}
          </button>
        </div>
      </form>
    </ReportDialog>
  );
}
