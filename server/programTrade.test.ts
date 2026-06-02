import { describe, expect, it, vi } from "vitest";

describe("KIS program trading by stock", () => {
  it("fetches and parses stock-level program buy/sell/net volume and amount", async () => {
    const { KisApiClient } = await import("./kisApi");
    const client = new KisApiClient({ appKey: "app-key", appSecret: "app-secret", accountNo: "12345678", accountProduct: "01", mode: "real" });
    const requestSpy = vi.spyOn(client as any, "request").mockResolvedValue({
      output: [
        {
          bsop_hour: "145500",
          stck_prpr: "72000",
          acml_vol: "1234567",
          whol_smtn_seln_vol: "110000",
          whol_smtn_shnu_vol: "150000",
          whol_smtn_ntby_qty: "40000",
          whol_smtn_seln_tr_pbmn: "7900000000",
          whol_smtn_shnu_tr_pbmn: "10800000000",
          whol_smtn_ntby_tr_pbmn: "2900000000",
          whol_ntby_vol_icdc: "12000",
          whol_ntby_tr_pbmn_icdc: "870000000",
        },
      ],
    });

    const result = await client.getProgramTradeByStock("005930");

    expect(requestSpy).toHaveBeenCalledWith(
      "GET",
      "/uapi/domestic-stock/v1/quotations/program-trade-by-stock",
      "FHPPG04650101",
      { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: "005930" }
    );
    expect(result).toMatchObject({
      stockCode: "005930",
      time: "145500",
      currentPrice: 72000,
      sellVolume: 110000,
      buyVolume: 150000,
      netBuyVolume: 40000,
      sellAmount: 7900000000,
      buyAmount: 10800000000,
      netBuyAmount: 2900000000,
      netBuyVolumeChange: 12000,
      netBuyAmountChange: 870000000,
    });
  });

  it("wires a program trading card into the chart panel without querying while KIS is inactive", async () => {
    const fs = await import("node:fs/promises");
    const chart = await fs.readFile(new URL("../client/src/components/TradingChart.tsx", import.meta.url), "utf-8");

    expect(chart).toContain("trpc.kis.getProgramTradeByStock.useQuery");
    expect(chart).toContain("enabled: isKisActive && !!stockCode");
    expect(chart).toContain("프로그램 매매");
    expect(chart).toContain("프로그램 순매수");
    expect(chart).toContain("programTrade?.buyVolume");
    expect(chart).toContain("programTrade?.sellVolume");
  });
});
