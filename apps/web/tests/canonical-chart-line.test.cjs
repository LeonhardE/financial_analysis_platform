const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const jsxRuntime = require("react/jsx-runtime");
const catalogs = { en: require("../messages/en.json"), zh: require("../messages/zh.json") };

function mount() {
  const cells = [];
  const pending = [];
  const charts = [];
  let index = 0;
  let locale = "en";
  const changed = (before, after) => !before || after.some((item, i) => item !== before[i]);
  const react = {
    useRef(current) {
      const slot = index++;
      cells[slot] ??= { current };
      return cells[slot];
    },
    useEffect(effect, dependencies) {
      const slot = index++;
      if (changed(cells[slot]?.dependencies, dependencies))
        pending.push({ slot, effect, dependencies });
    },
  };
  const module = { exports: {} };
  const filename = path.join(__dirname, "../components/CandlestickChart.tsx");
  const { code } = transformSync(readFileSync(filename, "utf8"), {
    filename,
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "commonjs" },
  });
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "next-intl")
        return {
          useTranslations: () => (key) =>
            key === "chart.dailySnapshot" ? catalogs[locale].chart.dailySnapshot : key,
        };
      if (name === "lightweight-charts")
        return {
          ColorType: { Solid: "solid" },
          LineStyle: { Dashed: 2 },
          TickMarkType: { Time: 1, TimeWithSeconds: 2 },
          CandlestickSeries: "candles",
          createChart() {
            const chart = { bars: [], lines: [], removedLines: [], removed: false };
            charts.push(chart);
            return {
              addSeries(_type, options) {
                chart.options = options;
                return {
                  setData(value) {
                    chart.bars.push(JSON.parse(JSON.stringify(value)));
                  },
                  createPriceLine(options) {
                    const line = { ...options };
                    chart.lines.push(line);
                    return line;
                  },
                  removePriceLine(line) {
                    chart.removedLines.push(line);
                  },
                };
              },
              timeScale: () => ({ fitContent() {} }),
              remove() {
                chart.removed = true;
              },
            };
          },
        };
      throw new Error(`Unexpected import: ${name}`);
    },
    process: { env: {} },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  });
  return {
    charts,
    render(properties) {
      locale = properties.locale;
      index = 0;
      const tree = module.exports.CandlestickChart(properties);
      tree.props.ref.current = {};
      for (const { slot, effect, dependencies } of pending.splice(0)) {
        cells[slot]?.cleanup?.();
        cells[slot] = { dependencies, cleanup: effect() };
      }
      return tree;
    },
  };
}

const candles = [
  { time: "2026-10-23", open: 524, high: 525, low: 523, close: 524.53, volume: 100 },
];
const props = { data: candles, range: "1d", interval: "5m", theme: "dark", locale: "en" };

test("canonical price has a labeled independent line while historical OHLC remains unchanged", () => {
  const app = mount();
  app.render({ ...props, quote: { latestClose: 524.51 } });
  const chart = app.charts[0];
  assert.equal(chart.options.priceLineVisible, false);
  assert.equal(chart.options.lastValueVisible, false);
  assert.equal(chart.lines[0].price, 524.51);
  assert.equal(chart.lines[0].title, "Daily snapshot");
  assert.equal(chart.lines[0].axisLabelVisible, true);
  assert.equal(chart.bars[0][0].close, 524.53);
  assert.equal(candles[0].close, 524.53);
  app.render({ ...props, quote: { latestClose: 525 } });
  assert.equal(app.charts.length, 1);
  assert.equal(chart.bars.length, 1);
  assert.equal(chart.lines.at(-1).price, 525);
  assert.equal(chart.removedLines.length, 1);
  app.render({ ...props, quote: null });
  assert.equal(chart.lines.length, 2);
  assert.equal(chart.removedLines.length, 2);
});

test("daily reference line is localized and absent when a canonical price is unavailable", () => {
  const app = mount();
  app.render({ ...props, locale: "zh", quote: { latestClose: 524.51 } });
  assert.equal(app.charts[0].lines[0].title, "日线快照");
  app.render({ ...props, locale: "zh", quote: { latestClose: NaN } });
  assert.equal(app.charts[0].lines.length, 1);
  assert.equal(app.charts[0].removedLines.length, 1);
  app.render({ ...props, data: [...candles], locale: "en", quote: null });
  assert.equal(app.charts[0].removed, true);
  assert.equal(app.charts[1].lines.length, 0);
  assert.equal(app.charts[1].bars[0][0].close, 524.53);
});
