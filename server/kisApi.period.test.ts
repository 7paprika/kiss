import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("KIS OHLCV chart periods", () => {
  it("supports minute chart periods through the time item chart endpoint", () => {
    const source = readFileSync(resolve(process.cwd(), "server/kisApi.ts"), "utf8");

    expect(source).toContain('export type KisChartPeriod = "1" | "5" | "15" | "30" | "60" | "D" | "W" | "M"');
    expect(source).toContain("inquire-time-itemchartprice");
    expect(source).toContain("FHKST03010200");
    expect(source).toContain("FID_INPUT_HOUR_1");
    expect(source).toContain("aggregateMinuteBars");
  });
});
