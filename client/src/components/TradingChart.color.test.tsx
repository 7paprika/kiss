import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("chart compatibility", () => {
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

  it("does not request chart data or realtime quotes until KIS is active", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/components/TradingChart.tsx"), "utf8");

    expect(source).toContain("trpc.kis.getSettings.useQuery");
    expect(source).toContain("enabled: !!stockCode && Boolean(kisSettings?.isActive)");
    expect(source).toContain("useRealtimeQuote(kisSettings?.isActive ? stockCode : null)");
    expect(source).toContain("KIS API를 연결하면 차트가 표시됩니다");
  });

  it("does not request watchlist prices or realtime quotes until KIS is active", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/components/WatchlistPanel.tsx"), "utf8");

    expect(source).toContain("isKisActive: boolean");
    expect(source).toContain("useRealtimeQuote(isKisActive ? item.stockCode : null)");
    expect(source).toContain("enabled: isKisActive");
  });

  it("does not request order panel market data until KIS is active", () => {
    const orderSource = readFileSync(resolve(process.cwd(), "client/src/components/OrderPanel.tsx"), "utf8");
    const orderbookSource = readFileSync(resolve(process.cwd(), "client/src/components/OrderbookPanel.tsx"), "utf8");

    expect(orderSource).toContain("const isKisActive = Boolean(kisSettings?.isActive)");
    expect(orderSource).toContain("enabled: isKisActive && !!stockCode");
    expect(orderSource).toContain("enabled: isKisActive && tab === \"balance\"");
    expect(orderSource).toContain("enabled: isKisActive && tab === \"pending\"");
    expect(orderSource).toContain("isKisActive={isKisActive}");
    expect(orderbookSource).toContain("isKisActive: boolean");
    expect(orderbookSource).toContain("enabled: isKisActive && !!stockCode");
  });

  it("refreshes cached KIS settings after saving or connecting in the settings modal", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/components/KisSettingsModal.tsx"), "utf8");

    expect(source).toContain("const utils = trpc.useUtils()");
    expect(source.match(/utils\.kis\.getSettings\.invalidate\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source.match(/utils\.kis\.listAccounts\.invalidate\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("KIS API 연결 성공");
  });

  it("connects the account selected in account manager", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/components/AccountManagerModal.tsx"), "utf8");

    expect(source).toContain("connectMutation.mutate({ id: acc.id })");
  });
});
