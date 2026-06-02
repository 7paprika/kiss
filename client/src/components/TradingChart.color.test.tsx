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

  it("uses a mobile-only chart shell with a left floating native watchlist drawer", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "client/src/pages/Dashboard.tsx"), "utf8");
    const css = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");

    expect(dashboard).toContain("mobile-trading-shell");
    expect(dashboard).toContain("mobile-watchlist-drawer");
    expect(dashboard).toContain("<summary");
    expect(dashboard).toContain("관심종목 열기");
    expect(css).toContain(".mobile-watchlist-drawer[open]");
  });

  it("keeps volume on a dedicated linear chart with a visible value label", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/components/TradingChart.tsx"), "utf8");

    expect(source).toContain("mode: PriceScaleMode.Normal");
    expect(source).toContain("volChart.timeScale().fitContent()");
    expect(source).toContain("거래량");
    expect(source).toContain("formatVolume(displayData.volume)");
  });

  it("uses a grouped right-panel selector instead of a cramped horizontal tab scroller", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "client/src/pages/Dashboard.tsx"), "utf8");

    expect(dashboard).toContain("right-panel-selector");
    expect(dashboard).toContain("right-panel-tab-grid");
    expect(dashboard).toContain("계좌·전략");
    expect(dashboard).toContain("분석");
    expect(dashboard).toContain("운영");
    expect(dashboard).toContain("패널 선택");
    expect(dashboard).not.toContain("탭 바 - 스크롤 가능");
    expect(dashboard).not.toContain("overflow-x-auto scrollbar-none");
  });
});
