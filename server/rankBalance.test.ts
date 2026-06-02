import { describe, expect, it, vi } from "vitest";

describe("KIS rank based universe and account balance visibility", () => {
  it("fetches KIS volume-rank candidates using exchange filters instead of scanning arbitrary KRX prefix rows", async () => {
    const { KisApiClient } = await import("./kisApi");
    const client = new KisApiClient({ appKey: "app-key", appSecret: "app-secret", accountNo: "12345678", accountProduct: "01", mode: "real" });
    const requestSpy = vi.spyOn(client as any, "request").mockResolvedValue({
      output: [
        { mksc_shrn_iscd: "005930", hts_kor_isnm: "삼성전자", stck_prpr: "71000", acml_vol: "1000000", acml_tr_pbmn: "71000000000" },
        { data_rank: "2", stck_shrn_iscd: "000660", hts_kor_isnm: "SK하이닉스", stck_prpr: "190000", acml_vol: "800000", acml_tr_pbmn: "152000000000" },
      ],
    });

    const rows = await client.getVolumeRankCandidates({ minPrice: 1000, maxPrice: 1000000, minVolume: 50000, sort: "amount" });

    expect(rows.map((row) => row.code)).toEqual(["005930", "000660"]);
    expect(rows[0]).toMatchObject({ name: "삼성전자", price: 71000, volume: 1000000, amount: 71000000000 });
    expect(requestSpy).toHaveBeenCalledWith(
      "GET",
      "/uapi/domestic-stock/v1/quotations/volume-rank",
      "FHPST01710000",
      expect.objectContaining({
        FID_INPUT_ISCD: "0000",
        FID_BLNG_CLS_CODE: "3",
        FID_TRGT_EXLS_CLS_CODE: expect.any(String),
        FID_INPUT_PRICE_1: "1000",
        FID_VOL_CNT: "50000",
      })
    );
  });

  it("builds whole-market universe from KIS rank candidates before OHLCV strategy evaluation", async () => {
    const { buildWholeMarketUniverse } = await import("./universeScreener");
    const calls: string[] = [];
    const ohlcv = Array.from({ length: 40 }, (_, i) => ({ date: `202501${String(i + 1).padStart(2, "0")}`, open: 1000, high: 1200, low: 900, close: i === 39 ? 980 : 1000, volume: 100000, amount: 100000000 }));
    const client = {
      getVolumeRankCandidates: vi.fn(async () => [
        { code: "005930", name: "삼성전자", market: "KRX", price: 71000, volume: 1_000_000, amount: 71_000_000_000 },
      ]),
      getCurrentPriceDetail: vi.fn(async (code: string) => { calls.push(code); throw new Error("should not quote scan when rank is available"); }),
      getCurrentPrice: vi.fn(),
      getOHLCV: vi.fn(async () => ohlcv),
    };

    const result = await buildWholeMarketUniverse({ client, maxOhlcvFetch: 10, maxPerStrategy: 5 });

    expect(client.getVolumeRankCandidates).toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(result.source).toBe("rank-api");
    expect(result.scanned).toBe(1);
  });

  it("parses account cash, withdrawable cash and holding balances from KIS balance response", async () => {
    const { KisApiClient } = await import("./kisApi");
    const client = new KisApiClient({ appKey: "app-key", appSecret: "app-secret", accountNo: "12345678", accountProduct: "01", mode: "real" });
    vi.spyOn(client as any, "request").mockResolvedValue({
      output1: [{ pdno: "005930", prdt_name: "삼성전자", hldg_qty: "3", pchs_avg_pric: "70000", prpr: "72000", evlu_amt: "216000", evlu_pfls_amt: "6000", evlu_pfls_rt: "2.85" }],
      output2: [{ tot_evlu_amt: "1216000", evlu_pfls_smtl_amt: "6000", dnca_tot_amt: "1000000", nxdy_excc_amt: "950000", prvs_rcdl_excc_amt: "900000" }],
    });

    const balance = await client.getBalance();

    expect(balance).toMatchObject({ totalEval: 1216000, totalProfit: 6000, cashBalance: 1000000, withdrawableCash: 950000 });
    expect(balance.holdings[0]).toMatchObject({ stockCode: "005930", stockName: "삼성전자", holdQty: 3, evalAmount: 216000 });
  });

  it("exposes account balance panel in the dashboard UI", async () => {
    const fs = await import("node:fs/promises");
    const dashboard = await fs.readFile(new URL("../client/src/pages/Dashboard.tsx", import.meta.url), "utf-8");
    const panel = await fs.readFile(new URL("../client/src/components/AccountBalancePanel.tsx", import.meta.url), "utf-8");

    expect(dashboard).toContain("AccountBalancePanel");
    expect(panel).toContain("trpc.kis.getBalance.useQuery");
    expect(panel).toContain("예수금");
    expect(panel).toContain("출금가능");
    expect(panel).toContain("보유종목");
  });
});
