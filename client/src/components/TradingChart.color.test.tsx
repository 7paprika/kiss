import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("chart color compatibility", () => {
  it("does not pass oklch colors to JavaScript chart libraries or error UI", () => {
    const files = [
      "client/src/components/TradingChart.tsx",
      "client/src/components/BacktestPanel.tsx",
      "client/src/App.tsx",
    ];

    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, file).not.toContain("oklch(");
    }
  });
});
