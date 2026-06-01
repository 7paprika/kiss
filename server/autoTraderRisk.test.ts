import { describe, expect, it } from "vitest";
import { calculateRiskManagedOrderQuantity, evaluatePositionExit } from "./autoTrader";

describe("auto-trader capital management", () => {
  it("caps a new entry by fixed-fractional risk, entry allocation, order cap, and remaining exposure", () => {
    const result = calculateRiskManagedOrderQuantity({
      currentPrice: 50_000,
      accountEval: 20_000_000,
      currentExposure: 8_000_000,
      maxOrderAmount: 3_000_000,
      entryCashPct: 20,
      riskPerTradePct: 1,
      stopLossPct: 5,
      maxPortfolioExposurePct: 60,
    });

    expect(result.quantity).toBe(60);
    expect(result.orderBudget).toBe(3_000_000);
    expect(result.limits).toEqual({
      maxOrderAmount: 3_000_000,
      entryAllocationAmount: 4_000_000,
      riskBudgetAmount: 4_000_000,
      remainingExposureAmount: 4_000_000,
    });
  });

  it("blocks new entries when portfolio exposure is already at the configured cap", () => {
    const result = calculateRiskManagedOrderQuantity({
      currentPrice: 10_000,
      accountEval: 10_000_000,
      currentExposure: 5_100_000,
      maxOrderAmount: 1_000_000,
      entryCashPct: 10,
      riskPerTradePct: 1,
      stopLossPct: 3,
      maxPortfolioExposurePct: 50,
    });

    expect(result.quantity).toBe(0);
    expect(result.reason).toContain("포트폴리오 노출 한도");
  });
});

describe("auto-trader exit management", () => {
  const baseHolding = {
    stockCode: "005930",
    holdQty: 10,
    avgPrice: 10_000,
  };

  it("triggers a full trailing-stop exit from the saved high watermark", () => {
    const result = evaluatePositionExit({
      ...baseHolding,
      currentPrice: 11_200,
      previousHighPrice: 12_000,
      stopLossPct: 0,
      takeProfitPct: 0,
      trailingStopPct: 5,
      partialTakeProfitPct: 0,
      partialTakeProfitSellPct: 0,
      breakEvenTriggerPct: 0,
      breakEvenBufferPct: 0,
      partialTakeProfitExecuted: false,
    });

    expect(result.updatedHighPrice).toBe(12_000);
    expect(result.action).toMatchObject({
      kind: "trailing_stop",
      quantity: 10,
      strategyId: "trailing_stop",
    });
    expect(result.action?.reason).toContain("트레일링 스탑");
  });

  it("updates the high watermark without exiting while price keeps making highs", () => {
    const result = evaluatePositionExit({
      ...baseHolding,
      currentPrice: 12_500,
      previousHighPrice: 12_000,
      stopLossPct: 0,
      takeProfitPct: 0,
      trailingStopPct: 5,
      partialTakeProfitPct: 0,
      partialTakeProfitSellPct: 0,
      breakEvenTriggerPct: 0,
      breakEvenBufferPct: 0,
      partialTakeProfitExecuted: false,
    });

    expect(result.updatedHighPrice).toBe(12_500);
    expect(result.action).toBeNull();
  });

  it("sells only the configured slice on the first partial take-profit trigger", () => {
    const result = evaluatePositionExit({
      ...baseHolding,
      currentPrice: 11_200,
      previousHighPrice: 11_200,
      stopLossPct: 0,
      takeProfitPct: 0,
      trailingStopPct: 0,
      partialTakeProfitPct: 10,
      partialTakeProfitSellPct: 40,
      breakEvenTriggerPct: 0,
      breakEvenBufferPct: 0,
      partialTakeProfitExecuted: false,
    });

    expect(result.action).toMatchObject({
      kind: "partial_take_profit",
      quantity: 4,
      strategyId: "partial_take_profit",
    });
  });

  it("moves the stop to breakeven after the configured profit trigger", () => {
    const result = evaluatePositionExit({
      ...baseHolding,
      currentPrice: 10_050,
      previousHighPrice: 10_800,
      stopLossPct: 0,
      takeProfitPct: 0,
      trailingStopPct: 0,
      partialTakeProfitPct: 0,
      partialTakeProfitSellPct: 0,
      breakEvenTriggerPct: 5,
      breakEvenBufferPct: 1,
      partialTakeProfitExecuted: false,
    });

    expect(result.action).toMatchObject({
      kind: "break_even_stop",
      quantity: 10,
      strategyId: "break_even_stop",
    });
    expect(result.action?.reason).toContain("본전 스탑");
  });
});
