import { describe, expect, it } from "vitest";
import type { KisOHLCV } from "./kisApi";
import {
  applyUniverseExclusions,
  evaluateTradingStrategiesForUniverse,
  normalizeUniverseStock,
} from "./universeScreener";

const bars = (closes: number[]): KisOHLCV[] => closes.map((close, index) => ({
  date: `202605${String(index + 1).padStart(2, "0")}`,
  open: close,
  high: close * 1.02,
  low: close * 0.98,
  close,
  volume: 200_000,
  amount: close * 200_000,
}));

describe("whole-market universe screener", () => {
  it("normalizes KRX stocks into tradable universe rows", () => {
    expect(normalizeUniverseStock({ code: "5930", name: " 삼성전자 ", market: "유가" })).toEqual({
      code: "005930",
      name: "삼성전자",
      market: "KOSPI",
    });
    expect(normalizeUniverseStock({ code: "035720", name: "카카오", market: "코스닥" }).market).toBe("KOSDAQ");
  });

  it("excludes low-liquidity, penny, managed, halted, ETF/ETN, preferred, SPAC and REIT stocks before strategy evaluation", () => {
    const rows = [
      { code: "005930", name: "삼성전자", market: "KOSPI", price: 71000, volume: 12_000_000, amount: 852_000_000_000, statusCode: "00" },
      { code: "000001", name: "동전주", market: "KOSPI", price: 950, volume: 5_000_000, amount: 4_750_000_000, statusCode: "00" },
      { code: "000002", name: "저거래량", market: "KOSPI", price: 5000, volume: 9_999, amount: 49_995_000, statusCode: "00" },
      { code: "000003", name: "거래대금부족", market: "KOSPI", price: 1500, volume: 20_000, amount: 29_000_000, statusCode: "00" },
      { code: "000004", name: "관리종목", market: "KOSPI", price: 5000, volume: 100_000, amount: 500_000_000, statusCode: "55" },
      { code: "000005", name: "거래정지", market: "KOSPI", price: 5000, volume: 100_000, amount: 500_000_000, halted: true },
      { code: "000006", name: "테스트스팩", market: "KOSDAQ", price: 2500, volume: 100_000, amount: 250_000_000, statusCode: "00" },
      { code: "000007", name: "우선주우", market: "KOSPI", price: 5000, volume: 100_000, amount: 500_000_000, statusCode: "00" },
      { code: "000008", name: "리츠", market: "KOSPI", price: 5000, volume: 100_000, amount: 500_000_000, statusCode: "00" },
      { code: "000009", name: "KODEX 200", market: "KOSPI", price: 38000, volume: 100_000, amount: 3_800_000_000, statusCode: "00" },
    ];

    const filtered = applyUniverseExclusions(rows, {
      minPrice: 1000,
      minVolume: 10_000,
      minAmount: 50_000_000,
      excludeManaged: true,
      excludeHalted: true,
      excludeEtfEtn: true,
      excludePreferred: true,
      excludeSpac: true,
      excludeReit: true,
    } as never);

    expect(filtered.included.map((row) => row.code)).toEqual(["005930"]);
    expect(filtered.excluded.map((row) => row.excludeReason)).toEqual([
      "동전주 제외",
      "저거래량 제외",
      "거래대금 부족 제외",
      "관리/투자주의 상태 제외",
      "거래정지 제외",
      "스팩 제외",
      "우선주 제외",
      "리츠 제외",
      "ETF/ETN 제외",
    ]);
  });

  it("shows matching stocks grouped by each trading strategy's current BUY conditions", () => {
    const trendUp = bars(Array.from({ length: 40 }, (_, i) => 1000 + i * 20));
    const flat = bars(Array.from({ length: 40 }, () => 1000));
    const strategies = [
      {
        meta: { id: "always_buy", name: "항상 매수", description: "", type: "trading" as const, defaultParams: {}, paramSchema: [] },
        evaluate: () => ({ signal: "BUY" as const, strength: 0.82, reason: "조건 충족" }),
      },
      {
        meta: { id: "always_hold", name: "항상 관망", description: "", type: "trading" as const, defaultParams: {}, paramSchema: [] },
        evaluate: () => ({ signal: "HOLD" as const, strength: 0.2, reason: "조건 미충족" }),
      },
    ];

    const grouped = evaluateTradingStrategiesForUniverse([
      { code: "005930", name: "삼성전자", market: "KOSPI", price: 71000, volume: 1_000_000, amount: 71_000_000_000, ohlcv: trendUp },
      { code: "000660", name: "SK하이닉스", market: "KOSPI", price: 180000, volume: 800_000, amount: 144_000_000_000, ohlcv: flat },
    ], strategies, { maxPerStrategy: 1 });

    expect(grouped).toEqual([
      {
        strategyId: "always_buy",
        strategyName: "항상 매수",
        matches: [{ stockCode: "005930", stockName: "삼성전자", market: "KOSPI", signal: "BUY", strength: 0.82, reason: "조건 충족", priceAtScan: 71000, volume: 1_000_000, amount: 71_000_000_000 }],
      },
      { strategyId: "always_hold", strategyName: "항상 관망", matches: [] },
    ]);
  });
});
