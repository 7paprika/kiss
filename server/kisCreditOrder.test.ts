import { describe, expect, it, vi } from "vitest";

describe("KIS credit order support", () => {
  it("routes credit buy orders to the KIS credit endpoint with required credit fields", async () => {
    const { KisApiClient } = await import("./kisApi");
    const client = new KisApiClient({
      appKey: "app-key",
      appSecret: "app-secret",
      accountNo: "12345678",
      accountProduct: "01",
      mode: "real",
    });

    const requestSpy = vi.spyOn(client as any, "request").mockResolvedValue({
      output: { ODNO: "A100", ORD_TMD: "091500" },
    });

    const result = await client.placeOrder("005930", "buy", 3, 55000, "limit", {
      tradeMode: "credit",
      creditType: "21",
      loanDate: "20260601",
    });

    expect(result.success).toBe(true);
    expect(requestSpy).toHaveBeenCalledWith(
      "POST",
      "/uapi/domestic-stock/v1/trading/order-credit",
      "TTTC0052U",
      undefined,
      expect.objectContaining({
        CANO: "12345678",
        ACNT_PRDT_CD: "01",
        PDNO: "005930",
        CRDT_TYPE: "21",
        LOAN_DT: "20260601",
        ORD_DVSN: "00",
        ORD_QTY: "3",
        ORD_UNPR: "55000",
        RSVN_ORD_YN: "N",
      }),
    );
  });

  it("rejects credit orders in paper mode because KIS does not support simulated credit orders", async () => {
    const { KisApiClient } = await import("./kisApi");
    const client = new KisApiClient({
      appKey: "app-key",
      appSecret: "app-secret",
      accountNo: "12345678",
      accountProduct: "01",
      mode: "paper",
    });

    const result = await client.placeOrder("005930", "buy", 1, 0, "market", {
      tradeMode: "credit",
      creditType: "21",
      loanDate: "20260601",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("실전투자");
  });

  it("exposes credit order schema, persistence fields, and manual order UI controls", async () => {
    const [routerSource, schemaSource, orderPanelSource] = await Promise.all([
      import("node:fs/promises").then((fs) => fs.readFile(new URL("./routers.ts", import.meta.url), "utf-8")),
      import("node:fs/promises").then((fs) => fs.readFile(new URL("../drizzle/schema.ts", import.meta.url), "utf-8")),
      import("node:fs/promises").then((fs) => fs.readFile(new URL("../client/src/components/OrderPanel.tsx", import.meta.url), "utf-8")),
    ]);

    expect(routerSource).toContain("tradeMode: z.enum([\"cash\", \"credit\"])");
    expect(routerSource).toContain("creditType: z.enum([\"21\", \"23\", \"25\", \"27\"])");
    expect(routerSource).toContain("loanDate: z.string().regex");
    expect(schemaSource).toContain("tradeMode: mysqlEnum(\"tradeMode\", [\"cash\", \"credit\"])");
    expect(schemaSource).toContain("creditType: varchar(\"creditType\"");
    expect(schemaSource).toContain("loanDate: varchar(\"loanDate\"");
    expect(orderPanelSource).toContain("신용거래");
    expect(orderPanelSource).toContain("신용유형");
    expect(orderPanelSource).toContain("대출일자");
  });
});
