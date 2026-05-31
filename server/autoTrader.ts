/**
 * Auto Trading Scheduler
 * Cycle: Pre-market stock selection → Intraday signal detection → Auto order execution
 */

import { getDb } from "./db";
import {
  autoTraderConfig,
  autoTraderLogs,
  kisSettings,
  strategyConfigs,
  watchlist,
  orders,
} from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { KisApiClient, getKisClient } from "./kisApi";
import { decrypt } from "./crypto";
import { getSelectionStrategy, getTradingStrategy } from "./strategies/index";
import { sendTelegramMessage } from "./telegram";

// ─── Logger ──────────────────────────────────────────────────────────────────

async function log(
  userId: number,
  level: "info" | "warn" | "error" | "signal",
  message: string,
  stockCode?: string,
  strategyId?: string,
  data?: unknown
) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(autoTraderLogs).values({
      userId,
      level,
      message,
      stockCode,
      strategyId,
      data: data as Record<string, unknown> | null,
    });
    console.log(`[AutoTrader][${level.toUpperCase()}] ${message}`);
  } catch (err) {
    console.error("[AutoTrader] Log error:", err);
  }
}

// ─── KIS Client Factory ───────────────────────────────────────────────────────

export async function initKisClientForUser(userId: number): Promise<KisApiClient | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(kisSettings).where(
    and(eq(kisSettings.userId, userId), eq(kisSettings.isActive, true))
  ).limit(1);

  if (!rows.length) return null;
  const setting = rows[0];

  const appKey = decrypt(setting.encryptedAppKey || "");
  const appSecret = decrypt(setting.encryptedAppSecret || "");
  if (!appKey || !appSecret) return null;

  const client = new KisApiClient({
    appKey,
    appSecret,
    accountNo: setting.accountNo || "",
    accountProduct: setting.accountProduct || "01",
    mode: setting.mode,
  });

  // Check token validity
  if (setting.accessToken && setting.tokenExpiredAt && new Date() < new Date(setting.tokenExpiredAt.getTime() - 60_000)) {
    client.setToken(setting.accessToken, setting.tokenExpiredAt);
  } else {
    // Refresh token
    try {
      const tokenRes = await client.getAccessToken();
      const expiredAt = new Date(Date.now() + tokenRes.expires_in * 1000);
      client.setToken(tokenRes.access_token, expiredAt);
      await db.update(kisSettings).set({
        accessToken: tokenRes.access_token,
        tokenExpiredAt: expiredAt,
      }).where(eq(kisSettings.id, setting.id));
    } catch (err) {
      console.error("[AutoTrader] Token refresh failed:", err);
      return null;
    }
  }

  return client;
}

// ─── Auto Trading Cycle ───────────────────────────────────────────────────────

export async function runAutoTradingCycle(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Check if auto trading is enabled
  const configs = await db.select().from(autoTraderConfig).where(eq(autoTraderConfig.userId, userId)).limit(1);
  if (!configs.length || !configs[0].isRunning) return;

  const config = configs[0];
  await log(userId, "info", "자동매매 사이클 시작");

  // Get KIS client
  const client = await initKisClientForUser(userId);
  if (!client) {
    await log(userId, "error", "KIS API 클라이언트 초기화 실패 - API 키를 확인하세요");
    await sendTelegramMessage(userId, "error", "KIS API 클라이언트 초기화 실패 - API 키를 확인하세요");
    return;
  }

  // Get strategy configs
  const selectionConfig = config.selectionStrategyId
    ? (await db.select().from(strategyConfigs).where(eq(strategyConfigs.id, config.selectionStrategyId)).limit(1))[0]
    : null;
  const tradingConfig = config.tradingStrategyId
    ? (await db.select().from(strategyConfigs).where(eq(strategyConfigs.id, config.tradingStrategyId)).limit(1))[0]
    : null;

  if (!selectionConfig || !tradingConfig) {
    await log(userId, "warn", "전략이 설정되지 않았습니다");
    return;
  }

  const selectionStrategy = getSelectionStrategy(selectionConfig.strategyId);
  const tradingStrategy = getTradingStrategy(tradingConfig.strategyId);

  if (!selectionStrategy || !tradingStrategy) {
    await log(userId, "error", `전략을 찾을 수 없습니다: ${selectionConfig.strategyId}, ${tradingConfig.strategyId}`);
    return;
  }

  // Get watchlist
  const watchlistItems = await db.select().from(watchlist).where(
    and(eq(watchlist.userId, userId), eq(watchlist.isAutoTrading, true))
  );

  if (!watchlistItems.length) {
    await log(userId, "info", "자동매매 대상 관심종목이 없습니다");
    return;
  }

  // Fetch OHLCV for all watchlist items
  const candidates: Array<{ code: string; ohlcv: Awaited<ReturnType<KisApiClient["getOHLCV"]>> }> = [];
  for (const item of watchlistItems) {
    try {
      const ohlcv = await client.getOHLCV(item.stockCode, "D");
      candidates.push({ code: item.stockCode, ohlcv });
    } catch (err) {
      await log(userId, "warn", `${item.stockCode} OHLCV 조회 실패`, item.stockCode);
    }
  }

  // Run selection strategy
  const selectionParams = (selectionConfig.params as Record<string, number | string | boolean>) || selectionStrategy.meta.defaultParams;
  const selected = selectionStrategy.select(candidates, selectionParams);
  await log(userId, "info", `종목 선정 완료: ${selected.length}개 선정`, undefined, selectionConfig.strategyId);

  // Run trading strategy for each selected stock
  const tradingParams = (tradingConfig.params as Record<string, number | string | boolean>) || tradingStrategy.meta.defaultParams;
  const maxPositions = config.maxPositions || 5;
  const maxOrderAmount = Number(config.maxOrderAmount) || 1_000_000;

  for (const result of selected.slice(0, maxPositions)) {
    const candidate = candidates.find(c => c.code === result.stockCode);
    if (!candidate) continue;

    const signal = tradingStrategy.evaluate(candidate.ohlcv, tradingParams);

    if (signal.signal === "HOLD") continue;

    await log(
      userId,
      "signal",
      `${result.stockCode} ${signal.signal} 신호 (강도: ${(signal.strength * 100).toFixed(0)}%) - ${signal.reason}`,
      result.stockCode,
      tradingConfig.strategyId,
      signal
    );

    await sendTelegramMessage(
      userId,
      "signal",
      `📊 *${result.stockCode}* ${signal.signal === "BUY" ? "🟢 매수" : "🔴 매도"} 신호\n\n` +
      `강도: ${(signal.strength * 100).toFixed(0)}%\n` +
      `사유: ${signal.reason}\n` +
      `전략: ${tradingStrategy.meta.name}`
    );

    // Execute order
    if (signal.signal === "BUY" && signal.strength >= 0.6) {
      try {
        const currentPrice = candidate.ohlcv[candidate.ohlcv.length - 1].close;
        const quantity = Math.floor(maxOrderAmount / currentPrice);
        if (quantity < 1) continue;

        const orderResult = await client.placeOrder(result.stockCode, "buy", quantity, currentPrice, "market");

        // Save order to DB
        const stockItem = watchlistItems.find(w => w.stockCode === result.stockCode);
        await db.insert(orders).values({
          userId,
          stockCode: result.stockCode,
          stockName: stockItem?.stockName || result.stockCode,
          orderType: "buy",
          priceType: "market",
          quantity,
          price: String(currentPrice),
          status: orderResult.success ? "pending" : "rejected",
          kisOrderNo: orderResult.orderNo,
          strategyId: tradingConfig.strategyId,
          isAutoOrder: true,
          errorMsg: orderResult.success ? null : orderResult.message,
        });

        if (orderResult.success) {
          await sendTelegramMessage(userId, "order",
            `✅ *매수 주문 접수*\n\n종목: ${result.stockCode}\n수량: ${quantity}주\n주문번호: ${orderResult.orderNo}`
          );
          await log(userId, "info", `매수 주문 접수: ${result.stockCode} ${quantity}주`, result.stockCode);
        } else {
          await sendTelegramMessage(userId, "error", `❌ 매수 주문 실패: ${result.stockCode}\n사유: ${orderResult.message}`);
          await log(userId, "error", `매수 주문 실패: ${orderResult.message}`, result.stockCode);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await log(userId, "error", `주문 처리 오류: ${message}`, result.stockCode);
      }
    } else if (signal.signal === "SELL" && signal.strength >= 0.5) {
      // Auto SELL: check if we hold this stock
      try {
        const balance = await client.getBalance();
        const holding = balance.holdings.find(h => h.stockCode === result.stockCode);
        if (!holding || holding.holdQty <= 0) continue;

        const currentPrice = candidate.ohlcv[candidate.ohlcv.length - 1].close;
        const orderResult = await client.placeOrder(result.stockCode, "sell", holding.holdQty, currentPrice, "market");

        const stockItem = watchlistItems.find(w => w.stockCode === result.stockCode);
        await db.insert(orders).values({
          userId,
          stockCode: result.stockCode,
          stockName: stockItem?.stockName || result.stockCode,
          orderType: "sell",
          priceType: "market",
          quantity: holding.holdQty,
          price: String(currentPrice),
          status: orderResult.success ? "pending" : "rejected",
          kisOrderNo: orderResult.orderNo,
          strategyId: tradingConfig.strategyId,
          isAutoOrder: true,
          errorMsg: orderResult.success ? null : orderResult.message,
        });

        if (orderResult.success) {
          await sendTelegramMessage(userId, "order",
            `✅ *매도 주문 접수*\n\n종목: ${result.stockCode}\n수량: ${holding.holdQty}주\n사유: ${signal.reason}\n주문번호: ${orderResult.orderNo}`
          );
          await log(userId, "info", `매도 주문 접수: ${result.stockCode} ${holding.holdQty}주`, result.stockCode);
        } else {
          await sendTelegramMessage(userId, "error", `❌ 매도 주문 실패: ${result.stockCode}\n사유: ${orderResult.message}`);
          await log(userId, "error", `매도 주문 실패: ${orderResult.message}`, result.stockCode);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await log(userId, "error", `매도 주문 처리 오류: ${message}`, result.stockCode);
      }
    }
  }

  await log(userId, "info", "자동매매 사이클 완료");
}

// ─── Heartbeat Handler (called by periodic scheduler) ────────────────────────

export async function heartbeatHandler(userId: number): Promise<void> {
  try {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const day = now.getDay(); // 0=Sun, 6=Sat

    // Only run on weekdays (Mon-Fri) during market hours (09:00-15:30 KST)
    if (day === 0 || day === 6) return;
    if (hour < 9 || hour > 15) return;
    if (hour === 15 && minute > 30) return;

    await runAutoTradingCycle(userId);
  } catch (err) {
    console.error("[AutoTrader] Heartbeat error:", err);
  }
}
