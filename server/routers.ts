import { eq, and, desc, gte } from "drizzle-orm";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb, getScreenerResults, saveScreenerResult, markScreenerAddedToWatchlist, saveBacktestResult, getBacktestResultsByBatch, getRecentBacktestBatches } from "./db";
import {
  kisSettings, watchlist, strategyConfigs, autoTraderConfig,
  orders, autoTraderLogs, telegramSettings,
} from "../drizzle/schema";
import { encrypt, decrypt } from "./crypto";
import { KisApiClient, setKisClient } from "./kisApi";
import { getAllStrategyMeta, getTradingStrategy as getTradingStrategyById } from "./strategies/index";
import { nanoid } from "nanoid";
import { runBacktest } from "./backtest";
import { sendTelegramMessage, testTelegramConnection } from "./telegram";
import { initKisClientForUser } from "./autoTrader";
import { fetchStockNewsAndDisclosures } from "./news";
import { runGridSearch, STRATEGY_PARAM_SPACES } from "./optimizer";
import { createHeartbeatJob, deleteHeartbeatJob } from "./_core/heartbeat";
import { AUTO_TRADE_MARKET_CRON_UTC } from "./autoTradeSchedule";
import { calculateDailyRealizedPnl } from "./performance";
import { searchStocks } from "./stockSearch";
import { buildWholeMarketUniverse, DEFAULT_UNIVERSE_FILTERS } from "./universeScreener";
import { evaluatePasswordLogin, loadPasswordAuthState, savePasswordAuthState } from "./_core/appPasswordAuth";
import { sdk } from "./_core/sdk";
import { parse as parseCookie } from "cookie";
import { z } from "zod";

// ─── Rate Limiter Map (per user) ──────────────────────────────────────────────
const rateLimitMap = new Map<string, number[]>();
function checkRateLimit(key: string, maxRequests = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(key) || []).filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) return false;
  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  return true;
}

// ─── KIS Router ───────────────────────────────────────────────────────────────
const kisRouter = router({
  // 현재 활성 계좌 조회 (기존 호환)
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(kisSettings)
      .where(and(eq(kisSettings.userId, ctx.user.id), eq(kisSettings.isActive, true)))
      .limit(1);
    if (!rows.length) {
      // fallback: 첫 번째 계좌
      const all = await db.select().from(kisSettings).where(eq(kisSettings.userId, ctx.user.id)).limit(1);
      if (!all.length) return null;
      const s = all[0];
      return { id: s.id, profileName: s.profileName, mode: s.mode, accountNo: s.accountNo, accountProduct: s.accountProduct, isActive: s.isActive, tokenExpiredAt: s.tokenExpiredAt, hasAppKey: !!s.encryptedAppKey, hasAppSecret: !!s.encryptedAppSecret };
    }
    const s = rows[0];
    return { id: s.id, profileName: s.profileName, mode: s.mode, accountNo: s.accountNo, accountProduct: s.accountProduct, isActive: s.isActive, tokenExpiredAt: s.tokenExpiredAt, hasAppKey: !!s.encryptedAppKey, hasAppSecret: !!s.encryptedAppSecret };
  }),

  // 전체 계좌 목록 조회
  listAccounts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(kisSettings).where(eq(kisSettings.userId, ctx.user.id)).orderBy(kisSettings.createdAt);
    return rows.map(s => ({ id: s.id, profileName: s.profileName, mode: s.mode, accountNo: s.accountNo, accountProduct: s.accountProduct, isActive: s.isActive, isDefault: s.isDefault, tokenExpiredAt: s.tokenExpiredAt, hasAppKey: !!s.encryptedAppKey, hasAppSecret: !!s.encryptedAppSecret }));
  }),

  // 계좌 추가 (saveSettings 확장 - profileName 지원)
  addAccount: protectedProcedure.input(z.object({
    profileName: z.string().min(1).default("기본 계좌"),
    appKey: z.string().min(1),
    appSecret: z.string().min(1),
    accountNo: z.string().min(1),
    accountProduct: z.string().default("01"),
    mode: z.enum(["real", "paper"]),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const encryptedAppKey = encrypt(input.appKey);
    const encryptedAppSecret = encrypt(input.appSecret);
    const existing = await db.select({ id: kisSettings.id }).from(kisSettings).where(eq(kisSettings.userId, ctx.user.id));
    const isFirst = existing.length === 0;
    await db.insert(kisSettings).values({
      userId: ctx.user.id, profileName: input.profileName,
      encryptedAppKey, encryptedAppSecret,
      accountNo: input.accountNo, accountProduct: input.accountProduct,
      mode: input.mode, isDefault: isFirst, isActive: false,
    });
    return { success: true };
  }),

  // 계좌 수정
  updateAccount: protectedProcedure.input(z.object({
    id: z.number(),
    profileName: z.string().min(1).optional(),
    appKey: z.string().optional(),
    appSecret: z.string().optional(),
    accountNo: z.string().optional(),
    accountProduct: z.string().optional(),
    mode: z.enum(["real", "paper"]).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db.select().from(kisSettings).where(and(eq(kisSettings.id, input.id), eq(kisSettings.userId, ctx.user.id))).limit(1);
    if (!rows.length) throw new Error("계좌를 찾을 수 없습니다");
    const updateData: Record<string, unknown> = {};
    if (input.profileName) updateData.profileName = input.profileName;
    if (input.appKey) updateData.encryptedAppKey = encrypt(input.appKey);
    if (input.appSecret) updateData.encryptedAppSecret = encrypt(input.appSecret);
    if (input.accountNo) updateData.accountNo = input.accountNo;
    if (input.accountProduct) updateData.accountProduct = input.accountProduct;
    if (input.mode) updateData.mode = input.mode;
    updateData.accessToken = null; updateData.tokenExpiredAt = null;
    await db.update(kisSettings).set(updateData).where(eq(kisSettings.id, input.id));
    return { success: true };
  }),

  // 계좌 삭제
  deleteAccount: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    await db.delete(kisSettings).where(and(eq(kisSettings.id, input.id), eq(kisSettings.userId, ctx.user.id)));
    return { success: true };
  }),

  // 계좌 전환 (선택된 계좌를 isActive=true로)
  switchAccount: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    // 모든 계좌 isActive=false
    await db.update(kisSettings).set({ isActive: false, accessToken: null }).where(eq(kisSettings.userId, ctx.user.id));
    // 선택 계좌 isActive=true
    await db.update(kisSettings).set({ isActive: true }).where(and(eq(kisSettings.id, input.id), eq(kisSettings.userId, ctx.user.id)));
    return { success: true };
  }),

  saveSettings: protectedProcedure.input(z.object({
    appKey: z.string().optional(),
    appSecret: z.string().optional(),
    accountNo: z.string().min(1),
    accountProduct: z.string().default("01"),
    mode: z.enum(["real", "paper"]),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const appKey = input.appKey?.trim() ?? "";
    const appSecret = input.appSecret?.trim() ?? "";
    const accountNo = input.accountNo.trim();

    const existing = await db.select().from(kisSettings).where(eq(kisSettings.userId, ctx.user.id)).limit(1);
    if (existing.length) {
      const updateData: Record<string, unknown> = {
        accountNo,
        accountProduct: input.accountProduct,
        mode: input.mode,
        isActive: true,
        accessToken: null,
        tokenExpiredAt: null,
      };
      if (appKey) updateData.encryptedAppKey = encrypt(appKey);
      if (appSecret) updateData.encryptedAppSecret = encrypt(appSecret);
      await db.update(kisSettings).set(updateData).where(eq(kisSettings.userId, ctx.user.id));
    } else {
      if (!appKey) throw new Error("App Key를 입력하세요");
      if (!appSecret) throw new Error("App Secret을 입력하세요");
      const encryptedAppKey = encrypt(appKey);
      const encryptedAppSecret = encrypt(appSecret);
      await db.insert(kisSettings).values({
        userId: ctx.user.id, encryptedAppKey, encryptedAppSecret,
        accountNo, accountProduct: input.accountProduct,
        mode: input.mode,
        isActive: true,
      });
    }
    return { success: true };
  }),

  connect: protectedProcedure.input(z.object({ id: z.number().optional() }).optional()).mutation(async ({ ctx, input }) => {
    if (!checkRateLimit(`kis-connect-${ctx.user.id}`, 5, 60_000)) {
      throw new Error("요청이 너무 많습니다. 잠시 후 다시 시도하세요.");
    }
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    let rows = input?.id
      ? await db.select().from(kisSettings).where(and(eq(kisSettings.userId, ctx.user.id), eq(kisSettings.id, input.id))).limit(1)
      : await db.select().from(kisSettings).where(and(eq(kisSettings.userId, ctx.user.id), eq(kisSettings.isActive, true))).limit(1);
    if (!rows.length && !input?.id) {
      rows = await db.select().from(kisSettings).where(eq(kisSettings.userId, ctx.user.id)).limit(1);
    }
    if (!rows.length) throw new Error("API 설정이 없습니다");

    const setting = rows[0];
    const appKey = decrypt(setting.encryptedAppKey || "");
    const appSecret = decrypt(setting.encryptedAppSecret || "");
    if (!appKey || !appSecret) throw new Error("API 키가 유효하지 않습니다");

    const client = new KisApiClient({
      appKey, appSecret,
      accountNo: setting.accountNo || "",
      accountProduct: setting.accountProduct || "01",
      mode: setting.mode,
    });

    const tokenRes = await client.getAccessToken();
    const expiredAt = new Date(Date.now() + tokenRes.expires_in * 1000);
    client.setToken(tokenRes.access_token, expiredAt);
    setKisClient(ctx.user.id, client);

    await db.update(kisSettings).set({ isActive: false }).where(eq(kisSettings.userId, ctx.user.id));
    await db.update(kisSettings).set({
      accessToken: tokenRes.access_token, tokenExpiredAt: expiredAt, isActive: true,
    }).where(and(eq(kisSettings.userId, ctx.user.id), eq(kisSettings.id, setting.id)));

    return { success: true, expiredAt };
  }),

  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    await db.update(kisSettings).set({ isActive: false, accessToken: null }).where(eq(kisSettings.userId, ctx.user.id));
    return { success: true };
  }),

  getCurrentPrice: protectedProcedure.input(z.object({ stockCode: z.string() })).query(async ({ ctx, input }) => {
    if (!checkRateLimit(`price-${ctx.user.id}`, 60, 60_000)) throw new Error("Rate limit exceeded");
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) throw new Error("KIS API 연결이 필요합니다");
    return client.getCurrentPrice(input.stockCode);
  }),

  getOHLCV: protectedProcedure.input(z.object({
    stockCode: z.string(),
    period: z.enum(["D", "W", "M"]).default("D"),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })).query(async ({ ctx, input }) => {
    if (!checkRateLimit(`ohlcv-${ctx.user.id}`, 30, 60_000)) throw new Error("Rate limit exceeded");
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) throw new Error("KIS API 연결이 필요합니다");
    return client.getOHLCV(input.stockCode, input.period, input.startDate, input.endDate);
  }),

  getBalance: protectedProcedure.query(async ({ ctx }) => {
    if (!checkRateLimit(`balance-${ctx.user.id}`, 10, 60_000)) throw new Error("Rate limit exceeded");
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) throw new Error("KIS API 연결이 필요합니다");
    return client.getBalance();
  }),

  placeOrder: protectedProcedure.input(z.object({
    stockCode: z.string(),
    stockName: z.string().optional(),
    orderType: z.enum(["buy", "sell"]),
    priceType: z.enum(["market", "limit"]),
    tradeMode: z.enum(["cash", "credit"]).default("cash"),
    creditType: z.enum(["21", "23", "25", "27"]).optional(),
    loanDate: z.string().regex(/^\d{8}$/, "대출일자는 YYYYMMDD 형식이어야 합니다").optional(),
    quantity: z.number().int().positive(),
    price: z.number().optional(),
  })).mutation(async ({ ctx, input }) => {
    if (!checkRateLimit(`order-${ctx.user.id}`, 10, 60_000)) throw new Error("Rate limit exceeded");
    if (input.tradeMode === "credit") {
      if (!input.creditType) throw new Error("신용유형을 선택하세요");
      if (!input.loanDate) throw new Error("대출일자를 입력하세요");
      const validForOrder = input.orderType === "buy" ? ["21", "23"] : ["25", "27"];
      if (!validForOrder.includes(input.creditType)) {
        throw new Error(input.orderType === "buy" ? "신용매수는 융자신규 유형만 선택할 수 있습니다" : "신용매도는 융자상환 유형만 선택할 수 있습니다");
      }
    }
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) throw new Error("KIS API 연결이 필요합니다");

    const result = await client.placeOrder(
      input.stockCode, input.orderType, input.quantity,
      input.price || 0, input.priceType,
      { tradeMode: input.tradeMode, creditType: input.creditType, loanDate: input.loanDate }
    );

    const db = await getDb();
    if (db) {
      await db.insert(orders).values({
        userId: ctx.user.id,
        stockCode: input.stockCode,
        stockName: input.stockName,
        orderType: input.orderType,
        priceType: input.priceType,
        tradeMode: input.tradeMode,
        creditType: input.tradeMode === "credit" ? input.creditType : null,
        loanDate: input.tradeMode === "credit" ? input.loanDate : null,
        quantity: input.quantity,
        price: input.price ? String(input.price) : null,
        status: result.success ? "pending" : "rejected",
        kisOrderNo: result.orderNo,
        isAutoOrder: false,
        errorMsg: result.success ? null : result.message,
      });
    }

    if (result.success) {
      await sendTelegramMessage(ctx.user.id, "order",
        `📋 *수동 ${input.orderType === "buy" ? "매수" : "매도"} 주문*\n\n` +
        `종목: ${input.stockCode} ${input.stockName || ""}\n` +
        `거래: ${input.tradeMode === "credit" ? `신용(${input.creditType}, ${input.loanDate})` : "현금"}\n` +
        `수량: ${input.quantity}주\n` +
        `유형: ${input.priceType === "market" ? "시장가" : `지정가 ${input.price?.toLocaleString()}원`}\n` +
        `주문번호: ${result.orderNo}`
      );
    }

    return result;
  }),

  getPendingOrders: protectedProcedure.query(async ({ ctx }) => {
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) return [];
    return client.getPendingOrders();
  }),

  cancelOrder: protectedProcedure.input(z.object({
    orderNo: z.string(),
    stockCode: z.string(),
    quantity: z.number().int().positive(),
  })).mutation(async ({ ctx, input }) => {
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) throw new Error("KIS API 연결이 필요합니다");
    const success = await client.cancelOrder(input.orderNo, input.stockCode, input.quantity);
    if (success) {
      const db = await getDb();
      if (db) {
        await db.update(orders).set({ status: "cancelled" }).where(
          and(eq(orders.kisOrderNo, input.orderNo), eq(orders.userId, ctx.user.id))
        );
      }
    }
    return { success };
  }),

  searchStock: protectedProcedure.input(z.object({ keyword: z.string() })).query(async ({ ctx, input }) => {
    const localResults = await searchStocks(input.keyword);
    if (localResults.length > 0) return localResults;

    const client = await initKisClientForUser(ctx.user.id);
    if (!client) return [];
    return client.searchStock(input.keyword);
  }),

  getOrderHistory: protectedProcedure.input(z.object({ limit: z.number().default(50) })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(orders).where(eq(orders.userId, ctx.user.id)).orderBy(desc(orders.orderedAt)).limit(input.limit);
  }),

  getOrderbook: protectedProcedure.input(z.object({ stockCode: z.string().min(1) })).query(async ({ ctx, input }) => {
    if (!checkRateLimit(`orderbook:${ctx.user.id}`, 60, 60_000)) throw new Error("Rate limit exceeded");
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) throw new Error("KIS API 연결이 필요합니다");
    return client.getOrderbook(input.stockCode);
  }),
});

// ─── Watchlist Router ─────────────────────────────────────────────────────────
const watchlistRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(watchlist).where(eq(watchlist.userId, ctx.user.id)).orderBy(watchlist.sortOrder);
  }),

  add: protectedProcedure.input(z.object({
    stockCode: z.string().min(1),
    stockName: z.string().optional(),
    market: z.string().default("J"),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const existing = await db.select().from(watchlist).where(
      and(eq(watchlist.userId, ctx.user.id), eq(watchlist.stockCode, input.stockCode))
    ).limit(1);
    if (existing.length) throw new Error("이미 관심종목에 등록된 종목입니다");
    const allItems = await db.select().from(watchlist).where(eq(watchlist.userId, ctx.user.id));
    await db.insert(watchlist).values({
      userId: ctx.user.id,
      stockCode: input.stockCode,
      stockName: input.stockName,
      market: input.market,
      sortOrder: allItems.length,
    });
    return { success: true };
  }),

  remove: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    await db.delete(watchlist).where(eq(watchlist.id, input.id));
    return { success: true };
  }),

  toggleAutoTrading: protectedProcedure.input(z.object({
    id: z.number(), isAutoTrading: z.boolean(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    await db.update(watchlist).set({ isAutoTrading: input.isAutoTrading }).where(
      and(eq(watchlist.id, input.id), eq(watchlist.userId, ctx.user.id))
    );
    return { success: true };
  }),

  reorder: protectedProcedure.input(z.array(z.object({ id: z.number(), sortOrder: z.number() }))).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    for (const item of input) {
      await db.update(watchlist).set({ sortOrder: item.sortOrder }).where(
        and(eq(watchlist.id, item.id), eq(watchlist.userId, ctx.user.id))
      );
    }
    return { success: true };
  }),
});

// ─── Strategy Router ──────────────────────────────────────────────────────────
const strategyRouter = router({
  getAllMeta: publicProcedure.query(() => getAllStrategyMeta()),

  getUserConfigs: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(strategyConfigs).where(eq(strategyConfigs.userId, ctx.user.id));
  }),

  saveConfig: protectedProcedure.input(z.object({
    id: z.number().optional(),
    strategyType: z.enum(["selection", "trading"]),
    strategyId: z.string(),
    strategyName: z.string().optional(),
    isEnabled: z.boolean().default(false),
    params: z.record(z.string(), z.any()).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    if (input.id) {
      await db.update(strategyConfigs).set({
        isEnabled: input.isEnabled,
        params: input.params as Record<string, unknown> | null,
        strategyName: input.strategyName,
      }).where(and(eq(strategyConfigs.id, input.id), eq(strategyConfigs.userId, ctx.user.id)));
    } else {
      await db.insert(strategyConfigs).values({
        userId: ctx.user.id,
        strategyType: input.strategyType,
        strategyId: input.strategyId,
        strategyName: input.strategyName || input.strategyId,
        isEnabled: input.isEnabled,
        params: input.params as Record<string, unknown> | null,
      });
    }
    return { success: true };
  }),

  initDefaults: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const existing = await db.select().from(strategyConfigs).where(eq(strategyConfigs.userId, ctx.user.id));
    if (existing.length > 0) return { success: true, message: "이미 초기화됨" };

    const allMeta = getAllStrategyMeta();
    for (const meta of allMeta) {
      await db.insert(strategyConfigs).values({
        userId: ctx.user.id,
        strategyType: meta.type,
        strategyId: meta.id,
        strategyName: meta.name,
        isEnabled: false,
        params: meta.defaultParams as Record<string, unknown>,
      });
    }
    return { success: true };
  }),
});

// ─── Auto Trader Router ───────────────────────────────────────────────────────
const autoTraderRouter = router({
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(autoTraderConfig).where(eq(autoTraderConfig.userId, ctx.user.id)).limit(1);
    return rows[0] || null;
  }),

  saveConfig: protectedProcedure.input(z.object({
    selectionStrategyId: z.number().nullable().optional(),
    tradingStrategyId: z.number().nullable().optional(),
    maxPositions: z.number().int().min(1).max(20).default(5),
    maxOrderAmount: z.number().positive().default(1_000_000),
    entryCashPct: z.number().min(1).max(100).default(10),
    riskPerTradePct: z.number().min(0).max(10).default(1),
    maxPortfolioExposurePct: z.number().min(1).max(100).default(50),
    stopLossPct: z.number().min(0).max(50).default(3),
    takeProfitPct: z.number().min(0).max(100).default(5),
    trailingStopPct: z.number().min(0).max(50).default(0),
    partialTakeProfitPct: z.number().min(0).max(100).default(0),
    partialTakeProfitSellPct: z.number().min(1).max(100).default(50),
    breakEvenTriggerPct: z.number().min(0).max(100).default(0),
    breakEvenBufferPct: z.number().min(0).max(20).default(0),
    accountProfileId: z.number().nullable().optional(), // 전략별 계좌 배정
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const existing = await db.select().from(autoTraderConfig).where(eq(autoTraderConfig.userId, ctx.user.id)).limit(1);
    const data = {
      selectionStrategyId: input.selectionStrategyId ?? null,
      tradingStrategyId: input.tradingStrategyId ?? null,
      maxPositions: input.maxPositions,
      maxOrderAmount: String(input.maxOrderAmount),
      entryCashPct: String(input.entryCashPct),
      riskPerTradePct: String(input.riskPerTradePct),
      maxPortfolioExposurePct: String(input.maxPortfolioExposurePct),
      stopLossPct: String(input.stopLossPct),
      takeProfitPct: String(input.takeProfitPct),
      trailingStopPct: String(input.trailingStopPct),
      partialTakeProfitPct: String(input.partialTakeProfitPct),
      partialTakeProfitSellPct: String(input.partialTakeProfitSellPct),
      breakEvenTriggerPct: String(input.breakEvenTriggerPct),
      breakEvenBufferPct: String(input.breakEvenBufferPct),
      accountProfileId: input.accountProfileId ?? null,
    };
    if (existing.length) {
      await db.update(autoTraderConfig).set(data).where(eq(autoTraderConfig.userId, ctx.user.id));
    } else {
      await db.insert(autoTraderConfig).values({ userId: ctx.user.id, ...data });
    }
    return { success: true };
  }),

  toggleRunning: protectedProcedure.input(z.object({ isRunning: z.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const existing = await db.select().from(autoTraderConfig).where(eq(autoTraderConfig.userId, ctx.user.id)).limit(1);

    let cronTaskUid = existing[0]?.scheduleCronTaskUid || null;

    if (input.isRunning && !cronTaskUid) {
      // Create Heartbeat cron (every 5 min during market hours)
      try {
        const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        const job = await createHeartbeatJob({
          name: `auto-trade-${ctx.user.id}`,
          cron: AUTO_TRADE_MARKET_CRON_UTC, // every 5 min during KST market hours, expressed in UTC
          path: "/api/scheduled/auto-trade",
          description: `Auto trading cycle for user ${ctx.user.id}`,
        }, sessionToken);
        cronTaskUid = job.taskUid;
      } catch (e) {
        console.warn("[Heartbeat] Failed to create cron:", e);
      }
    } else if (!input.isRunning && cronTaskUid) {
      // Delete/pause Heartbeat cron
      try {
        const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        await deleteHeartbeatJob(cronTaskUid, sessionToken);
        cronTaskUid = null;
      } catch (e) {
        console.warn("[Heartbeat] Failed to delete cron:", e);
      }
    }

    if (existing.length) {
      await db.update(autoTraderConfig).set({ isRunning: input.isRunning, scheduleCronTaskUid: cronTaskUid }).where(eq(autoTraderConfig.userId, ctx.user.id));
    } else {
      await db.insert(autoTraderConfig).values({ userId: ctx.user.id, isRunning: input.isRunning, scheduleCronTaskUid: cronTaskUid });
    }
    await sendTelegramMessage(ctx.user.id, "info",
      input.isRunning ? "🟢 자동매매가 시작되었습니다" : "🔴 자동매매가 중지되었습니다"
    );
    return { success: true };
  }),

  getLogs: protectedProcedure.input(z.object({ limit: z.number().default(100) })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(autoTraderLogs).where(eq(autoTraderLogs.userId, ctx.user.id)).orderBy(desc(autoTraderLogs.createdAt)).limit(input.limit);
  }),

  runSignalCheck: protectedProcedure.input(z.object({ stockCode: z.string(), strategyId: z.string() })).mutation(async ({ ctx, input }) => {
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) throw new Error("KIS API 연결이 필요합니다");
    const { getTradingStrategy } = await import("./strategies/index");
    const strategy = getTradingStrategy(input.strategyId);
    if (!strategy) throw new Error("전략을 찾을 수 없습니다");
    const ohlcv = await client.getOHLCV(input.stockCode, "D");
    const signal = strategy.evaluate(ohlcv, strategy.meta.defaultParams);
    return signal;
  }),
});

// ─── Backtest Router ───────────────────────────────────────────────────────────────────
const backtestRouter = router({
  run: protectedProcedure.input(z.object({
    stockCode: z.string().min(1),
    strategyId: z.string().min(1),
    period: z.enum(["D", "W", "M"]).default("D"),
    initialCapital: z.number().min(100_000).default(10_000_000),
    stopLossPct: z.number().min(0).max(50).default(0),
    takeProfitPct: z.number().min(0).max(100).default(0),
    strategyParams: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
  })).mutation(async ({ ctx, input }) => {
    if (!checkRateLimit(`backtest:${ctx.user.id}`, 10, 60_000)) {
      throw new Error("백테스트 요청이 너무 많습니다. 1분 후 다시 시도해주세요.");
    }
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) throw new Error("KIS API 연결이 필요합니다");

    // Fetch enough historical data (up to 600 bars)
    const ohlcv = await client.getOHLCV(input.stockCode, input.period);
    if (ohlcv.length < 60) throw new Error("백테스트에 필요한 데이터가 부족합니다 (최소 60바 필요)");

    const result = runBacktest({
      strategyId: input.strategyId,
      ohlcv,
      stockCode: input.stockCode,
      initialCapital: input.initialCapital,
      stopLossPct: input.stopLossPct,
      takeProfitPct: input.takeProfitPct,
      strategyParams: input.strategyParams as Record<string, number | string | boolean> | undefined,
    });

    return result;
  }),

  // Compare all trading strategies on one stock
  compare: protectedProcedure.input(z.object({
    stockCode: z.string().min(1),
    period: z.enum(["D", "W", "M"]).default("D"),
    initialCapital: z.number().min(100_000).default(10_000_000),
    stopLossPct: z.number().min(0).max(50).default(0),
    takeProfitPct: z.number().min(0).max(100).default(0),
    strategyIds: z.array(z.string()).optional(),
  })).mutation(async ({ ctx, input }) => {
    if (!checkRateLimit(`backtest:${ctx.user.id}`, 3, 60_000)) {
      throw new Error("비교 백테스트 요청이 너무 많습니다. 1분 후 다시 시도해주세요.");
    }
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) throw new Error("KIS API 연결이 필요합니다");
    const ohlcv = await client.getOHLCV(input.stockCode, input.period);
    if (ohlcv.length < 60) throw new Error("백테스트에 필요한 데이터가 부족합니다 (최소 60바 필요)");
    const allMeta = getAllStrategyMeta().filter(m => m.type === "trading");
    const targetIds = input.strategyIds?.length ? input.strategyIds : allMeta.map(m => m.id);
    const batchId = nanoid();
    const results: unknown[] = [];
    for (const strategyId of targetIds) {
      try {
        const result = runBacktest({ strategyId, ohlcv, stockCode: input.stockCode, initialCapital: input.initialCapital, stopLossPct: input.stopLossPct, takeProfitPct: input.takeProfitPct });
        results.push(result);
        saveBacktestResult({ userId: ctx.user.id, batchId, stockCode: input.stockCode, strategyId, strategyName: result.strategyName, period: input.period, initialCapital: result.initialCapital, finalCapital: result.finalCapital, totalReturn: result.totalReturn, annualizedReturn: result.annualizedReturn, maxDrawdown: result.maxDrawdown, sharpeRatio: result.sharpeRatio, winRate: result.winRate, totalTrades: result.totalTrades, winTrades: result.winTrades, lossTrades: result.lossTrades, stopLossPct: input.stopLossPct, takeProfitPct: input.takeProfitPct, resultJson: result }).catch(() => {});
      } catch (err) { results.push({ strategyId, strategyName: strategyId, error: String(err) }); }
    }
    return { batchId, results, stockCode: input.stockCode };
  }),

  getRecentBatches: protectedProcedure.query(async ({ ctx }) => getRecentBacktestBatches(ctx.user.id)),
  getHistory: protectedProcedure.input(z.object({ batchId: z.string() })).query(async ({ input }) => getBacktestResultsByBatch(input.batchId)),
});

// ─── Screener Router ─────────────────────────────────────────────────────────────────────────────────────
const screenerRouter = router({
  getToday: protectedProcedure.input(z.object({ date: z.string().optional() })).query(async ({ ctx, input }) => {
    return getScreenerResults(ctx.user.id, input.date);
  }),

  addToWatchlist: protectedProcedure.input(z.object({
    screenerResultId: z.number(),
    stockCode: z.string(),
    stockName: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB 연결 실패");
    const existing = await db.select().from(watchlist).where(and(eq(watchlist.userId, ctx.user.id), eq(watchlist.stockCode, input.stockCode))).limit(1);
    if (!existing.length) {
      const maxOrder = await db.select().from(watchlist).where(eq(watchlist.userId, ctx.user.id)).orderBy(desc(watchlist.sortOrder)).limit(1);
      const nextOrder = (maxOrder[0]?.sortOrder ?? 0) + 1;
      await db.insert(watchlist).values({ userId: ctx.user.id, stockCode: input.stockCode, stockName: input.stockName || input.stockCode, sortOrder: nextOrder, isAutoTrading: false });
    }
    await markScreenerAddedToWatchlist(input.screenerResultId);
    return { success: true };
  }),

  runManual: protectedProcedure.input(z.object({
    stockCodes: z.array(z.string()).min(1).max(20),
    strategyId: z.string(),
  })).mutation(async ({ ctx, input }) => {
    if (!checkRateLimit(`screener:${ctx.user.id}`, 5, 60_000)) throw new Error("스크리너 요청이 너무 많습니다. 1분 후 다시 시도해주세요.");
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) throw new Error("KIS API 연결이 필요합니다");
    const strategy = getTradingStrategyById(input.strategyId);
    if (!strategy) throw new Error("전략을 찾을 수 없습니다");
    const today = new Date().toISOString().slice(0, 10);
    const results = [];
    for (const code of input.stockCodes) {
      try {
        const ohlcv = await client.getOHLCV(code, "D");
        const signal = strategy.evaluate(ohlcv, strategy.meta.defaultParams);
        const lastBar = ohlcv[ohlcv.length - 1];
        results.push({ stockCode: code, signal: signal.signal, strength: signal.strength, reason: signal.reason, priceAtScan: lastBar?.close });
        saveScreenerResult({ userId: ctx.user.id, runDate: today, stockCode: code, strategyId: input.strategyId, strategyName: strategy.meta.name, signal: signal.signal, strength: signal.strength, reason: signal.reason, priceAtScan: lastBar?.close }).catch(() => {});
      } catch { results.push({ stockCode: code, signal: "HOLD" as const, strength: 0, reason: "조회 실패", priceAtScan: 0 }); }
    }
    return results;
  }),

  runUniverse: protectedProcedure.input(z.object({
    maxQuoteScan: z.number().int().min(50).max(1000).default(600),
    maxOhlcvFetch: z.number().int().min(20).max(200).default(120),
    maxPerStrategy: z.number().int().min(1).max(30).default(10),
    strategyIds: z.array(z.string()).optional(),
    minPrice: z.number().min(0).default(DEFAULT_UNIVERSE_FILTERS.minPrice),
    minVolume: z.number().min(0).default(DEFAULT_UNIVERSE_FILTERS.minVolume),
    minAmount: z.number().min(0).default(DEFAULT_UNIVERSE_FILTERS.minAmount),
  })).mutation(async ({ ctx, input }) => {
    if (!checkRateLimit(`universe-screener:${ctx.user.id}`, 2, 60_000)) throw new Error("전체종목 스크리너 요청이 너무 많습니다. 1분 후 다시 시도해주세요.");
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) throw new Error("KIS API 연결이 필요합니다");
    return buildWholeMarketUniverse({
      client,
      maxQuoteScan: input.maxQuoteScan,
      maxOhlcvFetch: input.maxOhlcvFetch,
      maxPerStrategy: input.maxPerStrategy,
      strategyIds: input.strategyIds,
      filters: {
        ...DEFAULT_UNIVERSE_FILTERS,
        minPrice: input.minPrice,
        minVolume: input.minVolume,
        minAmount: input.minAmount,
      },
    });
  }),
});

// ─── Settings Router (Telegram) ───────────────────────────────────────────────
const settingsRouter = router({
  getTelegramSettings: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(telegramSettings).where(eq(telegramSettings.userId, ctx.user.id)).limit(1);
    if (!rows.length) return null;
    const s = rows[0];
    return {
      id: s.id, chatId: s.chatId, isEnabled: s.isEnabled,
      notifyOrder: s.notifyOrder, notifySignal: s.notifySignal, notifyError: s.notifyError,
      hasBotToken: !!s.encryptedBotToken,
    };
  }),

  saveTelegramSettings: protectedProcedure.input(z.object({
    botToken: z.string().optional(),
    chatId: z.string().min(1),
    isEnabled: z.boolean(),
    notifyOrder: z.boolean().default(true),
    notifySignal: z.boolean().default(true),
    notifyError: z.boolean().default(true),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const existing = await db.select().from(telegramSettings).where(eq(telegramSettings.userId, ctx.user.id)).limit(1);
    const encryptedBotToken = input.botToken ? encrypt(input.botToken) : (existing[0]?.encryptedBotToken || null);
    const data = {
      encryptedBotToken,
      chatId: input.chatId,
      isEnabled: input.isEnabled,
      notifyOrder: input.notifyOrder,
      notifySignal: input.notifySignal,
      notifyError: input.notifyError,
    };
    if (existing.length) {
      await db.update(telegramSettings).set(data).where(eq(telegramSettings.userId, ctx.user.id));
    } else {
      await db.insert(telegramSettings).values({ userId: ctx.user.id, ...data });
    }
    return { success: true };
  }),

  testTelegram: protectedProcedure.input(z.object({ botToken: z.string(), chatId: z.string() })).mutation(async ({ input }) => {
    return testTelegramConnection(input.botToken, input.chatId);
  }),
});

// ─── Performance Router ─────────────────────────────────────────────────────
const performanceRouter = router({
  // 전략별 성과 집계
  getStrategyStats: protectedProcedure.input(z.object({
    days: z.number().default(90),
  })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    const since = new Date(Date.now() - input.days * 86400_000);
    const allOrders = await db.select().from(orders)
      .where(and(eq(orders.userId, ctx.user.id), gte(orders.orderedAt, since)))
      .orderBy(orders.orderedAt);

    // 종목+전략별 매수-매도 페어링
    type Trade = { strategyId: string; stockCode: string; buyPrice: number; sellPrice: number; qty: number; holdDays: number; pnl: number; pnlRate: number; date: string };
    const trades: Trade[] = [];
    // 종목+전략별 매수 대기열
    const buyQueue = new Map<string, Array<{ price: number; qty: number; date: Date }>>(); // key: `${stockCode}_${strategyId}`

    for (const o of allOrders) {
      if (o.status === "cancelled" || o.status === "rejected") continue;
      const ep = Number(o.executedPrice || o.price || 0);
      const eq2 = o.executedQty || o.quantity;
      const sid = o.strategyId || "manual";
      const key = `${o.stockCode}_${sid}`;

      if (o.orderType === "buy") {
        const q = buyQueue.get(key) || [];
        q.push({ price: ep, qty: eq2, date: o.orderedAt });
        buyQueue.set(key, q);
      } else if (o.orderType === "sell") {
        const q = buyQueue.get(key) || [];
        let remaining = eq2;
        while (remaining > 0 && q.length > 0) {
          const buy = q[0];
          const matched = Math.min(remaining, buy.qty);
          const holdMs = o.orderedAt.getTime() - buy.date.getTime();
          const holdDays = Math.max(1, Math.round(holdMs / 86400_000));
          const pnl = (ep - buy.price) * matched;
          const pnlRate = buy.price > 0 ? ((ep - buy.price) / buy.price) * 100 : 0;
          trades.push({ strategyId: sid, stockCode: o.stockCode, buyPrice: buy.price, sellPrice: ep, qty: matched, holdDays, pnl, pnlRate, date: o.orderedAt.toISOString().slice(0, 10) });
          buy.qty -= matched;
          remaining -= matched;
          if (buy.qty <= 0) q.shift();
        }
        buyQueue.set(key, q);
      }
    }

    // 전략별 집계
    const statsMap = new Map<string, { strategyId: string; totalTrades: number; wins: number; totalPnl: number; totalPnlRate: number; avgHoldDays: number; maxDrawdown: number; trades: Trade[] }>();
    for (const t of trades) {
      const s = statsMap.get(t.strategyId) || { strategyId: t.strategyId, totalTrades: 0, wins: 0, totalPnl: 0, totalPnlRate: 0, avgHoldDays: 0, maxDrawdown: 0, trades: [] };
      s.totalTrades++;
      if (t.pnl > 0) s.wins++;
      s.totalPnl += t.pnl;
      s.totalPnlRate += t.pnlRate;
      s.avgHoldDays += t.holdDays;
      s.trades.push(t);
      statsMap.set(t.strategyId, s);
    }

    return Array.from(statsMap.values()).map(s => ({
      strategyId: s.strategyId,
      totalTrades: s.totalTrades,
      winRate: s.totalTrades > 0 ? Math.round((s.wins / s.totalTrades) * 100) : 0,
      totalPnl: Math.round(s.totalPnl),
      avgPnlRate: s.totalTrades > 0 ? parseFloat((s.totalPnlRate / s.totalTrades).toFixed(2)) : 0,
      avgHoldDays: s.totalTrades > 0 ? parseFloat((s.avgHoldDays / s.totalTrades).toFixed(1)) : 0,
      trades: s.trades.slice(-20), // 최근 20건
    }));
  }),

  // 일별 수익 곡선
  getDailyPnl: protectedProcedure.input(z.object({ days: z.number().default(90) })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    const since = new Date(Date.now() - input.days * 86400_000);
    const allOrders = await db.select().from(orders)
      .where(and(eq(orders.userId, ctx.user.id), gte(orders.orderedAt, since)))
      .orderBy(orders.orderedAt);
    return calculateDailyRealizedPnl(allOrders);
  }),

  // 종목별 성과
  getStockStats: protectedProcedure.input(z.object({ days: z.number().default(90) })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    const since = new Date(Date.now() - input.days * 86400_000);
    const allOrders = await db.select().from(orders)
      .where(and(eq(orders.userId, ctx.user.id), gte(orders.orderedAt, since)))
      .orderBy(orders.orderedAt);
    const stockMap = new Map<string, { stockCode: string; stockName: string; totalBuy: number; totalSell: number; qty: number }>();
    for (const o of allOrders) {
      if (o.status === "cancelled" || o.status === "rejected") continue;
      const ep = Number(o.executedPrice || o.price || 0);
      const eq2 = o.executedQty || o.quantity;
      const s = stockMap.get(o.stockCode) || { stockCode: o.stockCode, stockName: o.stockName || o.stockCode, totalBuy: 0, totalSell: 0, qty: 0 };
      if (o.orderType === "buy") { s.totalBuy += ep * eq2; s.qty += eq2; }
      else { s.totalSell += ep * eq2; s.qty -= eq2; }
      stockMap.set(o.stockCode, s);
    }
    return Array.from(stockMap.values()).map(s => ({
      stockCode: s.stockCode,
      stockName: s.stockName,
      realizedPnl: Math.round(s.totalSell - s.totalBuy),
      pnlRate: s.totalBuy > 0 ? parseFloat(((s.totalSell - s.totalBuy) / s.totalBuy * 100).toFixed(2)) : 0,
    })).sort((a, b) => b.realizedPnl - a.realizedPnl).slice(0, 20);
  }),
});

// ─── Optimizer Router ────────────────────────────────────────────────────────────
const optimizerRouter = router({
  getParamSpaces: protectedProcedure.query(() => {
    return Object.entries(STRATEGY_PARAM_SPACES).map(([id, ranges]) => ({ id, ranges }));
  }),

  runOptimization: protectedProcedure
    .input(z.object({
      strategyId: z.string(),
      stockCode: z.string().min(1).max(10),
      period: z.enum(["D", "W", "M"]).default("D"),
      initialCapital: z.number().min(100000).max(1000000000).default(10000000),
      stopLossPct: z.number().min(0).max(50).optional(),
      takeProfitPct: z.number().min(0).max(200).optional(),
      maxCombinations: z.number().min(10).max(500).default(150),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!checkRateLimit(`optimizer:${ctx.user.id}`, 2, 120_000)) {
        throw new Error("최적화 요청이 너무 많습니다. 2분 후 다시 시도해주세요.");
      }
      const client = await initKisClientForUser(ctx.user.id);
      if (!client) throw new Error("KIS API 연결이 필요합니다");
      const ohlcv = await client.getOHLCV(input.stockCode, input.period);
      if (ohlcv.length < 60) throw new Error("최적화에 필요한 데이터가 부족합니다 (최소 60바 필요)");
      return runGridSearch({
        strategyId: input.strategyId,
        ohlcv,
        stockCode: input.stockCode,
        period: input.period,
        initialCapital: input.initialCapital,
        stopLossPct: input.stopLossPct,
        takeProfitPct: input.takeProfitPct,
        maxCombinations: input.maxCombinations,
      });
    }),
});

// ─── News Router ────────────────────────────────────────────────────────────
const newsRouter = router({
  getStockNews: protectedProcedure
    .input(z.object({
      stockCode: z.string().min(1).max(10),
      stockName: z.string().optional().default(""),
      limit: z.number().min(5).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      if (!checkRateLimit(`news:${ctx.user.id}`, 20, 60_000)) {
        throw new Error("뉴스 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
      }
      return fetchStockNewsAndDisclosures(input.stockCode, input.stockName, input.limit);
    }),

  getMarketNews: protectedProcedure
    .input(z.object({ limit: z.number().min(5).max(30).default(15) }))
    .query(async ({ ctx, input }) => {
      if (!checkRateLimit(`news:market:${ctx.user.id}`, 10, 60_000)) {
        throw new Error("뉴스 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
      }
      // 시장 전반 뉴스 (코스피/코스닥)
      return fetchStockNewsAndDisclosures("005930", "삼성전자", input.limit);
    }),
});

// ─── App Router ───────────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    passwordStatus: publicProcedure.query(async () => {
      const state = await loadPasswordAuthState();
      return {
        configured: Boolean(state.passwordHash),
        mustChangePassword: state.mustChangePassword,
      } as const;
    }),
    login: publicProcedure
      .input(z.object({
        password: z.string().min(1),
        newPassword: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const state = await loadPasswordAuthState();
        const result = await evaluatePasswordLogin({
          password: input.password,
          newPassword: input.newPassword,
          passwordHash: state.passwordHash,
          mustChangePassword: state.mustChangePassword,
        });

        if (!result.ok) {
          return { success: false, reason: result.reason } as const;
        }

        if (result.passwordHash !== state.passwordHash || result.mustChangePassword !== state.mustChangePassword) {
          await savePasswordAuthState({
            passwordHash: result.passwordHash,
            mustChangePassword: result.mustChangePassword,
          });
        }

        const sessionToken = await sdk.createLocalAppSessionToken({ expiresInMs: ONE_YEAR_MS });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true, mustChangePassword: result.mustChangePassword } as const;
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  kis: kisRouter,
  watchlist: watchlistRouter,
  strategy: strategyRouter,
  autoTrader: autoTraderRouter,
  backtest: backtestRouter,
  screener: screenerRouter,
  settings: settingsRouter,
  performance: performanceRouter,
  news: newsRouter,
  optimizer: optimizerRouter,
});

export type AppRouter = typeof appRouter;
