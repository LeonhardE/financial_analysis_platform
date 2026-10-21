"use client";

import { useEffect, useMemo, useState } from "react";
import { CandlestickChart } from "@/components/CandlestickChart";
import { AccountControls } from "@/components/AccountControls";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type StockSummary = {
  symbol: string;
  name: string;
  latestClose: number;
  changePercent: number;
};

type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type CandleResponse = {
  symbol: string;
  name: string;
  currency: string;
  range: string;
  isMock: boolean;
  candles: Candle[];
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export default function Dashboard() {
  const [stocks, setStocks] = useState<StockSummary[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [marketData, setMarketData] = useState<CandleResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStocks() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/stocks`);
        if (!response.ok) throw new Error("Could not load the market overview");
        const data = (await response.json()) as { stocks: StockSummary[] };
        setStocks(data.stocks);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Unexpected error");
      }
    }

    void loadStocks();
  }, []);

  useEffect(() => {
    async function loadCandles() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${API_BASE_URL}/api/stocks/${selectedSymbol}/candles`);
        if (!response.ok) throw new Error(`Could not load ${selectedSymbol} market data`);
        setMarketData((await response.json()) as CandleResponse);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Unexpected error");
      } finally {
        setLoading(false);
      }
    }

    void loadCandles();
  }, [selectedSymbol]);

  const selectedStock = useMemo(
    () => stocks.find((stock) => stock.symbol === selectedSymbol),
    [selectedSymbol, stocks],
  );

  const latestCandle = marketData?.candles.at(-1);
  const previousCandle = marketData?.candles.at(-2);
  const dailyChange =
    latestCandle && previousCandle ? latestCandle.close - previousCandle.close : 0;
  const dailyChangePercent = previousCandle ? (dailyChange / previousCandle.close) * 100 : 0;

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
          <div className="market-state">
            <span /> US market · mock session
          </div>
          <AccountControls />
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">MARKET OVERVIEW / US EQUITIES</p>
          <h1>Magnificent Seven</h1>
          <p>One month of fixed local data for the first product prototype.</p>
        </div>
        <div className="mock-badge">Mock data · Not investment advice</div>
      </section>

      <section className="workspace">
        <aside className="watchlist" aria-label="Public market overview">
          <div className="panel-heading">
            <h2>Market overview</h2>
            <span>{stocks.length || 7} assets</span>
          </div>
          <div className="stock-list">
            {stocks.map((stock) => (
              <button
                className={`stock-row ${stock.symbol === selectedSymbol ? "active" : ""}`}
                key={stock.symbol}
                onClick={() => setSelectedSymbol(stock.symbol)}
                type="button"
              >
                <span className="symbol-block">
                  <strong>{stock.symbol}</strong>
                  <small>{stock.name}</small>
                </span>
                <span className="quote-block">
                  <strong>{money.format(stock.latestClose)}</strong>
                  <small className={stock.changePercent >= 0 ? "positive" : "negative"}>
                    {stock.changePercent >= 0 ? "+" : ""}
                    {stock.changePercent.toFixed(2)}%
                  </small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <article className="chart-panel">
          <div className="chart-header">
            <div>
              <div className="instrument-title">
                <span className="ticker">{selectedSymbol}</span>
                <span>{marketData?.name ?? selectedStock?.name ?? "Loading"}</span>
              </div>
              <div className="price-line">
                <strong>{latestCandle ? money.format(latestCandle.close) : "—"}</strong>
                {latestCandle && (
                  <span className={dailyChange >= 0 ? "positive" : "negative"}>
                    {dailyChange >= 0 ? "+" : ""}
                    {dailyChange.toFixed(2)} ({dailyChangePercent >= 0 ? "+" : ""}
                    {dailyChangePercent.toFixed(2)}%)
                  </span>
                )}
              </div>
            </div>
            <div className="range-switch" aria-label="Selected time range">
              <span>1M</span>
            </div>
          </div>

          <div className="ohlc-strip">
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

          <div className="chart-stage">
            {loading && <div className="state-message">Loading local market data…</div>}
            {!loading && error && (
              <div className="state-message error">{error}. Please try again shortly.</div>
            )}
            {!loading && !error && marketData && <CandlestickChart data={marketData.candles} />}
          </div>

          <footer className="chart-footer">
            <span>USD · Daily candles</span>
            <span>Last mock date: {latestCandle?.time ?? "—"}</span>
          </footer>
        </article>
      </section>
    </main>
  );
}
