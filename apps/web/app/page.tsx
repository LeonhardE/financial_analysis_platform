"use client";

import { useRef, useState } from "react";
import { CandlestickChart } from "@/components/CandlestickChart";
import { AccountControls } from "@/components/AccountControls";
import { useMarketResource } from "@/components/useMarketResource";
import { PersonalWatchlist, WatchlistAction } from "@/components/PersonalWatchlist";
import { useWatchlist } from "@/components/useWatchlist";
import {
  CHART_RANGES,
  RANGE_LABELS,
  DEFAULT_INSTRUMENTS,
  candleIntervalLabel,
  formatChange,
  formatFetchedAt,
  formatPrice,
  type ChartRange,
  type CandleResponse,
  type Instrument,
  type MarketOverview,
  type SearchResponse,
  type StockSummary,
} from "@/lib/market-data";

function changeClass(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "" : value >= 0 ? "positive" : "negative";
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

export default function Dashboard() {
  const [selected, setSelected] = useState<Instrument>(DEFAULT_INSTRUMENTS[3]);
  const [range, setRange] = useState<ChartRange>("1m");
  const [query, setQuery] = useState("");
  const [pickerTab, setPickerTab] = useState<"markets" | "watchlist">("markets");
  const [overviewReload, setOverviewReload] = useState(0);
  const [chartReload, setChartReload] = useState(0);
  const pickerDialog = useRef<HTMLDialogElement>(null);
  const chartHeading = useRef<HTMLHeadingElement>(null);
  const watchlist = useWatchlist();
  const overview = useMarketResource<MarketOverview>("/api/stocks", overviewReload);
  // Keep the existing cache-warming sequence here; loading performance is a separate change.
  const chart = useMarketResource<CandleResponse>(
    overview.hasSettled
      ? `/api/stocks/${encodeURIComponent(selected.symbol)}/candles?range=${range}`
      : null,
    chartReload,
  );
  const chartLoading = !overview.hasSettled || chart.loading;
  const searchQuery = query.trim();
  const search = useMarketResource<SearchResponse>(
    searchQuery.length >= 2 ? `/api/stocks/search?q=${encodeURIComponent(searchQuery)}` : null,
    0,
    400,
  );
  const marketData =
    chart.data?.symbol === selected.symbol && chart.data.range === range ? chart.data : null;
  const stocks = DEFAULT_INSTRUMENTS.map((instrument) => {
    const quote = overview.data?.stocks.find((stock) => stock.symbol === instrument.symbol);
    return { ...instrument, ...quote };
  });
  const latestCandle = marketData?.candles.at(-1);
  const interval = marketData?.interval ?? (range === "1d" ? "5m" : range === "1w" ? "30m" : "1d");

  function selectInstrument(instrument: Instrument) {
    setSelected(instrument);
    setQuery("");
    pickerDialog.current?.close();
    // Mobile selection returns to the detail itself, including picks from the index strip.
    if (window.matchMedia("(max-width: 899px)").matches) {
      window.requestAnimationFrame(() => {
        chartHeading.current?.focus({ preventScroll: true });
        chartHeading.current?.scrollIntoView({ block: "start", behavior: "instant" });
      });
    }
  }

  function renderQuote(stock: Instrument & Partial<StockSummary>) {
    return (
      <>
        <span className="symbol-block">
          <strong>{stock.symbol}</strong>
          <small>{stock.name}</small>
        </span>
        <span className="quote-block">
          <strong>{formatPrice(stock.latestClose, stock)}</strong>
          <small className={changeClass(stock.changePercent)}>
            {formatChange(stock.changePercent)}
            {stock.isStale && <span className="quote-stale"> · Cached</span>}
          </small>
        </span>
      </>
    );
  }

  function renderPicker(id: string) {
    return (
      <>
        <div className="picker-heading">
          <div>
            <p className="eyebrow">YOUR MARKET RADAR</p>
            <h2>Symbols</h2>
          </div>
          <span className="small-tag">US</span>
        </div>
        <div className="discovery">
          <label className="sr-only" htmlFor={`${id}-search`}>
            Find a US stock
          </label>
          <div className="search-field">
            <SearchIcon />
            <input
              id={`${id}-search`}
              type="search"
              autoComplete="off"
              spellCheck={false}
              maxLength={50}
              placeholder="Symbol or company"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery("");
                }
              }}
              aria-describedby={`${id}-search-status`}
            />
          </div>
          <div
            id={`${id}-search-status`}
            className="search-status"
            role="status"
            aria-live="polite"
          >
            {searchQuery.length === 1 && "Enter at least 2 characters."}
            {searchQuery.length >= 2 && search.loading && "Searching stocks…"}
            {searchQuery.length >= 2 && search.error && search.error}
            {searchQuery.length >= 2 &&
              search.data &&
              !search.data.stocks.length &&
              "No matching US stocks. Try another symbol."}
            {searchQuery.length >= 2 && search.data?.warning}
          </div>
        </div>
        {searchQuery.length >= 2 ? (
          <ul className="search-results" aria-label="Stock search results">
            {search.data?.stocks.slice(0, 10).map((instrument) => (
              <li key={instrument.symbol}>
                <button type="button" onClick={() => selectInstrument(instrument)}>
                  <span className="symbol-block">
                    <strong>{instrument.symbol}</strong>
                    <small>{instrument.name}</small>
                  </span>
                  <span className="result-arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div className="picker-tabs" aria-label="Symbol lists">
              <button
                type="button"
                aria-pressed={pickerTab === "markets"}
                onClick={() => setPickerTab("markets")}
              >
                Markets
              </button>
              <button
                type="button"
                aria-pressed={pickerTab === "watchlist"}
                onClick={() => setPickerTab("watchlist")}
              >
                My watchlist
                {watchlist.authenticated && (
                  <span className="tab-count">{watchlist.items.length}</span>
                )}
              </button>
            </div>
            {pickerTab === "markets" ? (
              <section className="market-list" aria-label="Public market overview">
                <div className="list-caption">
                  <span>Symbol / Name</span>
                  <span>Last / Day %</span>
                </div>
                <h3>MAJOR INDICES</h3>
                {stocks
                  .filter((stock) => stock.instrumentType === "index")
                  .map((stock) => (
                    <button
                      className={`stock-row ${stock.symbol === selected.symbol ? "active" : ""}`}
                      key={stock.symbol}
                      onClick={() => selectInstrument(stock)}
                      type="button"
                      aria-pressed={stock.symbol === selected.symbol}
                    >
                      {renderQuote(stock)}
                    </button>
                  ))}
                <h3>MAGNIFICENT SEVEN</h3>
                {stocks
                  .filter((stock) => stock.instrumentType === "stock")
                  .map((stock) => (
                    <button
                      className={`stock-row ${stock.symbol === selected.symbol ? "active" : ""}`}
                      key={stock.symbol}
                      onClick={() => selectInstrument(stock)}
                      type="button"
                      aria-pressed={stock.symbol === selected.symbol}
                    >
                      {renderQuote(stock)}
                    </button>
                  ))}
              </section>
            ) : (
              <PersonalWatchlist
                watchlist={watchlist}
                selectedSymbol={selected.symbol}
                onSelect={selectInstrument}
                headingId={`${id}-watchlist-title`}
              />
            )}
          </>
        )}
        <div className="picker-footer">
          <span>No sign-in needed to explore</span>
          <button
            className="text-button"
            type="button"
            disabled={overview.loading}
            onClick={() => setOverviewReload((value) => value + 1)}
          >
            {overview.loading ? "Updating…" : "Refresh"}
          </button>
        </div>
        {overview.error && (
          <p className="overview-notice error" role="status">
            {overview.error}
          </p>
        )}
        {overview.data?.warning && (
          <p className="overview-notice" role="status">
            {overview.data.warning}
          </p>
        )}
      </>
    );
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#instrument-heading">
        Skip to chart
      </a>
      <header className="topbar">
        <a className="brand" href="/" aria-label="FolioView home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M7 24V8h18M7 16h13" stroke="currentColor" strokeWidth="3" />
              <path d="m14 25 5-6 4 3 5-8" stroke="currentColor" strokeWidth="2" />
            </svg>
          </span>
          <strong>
            Folio<span>View</span>
          </strong>
        </a>
        <div className="workspace-label">
          <span className="workspace-dot" />
          Markets<span className="workspace-subtitle">Your investing workspace</span>
        </div>
        <AccountControls />
      </header>
      <section className="index-strip" aria-label="US market indices">
        {stocks
          .filter((stock) => stock.instrumentType === "index")
          .map((stock) => (
            <button
              className={`index-card ${stock.symbol === selected.symbol ? "active" : ""}`}
              key={stock.symbol}
              onClick={() => selectInstrument(stock)}
              type="button"
              aria-pressed={stock.symbol === selected.symbol}
            >
              <span className="index-name">
                {stock.symbol === "SPX"
                  ? "S&P 500"
                  : stock.symbol === "IXIC"
                    ? "Nasdaq"
                    : "Dow Jones"}
              </span>
              <strong>{formatPrice(stock.latestClose, stock)}</strong>
              <span className={changeClass(stock.changePercent)}>
                {formatChange(stock.changePercent)}
              </span>
              {stock.isStale && <small>Cached</small>}
            </button>
          ))}
      </section>
      <section className="workspace">
        <article className="chart-panel" aria-label={`${selected.symbol} stock details`}>
          <div className="chart-topline">
            <span className="breadcrumb">
              Markets <span>/</span> United States <span>/</span> <b>{selected.symbol}</b>
            </span>
            <span className={`data-badge ${overview.data?.isMock ? "mock-badge" : ""}`}>
              {overview.data?.isMock ? "SIMULATED DATA" : "MARKET SNAPSHOT"}
            </span>
          </div>
          <div className="chart-header">
            <div className="instrument-identity">
              <span className="instrument-avatar" aria-hidden="true">
                {selected.symbol.slice(0, 1)}
              </span>
              <div>
                <h1 id="instrument-heading" ref={chartHeading} tabIndex={-1}>
                  {selected.symbol}
                  <span className="instrument-kind">
                    {selected.instrumentType === "index" ? "INDEX" : "STOCK"}
                  </span>
                </h1>
                <p>{marketData?.name ?? selected.name}</p>
              </div>
            </div>
            <div className="chart-actions">
              <WatchlistAction watchlist={watchlist} instrument={selected} />
              <button
                type="button"
                className="symbol-picker-button"
                onClick={() => pickerDialog.current?.showModal()}
                aria-haspopup="dialog"
              >
                <SearchIcon />
                <span>Symbols</span>
              </button>
            </div>
          </div>
          {watchlist.authenticated && (watchlist.error || watchlist.message) && (
            <div className="chart-watchlist-feedback" role="status" aria-live="polite">
              <span className={watchlist.error ? "account-error" : ""}>
                {watchlist.error || watchlist.message}
              </span>
              {watchlist.error && (
                <button
                  className="text-button"
                  type="button"
                  disabled={watchlist.busy}
                  onClick={() => void watchlist.reload()}
                >
                  Reload watchlist
                </button>
              )}
            </div>
          )}
          <div className="price-summary" aria-live="polite">
            <div className="price-line">
              <strong>{formatPrice(latestCandle?.close, selected)}</strong>
              <span className={changeClass(marketData?.changePercent)}>
                {formatChange(marketData?.changePercent)}
              </span>
            </div>
            <span className="price-caption">
              {marketData
                ? `${marketData.dataDate} · ${selected.instrumentType === "index" ? "Index points" : selected.currency}`
                : "Latest available price"}
              <span>Change vs. previous close</span>
            </span>
          </div>
          <div className="chart-toolbar">
            <div className="range-switch" aria-label="Chart time range">
              {CHART_RANGES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={range === value}
                  title={RANGE_LABELS[value]}
                  onClick={() => setRange(value)}
                >
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="interval-label">{candleIntervalLabel(interval)}</span>
          </div>
          <div className="chart-stage" aria-busy={chartLoading}>
            {chartLoading && (
              <div className="state-message" role="status">
                <span className="loading-bars" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <p>Loading market data…</p>
                <small>
                  {selected.symbol} · {RANGE_LABELS[range]}
                </small>
              </div>
            )}
            {!chartLoading && chart.error && (
              <div className="state-message error" role="status">
                <p>{chart.error}</p>
                <button
                  className="account-button secondary"
                  type="button"
                  onClick={() => setChartReload((value) => value + 1)}
                >
                  Try again
                </button>
              </div>
            )}
            {!chartLoading && !chart.error && chart.data && !marketData && (
              <div className="state-message" role="status">
                <p>This time range is not available yet. Please try again shortly.</p>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setChartReload((value) => value + 1)}
                >
                  Try again
                </button>
              </div>
            )}
            {!chartLoading &&
              !chart.error &&
              marketData &&
              (marketData.candles.length ? (
                <CandlestickChart data={marketData.candles} range={range} interval={interval} />
              ) : (
                <div className="state-message" role="status">
                  No candles are available for this time range.
                </div>
              ))}
          </div>
          <div className="ohlc-strip" aria-label="Latest candle">
            <span>
              OPEN<b>{latestCandle?.open.toFixed(2) ?? "—"}</b>
            </span>
            <span>
              HIGH<b>{latestCandle?.high.toFixed(2) ?? "—"}</b>
            </span>
            <span>
              LOW<b>{latestCandle?.low.toFixed(2) ?? "—"}</b>
            </span>
            <span>
              CLOSE<b>{latestCandle?.close.toFixed(2) ?? "—"}</b>
            </span>
          </div>
          <div className="data-status" role="status">
            <span className="status-dot" />
            <span>
              {marketData?.isMock
                ? "Simulated prices · Mock data"
                : "Yahoo Finance · Delayed snapshot"}
            </span>
            {marketData?.isStale && (
              <span className="cached-note">Cached data · Update unavailable</span>
            )}
            {marketData?.isPartial && (
              <span className="partial-note">Latest candle was incomplete when fetched</span>
            )}
          </div>
          <details className="data-details">
            <summary>
              About this data<span>Source & timing</span>
            </summary>
            <div>
              <p>
                {RANGE_LABELS[range]} · {candleIntervalLabel(interval)}
                {interval !== "1d" && " · Regular session · Times in New York"}
              </p>
              <p>
                Snapshots are typically refreshed hourly. Prices may be delayed; this is not a live
                trading feed.
              </p>
              <p>
                Fetched: {formatFetchedAt(marketData?.fetchedAt)} · Data date:{" "}
                {marketData?.dataDate ?? "—"}
              </p>
              {marketData?.adjustment === "split_and_dividend_adjusted" && (
                <p>Adjusted for splits and dividends</p>
              )}
              {marketData?.warning && <p className="market-warning">{marketData.warning}</p>}
            </div>
          </details>
        </article>
        <aside className="market-sidebar" aria-label="Choose an instrument">
          {renderPicker("desktop")}
        </aside>
      </section>
      <footer className="workspace-footer">
        <span>
          <strong>FolioView</strong> A clearer view of your investments.
        </span>
        <span>US markets · Public browsing, personal watchlists</span>
      </footer>
      <dialog
        ref={pickerDialog}
        className="symbol-dialog"
        aria-label="Choose a symbol"
        onClose={() => setQuery("")}
      >
        <div className="dialog-topline">
          <span>Explore the market</span>
          <button
            type="button"
            className="dialog-close"
            aria-label="Close symbol picker"
            onClick={() => pickerDialog.current?.close()}
          >
            ×
          </button>
        </div>
        {renderPicker("mobile")}
      </dialog>
    </main>
  );
}
