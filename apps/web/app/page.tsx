"use client";

import { useRef, useState } from "react";
import { CandlestickChart } from "@/components/CandlestickChart";
import { AccountControls } from "@/components/AccountControls";
import { useMarketResource } from "@/components/useMarketResource";
import { PersonalWatchlist, WatchlistAction } from "@/components/PersonalWatchlist";
import { useWatchlist } from "@/components/useWatchlist";
import {
  DEFAULT_INSTRUMENTS,
  formatChange,
  formatFetchedAt,
  formatPrice,
  type CandleResponse,
  type Instrument,
  type MarketOverview,
  type SearchResponse,
  type StockSummary,
} from "@/lib/market-data";

function changeClass(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "" : value >= 0 ? "positive" : "negative";
}

export default function Dashboard() {
  const [selected, setSelected] = useState<Instrument>(DEFAULT_INSTRUMENTS[3]);
  const [query, setQuery] = useState("");
  const [overviewReload, setOverviewReload] = useState(0);
  const [chartReload, setChartReload] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const watchlist = useWatchlist();
  const overview = useMarketResource<MarketOverview>("/api/stocks", overviewReload);
  // The first overview request warms the shared default-instrument cache before chart loading.
  // A settled failure also opens the chart, and later overview refreshes leave it independent.
  const chart = useMarketResource<CandleResponse>(
    overview.hasSettled ? `/api/stocks/${encodeURIComponent(selected.symbol)}/candles` : null,
    chartReload,
  );
  const chartLoading = !overview.hasSettled || chart.loading;
  const searchQuery = query.trim();
  const search = useMarketResource<SearchResponse>(
    searchQuery.length >= 2 ? `/api/stocks/search?q=${encodeURIComponent(searchQuery)}` : null,
    0,
    400,
  );
  const marketData = chart.data?.symbol === selected.symbol ? chart.data : null;
  const stocks = DEFAULT_INSTRUMENTS.map((instrument) => {
    const quote = overview.data?.stocks.find((stock) => stock.symbol === instrument.symbol);
    return { ...instrument, ...quote };
  });
  const latestCandle = marketData?.candles.at(-1);
  const previousCandle = marketData?.candles.at(-2);
  const dailyChange =
    latestCandle && previousCandle ? latestCandle.close - previousCandle.close : null;
  const dailyChangePercent =
    dailyChange != null && previousCandle && previousCandle.close > 0
      ? (dailyChange / previousCandle.close) * 100
      : null;

  function selectInstrument(instrument: Instrument) {
    setSelected(instrument);
    setQuery("");
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
          {stock.dataDate && <small className="quote-date">{stock.dataDate}</small>}
        </span>
      </>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            F
          </span>
          <div>
            <strong>Financial Analysis</strong>
            <span>Market watch</span>
          </div>
        </div>
        <div className="topbar-actions">
          <div className={`market-state ${overview.data?.isMock ? "mock-state" : ""}`}>
            <span /> {overview.data?.isMock ? "Mock data" : "Daily market data"}
          </div>
          <AccountControls />
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">MARKET OVERVIEW / UNITED STATES</p>
          <h1>The market, at a glance.</h1>
          <p>Three major indices. The Magnificent Seven. Daily charts, open to everyone.</p>
        </div>
        <div className={`data-badge ${overview.data?.isMock ? "mock-badge" : ""}`}>
          {overview.data?.isMock
            ? "Mock data · Simulated prices"
            : overview.data
              ? "Yahoo Finance · Daily data"
              : "Daily prices · Latest available"}
        </div>
      </section>

      <section className="discovery" aria-label="Public stock search">
        <div className="search-heading">
          <label htmlFor="stock-search">Find a US stock</label>
          <span>No sign-in needed</span>
        </div>
        <div className="search-field">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </svg>
          <input
            id="stock-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={50}
            placeholder="Search a symbol or company, e.g. NFLX or Netflix"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            aria-describedby="search-status"
            ref={searchInput}
          />
        </div>
        <div id="search-status" className="search-status" role="status" aria-live="polite">
          {searchQuery.length === 1 && "Enter at least 2 characters to search."}
          {searchQuery.length >= 2 && search.loading && "Searching stocks…"}
          {searchQuery.length >= 2 && search.error && search.error}
          {searchQuery.length >= 2 && search.data && !search.data.stocks.length && (
            <span>No matching US stocks. Try a symbol such as AAPL or NFLX.</span>
          )}
          {search.data?.warning}
        </div>
        {searchQuery.length >= 2 && Boolean(search.data?.stocks.length) && (
          <ul className="search-results" aria-label="Stock search results">
            {search.data?.stocks.slice(0, 10).map((instrument) => (
              <li key={instrument.symbol}>
                <button
                  type="button"
                  onClick={() => {
                    selectInstrument(instrument);
                    searchInput.current?.focus();
                  }}
                >
                  <strong>{instrument.symbol}</strong>
                  <span>{instrument.name}</span>
                  <small>
                    {instrument.instrumentType === "index" ? "Index" : instrument.currency}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="index-section" aria-labelledby="indices-title">
        <div className="overview-heading">
          <h2 id="indices-title">US market indices</h2>
          <button
            className="text-button"
            type="button"
            disabled={overview.loading}
            onClick={() => setOverviewReload((value) => value + 1)}
          >
            {overview.loading ? "Updating…" : "Refresh overview"}
          </button>
        </div>
        <div className="index-grid">
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
                {renderQuote(stock)}
              </button>
            ))}
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
      </section>

      <section className="workspace">
        <div className="market-sidebar">
          <PersonalWatchlist
            watchlist={watchlist}
            selectedSymbol={selected.symbol}
            onSelect={selectInstrument}
          />
          <aside className="watchlist" aria-label="Public Magnificent Seven market overview">
            <div className="panel-heading">
              <h2>Magnificent Seven</h2>
              <span>7 stocks</span>
            </div>
            <div className="stock-list">
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
            </div>
            <p className="overview-footnote">Daily prices · Dates shown per instrument</p>
          </aside>
        </div>

        <article className="chart-panel" aria-label={`${selected.symbol} stock details`}>
          <div className="chart-header">
            <div>
              <div className="instrument-title">
                <span className="ticker">{selected.symbol}</span>
                <span>{marketData?.name ?? selected.name}</span>
              </div>
              <div className="price-line" aria-live="polite">
                <strong>{formatPrice(latestCandle?.close, selected)}</strong>
                {dailyChange != null && (
                  <span className={changeClass(dailyChange)}>
                    {dailyChange >= 0 ? "+" : ""}
                    {dailyChange.toFixed(2)} ({formatChange(dailyChangePercent)})
                  </span>
                )}
              </div>
            </div>
            <div className="chart-actions">
              <WatchlistAction watchlist={watchlist} instrument={selected} />
              <div className="range-switch" aria-label="Selected time range: one month">
                <span>1M</span>
              </div>
            </div>
          </div>

          <div className="ohlc-strip" aria-label="Latest daily candle">
            <span>
              O <b>{latestCandle?.open.toFixed(2) ?? "—"}</b>
            </span>
            <span>
              H <b>{latestCandle?.high.toFixed(2) ?? "—"}</b>
            </span>
            <span>
              L <b>{latestCandle?.low.toFixed(2) ?? "—"}</b>
            </span>
            <span>
              C <b>{latestCandle?.close.toFixed(2) ?? "—"}</b>
            </span>
          </div>

          <div className="chart-stage" aria-busy={chartLoading}>
            {chartLoading && (
              <div className="state-message" role="status">
                Loading daily market data…
              </div>
            )}
            {!chartLoading && chart.error && (
              <div className="state-message error" role="status">
                <p>{chart.error}</p>
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
                <CandlestickChart data={marketData.candles} />
              ) : (
                <div className="state-message" role="status">
                  No daily candles are available for this symbol.
                </div>
              ))}
          </div>

          {marketData && (
            <div className="data-notes" role="status">
              <span className={marketData.isMock ? "mock-note" : ""}>
                {marketData.isMock
                  ? "Simulated prices · Mock data"
                  : "Yahoo Finance · Daily candles"}
              </span>
              {marketData.isStale && (
                <span className="cached-note">Cached data · Update unavailable</span>
              )}
              {marketData.isPartial && (
                <span className="partial-note">Latest daily candle is still in progress</span>
              )}
              {marketData.adjustment === "split_and_dividend_adjusted" && (
                <span>Adjusted for splits and dividends</span>
              )}
              {marketData.warning && <span className="market-warning">{marketData.warning}</span>}
            </div>
          )}
          <footer className="chart-footer">
            <span>
              {selected.instrumentType === "index" ? "Index points" : selected.currency} · Daily
              candles
            </span>
            <span>Data date: {marketData?.dataDate ?? "—"}</span>
            <span>Fetched: {formatFetchedAt(marketData?.fetchedAt)}</span>
          </footer>
        </article>
      </section>
    </main>
  );
}
