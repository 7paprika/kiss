import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/components/StrategyPanel.tsx"), "utf8");

const strategyIds = [
  "momentum_selection",
  "momentum_trading",
  "bollinger_selection",
  "bollinger_trading",
  "rsi_selection",
  "rsi_trading",
  "golden_cross_selection",
  "golden_cross_trading",
  "week52_high_selection",
  "week52_high_trading",
  "macd_selection",
  "macd_trading",
  "stochastic_selection",
  "stochastic_trading",
  "triangle_reversion_trading",
];

describe("StrategyPanel strategy guide popovers", () => {
  it("defines a detailed guide for every built-in strategy", () => {
    expect(source).toContain("strategyGuides");
    for (const id of strategyIds) {
      expect(source).toContain(`${id}:`);
    }
    expect(source).toContain("핵심 원리");
    expect(source).toContain("효과 좋은 조건");
    expect(source).toContain("주의할 조건");
    expect(source).toContain("운영 팁");
  });

  it("opens strategy details from an explicit info icon instead of only expanding parameters", () => {
    expect(source).toContain("openedGuideStrategy");
    expect(source).toContain("strategy-guide-popover");
    expect(source).toContain("aria-label={`${meta.name} 상세 설명 보기`}");
    expect(source).toContain("setOpenedGuideStrategy");
    expect(source).toContain("stopPropagation");
  });
});
