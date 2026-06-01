import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("single-user access guard", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV, OWNER_OPEN_ID: "owner-open-id" };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("allows the configured owner", async () => {
    const { assertSingleUserAccess } = await import("./_core/sdk");
    expect(() => assertSingleUserAccess({ openId: "owner-open-id" })).not.toThrow();
  });

  it("rejects any authenticated user that is not the configured owner", async () => {
    const { assertSingleUserAccess } = await import("./_core/sdk");
    expect(() => assertSingleUserAccess({ openId: "someone-else" })).toThrow("Owner access required");
  });

  it("fails closed in production when OWNER_OPEN_ID is not configured", async () => {
    vi.resetModules();
    process.env = { ...OLD_ENV, NODE_ENV: "production" };
    delete process.env.OWNER_OPEN_ID;
    const { assertSingleUserAccess } = await import("./_core/sdk");
    expect(() => assertSingleUserAccess({ openId: "owner-open-id" })).toThrow("OWNER_OPEN_ID is required");
  });
});

describe("local app-password session", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...OLD_ENV,
      JWT_SECRET: "0123456789abcdef0123456789abcdef",
      VITE_APP_ID: "local-kiss-test",
      APP_LOCAL_OPEN_ID: "local-owner-test",
    };
    delete process.env.OWNER_OPEN_ID;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("returns the local owner identity when the database is unavailable", async () => {
    const { sdk } = await import("./_core/sdk");
    const { COOKIE_NAME } = await import("../shared/const");
    const token = await sdk.createLocalAppSessionToken();
    const user = await sdk.authenticateRequest({
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    } as any);

    expect(user.openId).toBe("local-owner-test");
    expect(user.loginMethod).toBe("app-password");
  });
});

describe("production credential encryption", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("fails closed in production when JWT_SECRET is missing", async () => {
    const { encrypt } = await import("./crypto");
    expect(() => encrypt("broker-secret")).toThrow("JWT_SECRET is required");
  });
});

describe("KST market cron conversion", () => {
  it("uses UTC hours for Korean regular market polling", async () => {
    const { AUTO_TRADE_MARKET_CRON_UTC } = await import("./autoTradeSchedule");
    expect(AUTO_TRADE_MARKET_CRON_UTC).toBe("0 */5 0-6 * * 1-5");
  });

  it("keeps an in-handler KST market-hour guard", async () => {
    const { isKoreanMarketHours } = await import("./autoTradeSchedule");
    expect(isKoreanMarketHours(new Date("2026-06-01T00:00:00.000Z"))).toBe(true); // Mon 09:00 KST
    expect(isKoreanMarketHours(new Date("2026-06-01T06:30:00.000Z"))).toBe(true); // Mon 15:30 KST
    expect(isKoreanMarketHours(new Date("2026-06-01T07:00:00.000Z"))).toBe(false); // Mon 16:00 KST
    expect(isKoreanMarketHours(new Date("2026-06-07T00:00:00.000Z"))).toBe(false); // Sun 09:00 KST
  });
});

describe("KIS access token refresh", () => {
  it("requests an access token before protected API calls when no valid token is set", async () => {
    const { KisApiClient } = await import("./kisApi");
    const client = new KisApiClient({
      appKey: "app-key",
      appSecret: "app-secret",
      accountNo: "12345678-01",
      accountProduct: "01",
      mode: "paper",
    });

    const tokenSpy = vi.spyOn(client, "getAccessToken").mockResolvedValue({
      access_token: "fresh-token",
      token_type: "Bearer",
      expires_in: 86400,
      access_token_token_expired: "2026-06-02 09:00:00",
    });

    await expect((client as any).ensureAccessToken()).resolves.toBe("fresh-token");
    expect(tokenSpy).toHaveBeenCalledTimes(1);
  });
});

describe("KIS settings update semantics", () => {
  it("allows keeping stored app credentials when saving account metadata", async () => {
    const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("./routers.ts", import.meta.url), "utf-8"));
    const saveSettingsBlock = source.slice(source.indexOf("saveSettings:"), source.indexOf("connect: protectedProcedure"));

    expect(saveSettingsBlock).toContain("appKey: z.string().optional()");
    expect(saveSettingsBlock).toContain("appSecret: z.string().optional()");
    expect(saveSettingsBlock).toContain("if (appKey) updateData.encryptedAppKey = encrypt(appKey)");
    expect(saveSettingsBlock).toContain("if (appSecret) updateData.encryptedAppSecret = encrypt(appSecret)");
    expect(saveSettingsBlock).toContain("if (!appKey) throw new Error(\"App Key를 입력하세요\")");
    expect(saveSettingsBlock).toContain("if (!appSecret) throw new Error(\"App Secret을 입력하세요\")");
  });
});

describe("daily realized PnL calculation", () => {
  it("pairs buys and sells instead of summing sell proceeds", async () => {
    const { calculateDailyRealizedPnl } = await import("./performance");
    const result = calculateDailyRealizedPnl([
      {
        stockCode: "005930",
        strategyId: null,
        orderType: "buy",
        status: "executed",
        price: "10000",
        executedPrice: "10000",
        quantity: 10,
        executedQty: 10,
        orderedAt: new Date("2026-06-01T00:00:00.000Z"),
      },
      {
        stockCode: "005930",
        strategyId: null,
        orderType: "sell",
        status: "executed",
        price: "12000",
        executedPrice: "12000",
        quantity: 4,
        executedQty: 4,
        orderedAt: new Date("2026-06-02T00:00:00.000Z"),
      },
    ]);

    expect(result).toEqual([{ date: "2026-06-02", amount: 8000 }]);
  });
});
