import { describe, expect, it } from "vitest";
import { generateStrategyAnnotations } from "./strategyAnnotations";
import type { KisOHLCV } from "./kisApi";

function bar(date: string, open: number, high: number, low: number, close: number, volume = 1_000_000): KisOHLCV {
  return { date, open, high, low, close, volume, amount: close * volume };
}

describe("strategy chart annotations", () => {
  it("creates BUY markers and ABC pattern points when ABC breakout appears", () => {
    const ohlcv: KisOHLCV[] = [
      ...Array.from({ length: 20 }, (_, i) => bar(`202403${String(i + 1).padStart(2, "0")}`, 50_000, 51_000, 49_000, 50_000)),
      bar("20240321", 50_000, 51_000, 45_000, 46_000),
      bar("20240322", 46_000, 56_000, 45_500, 55_000),
      bar("20240323", 55_000, 55_500, 49_000, 50_500),
      bar("20240324", 50_500, 58_000, 50_000, 57_000),
    ];

    const annotations = generateStrategyAnnotations(ohlcv, { strategyIds: ["abc_trading"] });

    expect(annotations.signals).toContainEqual(expect.objectContaining({
      strategyId: "abc_trading",
      strategyName: "ABC 매매",
      signal: "BUY",
      date: "20240324",
    }));
    expect(annotations.patterns).toContainEqual(expect.objectContaining({
      strategyId: "abc_trading",
      kind: "zigzag",
      label: "ABC 패턴",
      points: [
        { date: "20240321", value: 45_000 },
        { date: "20240322", value: 56_000 },
        { date: "20240323", value: 49_000 },
        { date: "20240324", value: 57_000 },
      ],
    }));
  });

  it("creates channel pattern boundaries when channel breakout appears", () => {
    const ohlcv: KisOHLCV[] = [
      ...Array.from({ length: 20 }, (_, i) => bar(
        `202405${String(i + 1).padStart(2, "0")}`,
        50_000 + i * 100,
        52_000 + i * 100,
        48_000 + i * 100,
        50_000 + i * 100,
      )),
      bar("20240521", 52_000, 56_000, 51_000, 55_500, 1_500_000),
    ];

    const annotations = generateStrategyAnnotations(ohlcv, { strategyIds: ["channel_trading"] });

    expect(annotations.signals.some((signal) => signal.strategyId === "channel_trading" && signal.signal === "BUY")).toBe(true);
    expect(annotations.patterns).toContainEqual(expect.objectContaining({
      strategyId: "channel_trading",
      kind: "channel",
      label: "채널 상단/하단",
    }));
  });
});
