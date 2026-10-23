"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  CandlestickSeries,
  ColorType,
  TickMarkType,
  createChart,
  type CandlestickData,
  type Time,
} from "lightweight-charts";
import { type Candle, type ChartRange, type CandleResponse } from "@/lib/market-data";

export function CandlestickChart({
  data,
  range,
  interval,
  theme,
  locale,
}: {
  data: Candle[];
  range: ChartRange;
  interval: CandleResponse["interval"];
  theme: "dark" | "light";
  locale: string;
}) {
  const t = useTranslations();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: theme === "light" ? "#59687c" : "#8c99ae",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: theme === "light" ? "#e8edf3" : "rgba(121, 139, 165, 0.07)" },
        horzLines: { color: theme === "light" ? "#e1e7ef" : "rgba(121, 139, 165, 0.1)" },
      },
      rightPriceScale: { borderColor: "rgba(121, 139, 165, 0.16)" },
      timeScale: {
        borderColor: "rgba(121, 139, 165, 0.16)",
        timeVisible: interval !== "1d",
        secondsVisible: false,
        rightOffset: 2,
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          if (typeof time !== "number") return null;
          return new Intl.DateTimeFormat(locale, {
            timeZone: "America/New_York",
            ...(type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds
              ? { hour: "2-digit", minute: "2-digit", hour12: false }
              : { month: "short", day: "numeric" }),
          }).format(new Date(time * 1000));
        },
      },
      localization: {
        locale,
        ...(interval !== "1d"
          ? {
              timeFormatter: (time: Time) =>
                typeof time === "number"
                  ? new Intl.DateTimeFormat(locale, {
                      timeZone: "America/New_York",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(new Date(time * 1000)) + " ET"
                  : String(time),
            }
          : {}),
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
      upColor: "#26a69a",
      downColor: "#ef6976",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef6976",
      priceLineVisible: true,
      priceLineColor: "rgba(114, 158, 232, 0.65)",
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
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => chart.timeScale().fitContent());
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(resizeFrame);
      chart.remove();
    };
  }, [data, interval, theme, locale]);

  return (
    <div
      className="chart-container"
      ref={containerRef}
      role="img"
      aria-label={t("chart.description", {
        range: t(`ranges.${range}`),
        count: data.length,
        close: data.at(-1)?.close.toFixed(2) ?? t("chart.unavailable"),
      })}
    />
  );
}
