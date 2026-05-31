import { eq, and, desc } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  kisSettings, watchlist, strategyConfigs, autoTraderConfig,
  orders, autoTraderLogs, telegramSettings,
} from "../drizzle/schema";
import { encrypt, decrypt } from "./crypto";
import { KisApiClient, setKisClient } from "./kisApi";
import { getAllStrategyMeta } from "./strategies/index";
import { sendTelegramMessage, testTelegramConnection } from "./telegram";
import { initKisClientForUser } from "./autoTrader";
import { createHeartbeatJob, deleteHeartbeatJob } from "./_core/heartbeat";
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
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(kisSettings).where(eq(kisSettings.userId, ctx.user.id)).limit(1);
    if (!rows.length) return null;
    const s = rows[0];
    return {
      id: s.id, mode: s.mode, accountNo: s.accountNo, accountProduct: s.accountProduct,
      isActive: s.isActive, tokenExpiredAt: s.tokenExpiredAt,
      hasAppKey: !!s.encryptedAppKey, hasAppSecret: !!s.encryptedAppSecret,
    };
  }),

  saveSettings: protectedProcedure.input(z.object({
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

    const existing = await db.select().from(kisSettings).where(eq(kisSettings.userId, ctx.user.id)).limit(1);
    if (existing.length) {
      await db.update(kisSettings).set({
        encryptedAppKey, encryptedAppSecret,
        accountNo: input.accountNo, accountProduct: input.accountProduct,
        mode: input.mode, isActive: false, accessToken: null, tokenExpiredAt: null,
      }).where(eq(kisSettings.userId, ctx.user.id));
    } else {
      await db.insert(kisSettings).values({
        userId: ctx.user.id, encryptedAppKey, encryptedAppSecret,
        accountNo: input.accountNo, accountProduct: input.accountProduct,
        mode: input.mode,
      });
    }
    return { success: true };
  }),

  connect: protectedProcedure.mutation(async ({ ctx }) => {
    if (!checkRateLimit(`kis-connect-${ctx.user.id}`, 5, 60_000)) {
      throw new Error("요청이 너무 많습니다. 잠시 후 다시 시도하세요.");
    }
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const rows = await db.select().from(kisSettings).where(eq(kisSettings.userId, ctx.user.id)).limit(1);
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

    await db.update(kisSettings).set({
      accessToken: tokenRes.access_token, tokenExpiredAt: expiredAt, isActive: true,
    }).where(eq(kisSettings.userId, ctx.user.id));

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
    quantity: z.number().int().positive(),
    price: z.number().optional(),
  })).mutation(async ({ ctx, input }) => {
    if (!checkRateLimit(`order-${ctx.user.id}`, 10, 60_000)) throw new Error("Rate limit exceeded");
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) throw new Error("KIS API 연결이 필요합니다");

    const result = await client.placeOrder(
      input.stockCode, input.orderType, input.quantity,
      input.price || 0, input.priceType
    );

    const db = await getDb();
    if (db) {
      await db.insert(orders).values({
        userId: ctx.user.id,
        stockCode: input.stockCode,
        stockName: input.stockName,
        orderType: input.orderType,
        priceType: input.priceType,
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
    const client = await initKisClientForUser(ctx.user.id);
    if (!client) return [];
    return client.searchStock(input.keyword);
  }),

  getOrderHistory: protectedProcedure.input(z.object({ limit: z.number().default(50) })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(orders).where(eq(orders.userId, ctx.user.id)).orderBy(desc(orders.orderedAt)).limit(input.limit);
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
    stopLossPct: z.number().min(0).max(50).default(3),
    takeProfitPct: z.number().min(0).max(100).default(5),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const existing = await db.select().from(autoTraderConfig).where(eq(autoTraderConfig.userId, ctx.user.id)).limit(1);
    const data = {
      selectionStrategyId: input.selectionStrategyId ?? null,
      tradingStrategyId: input.tradingStrategyId ?? null,
      maxPositions: input.maxPositions,
      maxOrderAmount: String(input.maxOrderAmount),
      stopLossPct: String(input.stopLossPct),
      takeProfitPct: String(input.takeProfitPct),
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
          cron: "0 */5 9-15 * * 1-5", // every 5 min, Mon-Fri, 09-15 KST
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

// ─── App Router ───────────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
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
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
