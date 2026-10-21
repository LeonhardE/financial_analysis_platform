"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type Time,
} from "lightweight-charts";

type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export function CandlestickChart({ data }: { data: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8190a5",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(121, 139, 165, 0.08)" },
        horzLines: { color: "rgba(121, 139, 165, 0.08)" },
      },
      rightPriceScale: { borderColor: "rgba(121, 139, 165, 0.16)" },
      timeScale: {
        borderColor: "rgba(121, 139, 165, 0.16)",
        timeVisible: false,
        rightOffset: 2,
        barSpacing: 20,
      },
      crosshair: {
        vertLine: { color: "rgba(128, 145, 170, 0.45)", labelBackgroundColor: "#243044" },
        horzLine: { color: "rgba(128, 145, 170, 0.45)", labelBackgroundColor: "#243044" },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#2dd4a8",
      downColor: "#f06476",
      borderVisible: false,
      wickUpColor: "#2dd4a8",
      wickDownColor: "#f06476",
      priceLineVisible: true,
      priceLineColor: "rgba(101, 120, 255, 0.55)",
    });

    series.setData(
      data.map((candle) => ({
        time: candle.time as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })) as CandlestickData<Time>[],
    );
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [data]);

  return (
    <div className="chart-container" ref={containerRef} aria-label="One month candlestick chart" />
  );
}
