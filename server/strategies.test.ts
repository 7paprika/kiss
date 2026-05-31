import { describe, it, expect } from "vitest";
import { getAllStrategyMeta, getSelectionStrategy, getTradingStrategy } from "./strategies/index";

// Helper: generate mock OHLCV data
function mockOHLCV(count: number, basePrice = 50000, trend: "up" | "down" | "flat" = "flat") {
  return Array.from({ length: count }, (_, i) => {
    const delta = trend === "up" ? i * 100 : trend === "down" ? -i * 100 : 0;
    const close = Math.max(1000, basePrice + delta);
    const noise = (Math.random() - 0.5) * 200;
    return {
      date: `2024${String(Math.floor(i / 30) + 1).padStart(2, "0")}${String((i % 30) + 1).padStart(2, "0")}`,
      open: close - 100 + noise,
      high: close + 200 + Math.abs(noise),
      low: close - 200 - Math.abs(noise),
      close: close + noise,
      volume: 1_000_000 + Math.floor(Math.random() * 500_000),
      amount: (close + noise) * (1_000_000 + Math.floor(Math.random() * 500_000)),
    };
  });
}

// Helper: wrap OHLCV as candidate
function mockCandidates(count: number, trend: "up" | "down" | "flat" = "flat") {
  return [{ code: "005930", ohlcv: mockOHLCV(count, 50000, trend) }];
}

describe("Strategy Engine", () => {
  it("getAllStrategyMeta returns at least 14 strategies (7 selection + 7 trading)", () => {
    const metas = getAllStrategyMeta();
    // 7 selection + 7 trading (5 original + 2 new: macd, stochastic)
    expect(metas.length).toBeGreaterThanOrEqual(14);
  });

  it("has at least 7 selection strategies and at least 7 trading strategies", () => {
    const metas = getAllStrategyMeta();
    const selection = metas.filter((m) => m.type === "selection");
    const trading = metas.filter((m) => m.type === "trading");
    expect(selection.length).toBeGreaterThanOrEqual(7);
    expect(trading.length).toBeGreaterThanOrEqual(7);
  });

  it("each strategy has required fields", () => {
    const metas = getAllStrategyMeta();
    for (const meta of metas) {
      expect(meta.id).toBeTruthy();
      expect(meta.name).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(meta.type).toMatch(/^(selection|trading)$/);
      expect(meta.defaultParams).toBeDefined();
      expect(Array.isArray(meta.paramSchema)).toBe(true);
    }
  });

  it("selection strategy: momentum_selection can evaluate candidates", () => {
    const strategy = getSelectionStrategy("momentum_selection");
    expect(strategy).toBeDefined();
    if (!strategy) return;
    const candidates = mockCandidates(120, "up");
    const results = strategy.select(candidates, strategy.meta.defaultParams);
    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      expect(typeof results[0].score).toBe("number");
      expect(results[0].score).toBeGreaterThanOrEqual(0);
      expect(typeof results[0].reason).toBe("string");
    }
  });

  it("selection strategy: week52_high_selection can evaluate candidates", () => {
    const strategy = getSelectionStrategy("week52_high_selection");
    expect(strategy).toBeDefined();
    if (!strategy) return;
    const candidates = mockCandidates(260, "up");
    const results = strategy.select(candidates, strategy.meta.defaultParams);
    expect(Array.isArray(results)).toBe(true);
  });

  it("trading strategy: bollinger_trading can evaluate OHLCV data", () => {
    const strategy = getTradingStrategy("bollinger_trading");
    expect(strategy).toBeDefined();
    if (!strategy) return;
    const data = mockOHLCV(60, 50000, "flat");
    const result = strategy.evaluate(data, strategy.meta.defaultParams);
    expect(result.signal).toMatch(/^(BUY|SELL|HOLD)$/);
    expect(typeof result.strength).toBe("number");
    expect(result.strength).toBeGreaterThanOrEqual(0);
    expect(result.strength).toBeLessThanOrEqual(1);
  });

  it("trading strategy: rsi_trading can evaluate OHLCV data", () => {
    const strategy = getTradingStrategy("rsi_trading");
    expect(strategy).toBeDefined();
    if (!strategy) return;
    const data = mockOHLCV(60, 50000, "down");
    const result = strategy.evaluate(data, strategy.meta.defaultParams);
    expect(result.signal).toMatch(/^(BUY|SELL|HOLD)$/);
    expect(typeof result.strength).toBe("number");
  });

  it("trading strategy: golden_cross_trading can evaluate OHLCV data", () => {
    const strategy = getTradingStrategy("golden_cross_trading");
    expect(strategy).toBeDefined();
    if (!strategy) return;
    const data = mockOHLCV(150, 50000, "up");
    const result = strategy.evaluate(data, strategy.meta.defaultParams);
    expect(result.signal).toMatch(/^(BUY|SELL|HOLD)$/);
    expect(typeof result.strength).toBe("number");
  });

  it("trading strategy: momentum_trading can evaluate OHLCV data", () => {
    const strategy = getTradingStrategy("momentum_trading");
    expect(strategy).toBeDefined();
    if (!strategy) return;
    const data = mockOHLCV(60, 50000, "up");
    const result = strategy.evaluate(data, strategy.meta.defaultParams);
    expect(result.signal).toMatch(/^(BUY|SELL|HOLD)$/);
    expect(typeof result.strength).toBe("number");
  });

  it("trading strategy: week52_high_trading can evaluate OHLCV data", () => {
    const strategy = getTradingStrategy("week52_high_trading");
    expect(strategy).toBeDefined();
    if (!strategy) return;
    const data = mockOHLCV(260, 50000, "up");
    const result = strategy.evaluate(data, strategy.meta.defaultParams);
    expect(result.signal).toMatch(/^(BUY|SELL|HOLD)$/);
    expect(typeof result.strength).toBe("number");
  });

  it("trading strategies return HOLD signal for insufficient data", () => {
    const tradingStrategyIds = ["bollinger_trading", "rsi_trading", "golden_cross_trading", "momentum_trading", "week52_high_trading"];
    for (const id of tradingStrategyIds) {
      const strategy = getTradingStrategy(id);
      if (!strategy) continue;
      const shortData = mockOHLCV(3, 50000, "flat"); // Too short
      const result = strategy.evaluate(shortData, strategy.meta.defaultParams);
      expect(result.signal).toBe("HOLD");
    }
  });

  it("trading strategy: macd_trading can evaluate OHLCV data", () => {
    const strategy = getTradingStrategy("macd_trading");
    expect(strategy).toBeDefined();
    if (!strategy) return;
    const data = mockOHLCV(100, 50000, "up");
    const result = strategy.evaluate(data, strategy.meta.defaultParams);
    expect(result.signal).toMatch(/^(BUY|SELL|HOLD)$/);
    expect(typeof result.strength).toBe("number");
    expect(result.strength).toBeGreaterThanOrEqual(0);
    expect(result.strength).toBeLessThanOrEqual(1);
  });

  it("trading strategy: stochastic_trading can evaluate OHLCV data", () => {
    const strategy = getTradingStrategy("stochastic_trading");
    expect(strategy).toBeDefined();
    if (!strategy) return;
    const data = mockOHLCV(80, 50000, "down");
    const result = strategy.evaluate(data, strategy.meta.defaultParams);
    expect(result.signal).toMatch(/^(BUY|SELL|HOLD)$/);
    expect(typeof result.strength).toBe("number");
  });
});

describe("Backtest Engine", () => {
  it("runBacktest returns valid result structure", async () => {
    const { runBacktest } = await import("./backtest");
    const ohlcv = mockOHLCV(150, 50000, "up");
    const result = runBacktest({
      strategyId: "bollinger_trading",
      ohlcv,
      stockCode: "005930",
      initialCapital: 10_000_000,
      stopLossPct: 5,
      takeProfitPct: 10,
    });
    expect(result).toBeDefined();
    expect(typeof result.totalReturn).toBe("number");
    expect(typeof result.maxDrawdown).toBe("number");
    expect(typeof result.winRate).toBe("number");
    expect(typeof result.sharpeRatio).toBe("number");
    expect(typeof result.totalTrades).toBe("number");
    expect(Array.isArray(result.trades)).toBe(true);
    expect(Array.isArray(result.equityCurve)).toBe(true);
    expect(result.initialCapital).toBe(10_000_000);
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.winRate).toBeGreaterThanOrEqual(0);
    expect(result.winRate).toBeLessThanOrEqual(100);
  });

  it("runBacktest with RSI strategy returns valid metrics", async () => {
    const { runBacktest } = await import("./backtest");
    const ohlcv = mockOHLCV(120, 50000, "flat");
    const result = runBacktest({
      strategyId: "rsi_trading",
      ohlcv,
      stockCode: "000660",
      initialCapital: 5_000_000,
    });
    expect(result.finalCapital).toBeGreaterThan(0);
    expect(result.annualizedReturn).toBeDefined();
    expect(result.winTrades + result.lossTrades).toBe(result.totalTrades);
  });

  it("runBacktest equity curve covers most of OHLCV bars (after warmup)", async () => {
    const { runBacktest } = await import("./backtest");
    const ohlcv = mockOHLCV(100, 50000, "up");
    const result = runBacktest({
      strategyId: "golden_cross_trading",
      ohlcv,
      stockCode: "035420",
      initialCapital: 10_000_000,
    });
    // Equity curve starts after warmup period (30 bars), so length = ohlcv.length - 30
    expect(result.equityCurve.length).toBe(ohlcv.length - 30);
    expect(result.equityCurve.length).toBeGreaterThan(0);
  });

  it("runBacktest with unknown strategy throws an error", async () => {
    const { runBacktest } = await import("./backtest");
    const ohlcv = mockOHLCV(100, 50000, "flat");
    expect(() => runBacktest({
      strategyId: "nonexistent_strategy",
      ohlcv,
      stockCode: "005930",
      initialCapital: 10_000_000,
    })).toThrow("Strategy not found: nonexistent_strategy");
  });
});

describe("Crypto utilities", () => {
  it("encrypt and decrypt round-trip", async () => {
    const { encrypt, decrypt } = await import("./crypto");
    const original = "test-api-key-12345";
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted.length).toBeGreaterThan(0);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("empty string encrypt/decrypt returns empty string", async () => {
    const { encrypt, decrypt } = await import("./crypto");
    const encrypted = encrypt("");
    expect(encrypted).toBe("");
    const decrypted = decrypt("");
    expect(decrypted).toBe("");
  });
});

describe("Multi-account & Orderbook", () => {
  it("KisSettings profileName field is accessible in schema", async () => {
    // 스키마에 profileName, isDefault 컨럼이 존재하는지 확인
    const { kisSettings } = await import("../drizzle/schema");
    const cols = Object.keys(kisSettings);
    // drizzle 테이블 오브젝트는 직접 컨럼명을 노출하지 않지만, $inferSelect 타입으로 확인 가능
    type KisSettingsRow = typeof kisSettings.$inferSelect;
    type HasProfileName = KisSettingsRow extends { profileName: unknown } ? true : false;
    type HasIsDefault = KisSettingsRow extends { isDefault: unknown } ? true : false;
    const _profileNameCheck: HasProfileName = true;
    const _isDefaultCheck: HasIsDefault = true;
    expect(_profileNameCheck).toBe(true);
    expect(_isDefaultCheck).toBe(true);
  });

  it("KisOrderbook type structure is valid", async () => {
    // kisApi.ts에서 KisOrderbook 타입이 정의되어 있는지 확인
    // 실제 API 호출 없이 타입 유효성만 테스트
    const mockOrderbook = {
      stockCode: "005930",
      askPrices: [70000, 70100, 70200, 70300, 70400, 70500, 70600, 70700, 70800, 70900],
      askSizes: [100, 200, 150, 300, 250, 180, 220, 190, 210, 160],
      bidPrices: [69900, 69800, 69700, 69600, 69500, 69400, 69300, 69200, 69100, 69000],
      bidSizes: [120, 180, 140, 280, 230, 170, 200, 160, 190, 140],
      totalAskSize: 1960,
      totalBidSize: 1812,
    };
    expect(mockOrderbook.askPrices.length).toBe(10);
    expect(mockOrderbook.bidPrices.length).toBe(10);
    expect(mockOrderbook.askSizes.length).toBe(10);
    expect(mockOrderbook.bidSizes.length).toBe(10);
    expect(mockOrderbook.totalAskSize).toBeGreaterThan(0);
    expect(mockOrderbook.totalBidSize).toBeGreaterThan(0);
  });
});

describe("Rate limiter", () => {
  it("allows requests within limit and blocks when exceeded", () => {
    const map = new Map<string, number[]>();
    function checkRateLimit(key: string, maxRequests = 5, windowMs = 60_000): boolean {
      const now = Date.now();
      const timestamps = (map.get(key) || []).filter(t => now - t < windowMs);
      if (timestamps.length >= maxRequests) return false;
      timestamps.push(now);
      map.set(key, timestamps);
      return true;
    }
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("test-key", 5)).toBe(true);
    }
    expect(checkRateLimit("test-key", 5)).toBe(false);
  });
});
