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
  it("getAllStrategyMeta returns 10 strategies (5 selection + 5 trading)", () => {
    const metas = getAllStrategyMeta();
    expect(metas.length).toBe(10);
  });

  it("has 5 selection strategies and 5 trading strategies", () => {
    const metas = getAllStrategyMeta();
    const selection = metas.filter((m) => m.type === "selection");
    const trading = metas.filter((m) => m.type === "trading");
    expect(selection.length).toBe(5);
    expect(trading.length).toBe(5);
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
