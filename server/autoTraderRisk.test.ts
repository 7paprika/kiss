import { describe, expect, it } from "vitest";
import { calculateRiskManagedOrderQuantity } from "./autoTrader";

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
