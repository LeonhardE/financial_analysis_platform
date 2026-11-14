// Independent native decimal-string formatting; no network or private data.
import { readFileSync } from "node:fs";
const { currencies, values } = JSON.parse(readFileSync(0, "utf8"));
const rows = currencies.flatMap((currency) => {
  const formatter = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    useGrouping: false,
    roundingMode: "halfEven",
    signDisplay: "negative",
  });
  if (formatter.resolvedOptions().roundingMode !== "halfEven")
    throw Error("Rounding mode unsupported");
  return values.map((value) => ({
    currency,
    value,
    digits: formatter.resolvedOptions().maximumFractionDigits,
    rounded: formatter
      .formatToParts(value)
      .filter((p) => ["integer", "fraction", "decimal", "minusSign"].includes(p.type))
      .map((p) => p.value)
      .join(""),
  }));
});
process.stdout.write(JSON.stringify(rows));
