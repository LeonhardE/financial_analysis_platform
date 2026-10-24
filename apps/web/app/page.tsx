"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePreferences } from "@/components/PreferencesProvider";
import SettingsPanel from "@/components/SettingsPanel";
import { localizeMessage } from "@/lib/ui-messages";
import { CandlestickChart } from "@/components/CandlestickChart";
import { InstrumentMetrics } from "@/components/InstrumentMetrics";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { useCachedMarketResource } from "@/components/useCachedMarketResource";
import { useMarketResource } from "@/components/useMarketResource";
import { PersonalWatchlist, WatchlistAction } from "@/components/PersonalWatchlist";
import { useWatchlist } from "@/components/useWatchlist";
import { useWatchlistQuotes } from "@/components/useWatchlistQuotes";
import { WatchlistNotification } from "@/components/WatchlistNotification";
import {
  CHART_RANGES,
  DEFAULT_INSTRUMENTS,
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
  const t = useTranslations();
  const locale = useLocale();
  const { preferences, resolvedTheme } = usePreferences();
  const [selected, setSelected] = useState<Instrument>(DEFAULT_INSTRUMENTS[3]);
  const [range, setRange] = useState<ChartRange>("1m");
  const [query, setQuery] = useState("");
  const [pickerTab, setPickerTab] = useState<"markets" | "watchlist">("markets");
  const [overviewReload, setOverviewReload] = useState(0);
  const [chartReload, setChartReload] = useState(0);
  const [activeView, setActiveView] = useState<"markets" | "settings">("markets");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [desktopPickerVisible, setDesktopPickerVisible] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1200px)");
    const sync = () => setDesktopPickerVisible(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const rangeTouched = useRef(false);
  useEffect(() => {
    if (!rangeTouched.current) setRange(preferences.defaultChartRange);
  }, [preferences.defaultChartRange]);
  const message = (value: string | null | undefined) => localizeMessage(value, t, locale);
  const pickerDialog = useRef<HTMLDialogElement>(null);
  const chartHeading = useRef<HTMLHeadingElement>(null);
  const watchlist = useWatchlist();
  const overview = useCachedMarketResource<MarketOverview>("/api/stocks", overviewReload);
  const sharesOverviewRefresh =
    range === "1m" &&
    DEFAULT_INSTRUMENTS.some((instrument) => instrument.symbol === selected.symbol);
  // Probe both caches immediately. Only the overlapping upstream download waits.
  const chart = useCachedMarketResource<CandleResponse>(
    `/api/stocks/${encodeURIComponent(selected.symbol)}/candles?range=${range}`,
    chartReload,
    !sharesOverviewRefresh || overview.hasSettled,
  );
  const chartLoading = chart.loading;
  const searchQuery = query.trim();
  const search = useMarketResource<SearchResponse>(
    searchQuery.length >= 2 ? `/api/stocks/search?q=${encodeURIComponent(searchQuery)}` : null,
    0,
    400,
  );
  const marketData =
    chart.data?.symbol === selected.symbol && chart.data.range === range ? chart.data : null;
  const watchlistQuotes = useWatchlistQuotes({
    items: watchlist.items,
    overview: overview.data,
    selectedQuote: marketData,
    active:
      activeView === "markets" &&
      pickerTab === "watchlist" &&
      !searchQuery &&
      watchlist.authenticated &&
      (desktopPickerVisible || pickerOpen),
    owner: watchlist.authenticated ? watchlist.sessionKey : null,
    refreshKey: overviewReload,
    selectedInstrument: selected,
    selectedRange: range,
    selectedActive: activeView === "markets",
    selectedChartSettled: chart.hasSettled,
    overviewPending: overview.loading || overview.refreshing,
  });
  const selectedQuote = watchlistQuotes.quotes[selected.symbol];
  const stocks = DEFAULT_INSTRUMENTS.map((instrument) => {
    const quote = watchlistQuotes.quotes[instrument.symbol];
    return { ...instrument, ...quote };
  });
  const interval = marketData?.interval ?? (range === "1d" ? "5m" : range === "1w" ? "30m" : "1d");

  function refreshMarket() {
    setOverviewReload((value) => value + 1);
    setChartReload((value) => value + 1);
  }

  function selectInstrument(instrument: Instrument) {
    setSelected(instrument);
    setQuery("");
    pickerDialog.current?.close();
    setPickerOpen(false);
    // Mobile selection returns to the detail itself, including picks from the index strip.
    if (window.matchMedia("(max-width: 1199px)").matches) {
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
          <strong>{formatPrice(stock.latestClose, stock, locale)}</strong>
          <small className={changeClass(stock.changePercent)}>
            {formatChange(stock.changePercent, locale)}
            {stock.isStale && <span className="quote-stale"> · {t("market.cached")}</span>}
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
            <p className="eyebrow">{t("market.radar")}</p>
            <h2>{t("market.symbols")}</h2>
          </div>
          <span className="small-tag">US</span>
        </div>
        <div className="discovery">
          <label className="sr-only" htmlFor={`${id}-search`}>
            {t("market.find")}
          </label>
          <div className="search-field">
            <SearchIcon />
            <input
              id={`${id}-search`}
              type="search"
              autoComplete="off"
              spellCheck={false}
              maxLength={50}
              placeholder={t("market.placeholder")}
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
            {searchQuery.length === 1 && t("market.minimum")}
            {searchQuery.length >= 2 && search.loading && t("market.searching")}
            {searchQuery.length >= 2 && search.error && message(search.error)}
            {searchQuery.length >= 2 &&
              search.data &&
              !search.data.stocks.length &&
              t("market.emptySearch")}
            {searchQuery.length >= 2 && message(search.data?.warning)}
          </div>
        </div>
        {searchQuery.length >= 2 ? (
          <ul className="search-results" aria-label={t("market.searchResults")}>
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
            <div className="picker-tabs" aria-label={t("market.lists")}>
              <button
                type="button"
                aria-pressed={pickerTab === "markets"}
                onClick={() => setPickerTab("markets")}
              >
                {t("market.markets")}
              </button>
              <button
                type="button"
                aria-pressed={pickerTab === "watchlist"}
                onClick={() => setPickerTab("watchlist")}
              >
                {t("market.watchlist")}
                {watchlist.authenticated && (
                  <span className="tab-count">{watchlist.items.length}</span>
                )}
              </button>
            </div>
            {pickerTab === "markets" ? (
              <section className="market-list" aria-label={t("market.overview")}>
                <div className="list-caption">
                  <span>{t("market.symbolName")}</span>
                  <span>{t("market.lastDay")}</span>
                </div>
                <h3>{t("market.major")}</h3>
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
                <h3>{t("market.seven")}</h3>
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
                quotes={watchlistQuotes.quotes}
                quotesLoading={watchlistQuotes.loading}
                onQuoteVisible={watchlistQuotes.requestQuote}
              />
            )}
          </>
        )}
        <div className="picker-footer">
          <button
            className="text-button"
            type="button"
            disabled={
              overview.loading ||
              overview.refreshing ||
              (pickerTab === "watchlist" && watchlistQuotes.loading)
            }
            onClick={refreshMarket}
          >
            {overview.loading ||
            overview.refreshing ||
            (pickerTab === "watchlist" && watchlistQuotes.loading)
              ? t("market.updating")
              : t("market.refresh")}
          </button>
        </div>
        {overview.error && (
          <p className="overview-notice error" role="status">
            {message(overview.error)}
          </p>
        )}
        {(overview.refreshError || overview.data?.warning) && (
          <p className="overview-notice" role="status">
            {message(overview.refreshError || overview.data?.warning)}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="app-shell">
      {activeView === "markets" && (
        <a className="skip-link" href="#instrument-heading">
          {t("nav.skip")}
        </a>
      )}
      <WorkspaceSidebar activeView={activeView} onNavigate={setActiveView} />
      {!pickerOpen && activeView === "markets" && <WatchlistNotification watchlist={watchlist} />}
      <main className="workspace-content" id="workspace-content">
        {activeView === "settings" && <SettingsPanel />}
        <div className="market-view" hidden={activeView !== "markets"}>
          <section className="index-strip" aria-label={t("market.indices")}>
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
                      ? t("market.spx")
                      : stock.symbol === "IXIC"
                        ? t("market.ixic")
                        : t("market.dji")}
                  </span>
                  <strong>{formatPrice(stock.latestClose, stock, locale)}</strong>
                  <span className={changeClass(stock.changePercent)}>
                    {formatChange(stock.changePercent, locale)}
                  </span>
                  {stock.isStale && <small>{t("market.cached")}</small>}
                </button>
              ))}
          </section>
          <section className="workspace">
            <article
              className="chart-panel"
              aria-label={t("chart.details", { symbol: selected.symbol })}
            >
              <div className="chart-topline">
                <span className="breadcrumb">
                  {t("nav.markets")} <span>/</span> {t("chart.unitedStates")} <span>/</span>{" "}
                  <b>{selected.symbol}</b>
                </span>
                <span className={`data-badge ${overview.data?.isMock ? "mock-badge" : ""}`}>
                  {overview.data?.isMock ? t("chart.simulatedBadge") : t("chart.snapshotBadge")}
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
                        {selected.instrumentType === "index" ? t("chart.index") : t("chart.stock")}
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
                    onClick={() => {
                      pickerDialog.current?.showModal();
                      setPickerOpen(true);
                    }}
                    aria-haspopup="dialog"
                  >
                    <SearchIcon />
                    <span>{t("market.symbols")}</span>
                  </button>
                </div>
              </div>
              {watchlist.authenticated && watchlist.error && (
                <div className="chart-watchlist-feedback" role="status" aria-live="polite">
                  <span className={watchlist.error ? "account-error" : ""}>
                    {message(watchlist.error)}
                  </span>
                  {watchlist.error && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={watchlist.busy}
                      onClick={() => void watchlist.reload()}
                    >
                      {t("watchlist.reload")}
                    </button>
                  )}
                </div>
              )}
              <div className="price-summary" aria-live="polite">
                <div className="price-line">
                  <strong>{formatPrice(selectedQuote?.latestClose, selected, locale)}</strong>
                  <span className={changeClass(selectedQuote?.changePercent)}>
                    {formatChange(selectedQuote?.changePercent, locale)}
                  </span>
                </div>
                <span className="price-caption">
                  {selectedQuote
                    ? `${selectedQuote.dataDate ?? "—"} · ${selected.instrumentType === "index" ? t("chart.indexPoints") : selected.currency}`
                    : t("chart.latest")}
                  <span>{t("chart.dailySnapshot")}</span>
                  <span>{t("chart.previousClose")}</span>
                  {selectedQuote?.isStale && <span>{t("market.cached")}</span>}
                </span>
              </div>
              <div className="chart-toolbar">
                <div className="range-switch" aria-label={t("chart.timeRange")}>
                  {CHART_RANGES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={range === value}
                      title={t(`ranges.${value}`)}
                      onClick={() => {
                        rangeTouched.current = true;
                        setRange(value);
                      }}
                    >
                      {value.toUpperCase()}
                    </button>
                  ))}
                </div>
                <span className="interval-label">
                  {t(
                    interval === "5m"
                      ? "chart.fiveMinute"
                      : interval === "30m"
                        ? "chart.thirtyMinute"
                        : "chart.daily",
                  )}
                </span>
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
                    <p>{t("chart.loading")}</p>
                    <small>
                      {selected.symbol} · {t(`ranges.${range}`)}
                    </small>
                  </div>
                )}
                {!chartLoading && chart.error && (
                  <div className="state-message error" role="status">
                    <p>{message(chart.error)}</p>
                    <button
                      className="account-button secondary"
                      type="button"
                      onClick={refreshMarket}
                    >
                      {t("chart.retry")}
                    </button>
                  </div>
                )}
                {!chartLoading && !chart.error && chart.data && !marketData && (
                  <div className="state-message" role="status">
                    <p>{t("chart.rangeUnavailable")}</p>
                    <button className="text-button" type="button" onClick={refreshMarket}>
                      {t("chart.retry")}
                    </button>
                  </div>
                )}
                {!chartLoading &&
                  !chart.error &&
                  marketData &&
                  (marketData.candles.length ? (
                    <CandlestickChart
                      data={marketData.candles}
                      quote={selectedQuote ?? null}
                      range={range}
                      interval={interval}
                      theme={resolvedTheme}
                      locale={locale}
                    />
                  ) : (
                    <div className="state-message" role="status">
                      {t("chart.empty")}
                    </div>
                  ))}
              </div>
              <InstrumentMetrics instrument={selected} candleData={marketData} />
              <div className="data-status" role="status">
                <span className="status-dot" />
                <span>{marketData?.isMock ? t("chart.simulated") : t("chart.source")}</span>
                {chart.refreshing && <span>{t("market.updating")}</span>}
                {marketData?.isStale && (
                  <span className="cached-note">
                    {t(chart.refreshing ? "market.cached" : "chart.cached")}
                  </span>
                )}
                {marketData?.isPartial && (
                  <span className="partial-note">{t("chart.partial")}</span>
                )}
              </div>
              {chart.refreshError && marketData && (
                <p className="market-warning" role="status">
                  {message(chart.refreshError)}{" "}
                  <button className="text-button" type="button" onClick={refreshMarket}>
                    {t("chart.retry")}
                  </button>
                </p>
              )}
              <details className="data-details">
                <summary>
                  {t("chart.about")}
                  <span>{t("chart.sourceTiming")}</span>
                </summary>
                <div>
                  <p>
                    {t(`ranges.${range}`)} ·{" "}
                    {t(
                      interval === "5m"
                        ? "chart.fiveMinute"
                        : interval === "30m"
                          ? "chart.thirtyMinute"
                          : "chart.daily",
                    )}
                    {interval !== "1d" && ` · ${t("chart.regularSession")}`}
                  </p>
                  <p>{t("chart.snapshotPolicy")}</p>
                  <p>
                    {t("chart.fetched", {
                      time: formatFetchedAt(marketData?.fetchedAt, locale),
                      date: marketData?.dataDate ?? "—",
                    })}
                  </p>
                  {marketData?.adjustment === "split_and_dividend_adjusted" && (
                    <p>{t("chart.adjusted")}</p>
                  )}
                  {!chart.refreshError && marketData?.warning && (
                    <p className="market-warning">{message(marketData.warning)}</p>
                  )}
                </div>
              </details>
            </article>
            <aside className="market-sidebar" aria-label={t("market.choose")}>
              {renderPicker("desktop")}
            </aside>
          </section>
        </div>
        {activeView === "markets" && (
          <footer className="workspace-footer">
            <span>
              <strong>FolioView</strong> {t("nav.tagline")}
            </span>
            <span>{t("nav.footer")}</span>
          </footer>
        )}
      </main>
      <dialog
        ref={pickerDialog}
        className="symbol-dialog"
        aria-label={t("market.chooseSymbol")}
        onClose={() => {
          setQuery("");
          setPickerOpen(false);
        }}
      >
        <div className="dialog-topline">
          <span>{t("market.explore")}</span>
          <button
            type="button"
            className="dialog-close"
            aria-label={t("market.closePicker")}
            onClick={() => pickerDialog.current?.close()}
          >
            ×
          </button>
        </div>
        {renderPicker("mobile")}
        {pickerOpen && <WatchlistNotification watchlist={watchlist} />}
      </dialog>
    </div>
  );
}
