/**
 * Auto Trading Scheduler
 * Cycle: Pre-market stock selection → Intraday signal detection → Auto order execution
 */

import { getDb, saveScreenerResult } from "./db";
import {
  autoTraderConfig,
  autoTraderLogs,
  kisSettings,
  strategyConfigs,
  watchlist,
  orders,
  autoPositionStates,
} from "../drizzle/schema";
import { eq, and, isNull } from "drizzle-orm";
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

export async function initKisClientForUser(userId: number, accountProfileId?: number | null): Promise<KisApiClient | null> {
  const db = await getDb();
  if (!db) return null;

  let rows;
  if (accountProfileId) {
    // 특정 계좌 프로필 사용
    rows = await db.select().from(kisSettings).where(
      and(eq(kisSettings.userId, userId), eq(kisSettings.id, accountProfileId))
    ).limit(1);
  } else {
    // 기본 활성 계좌 사용
    rows = await db.select().from(kisSettings).where(
      and(eq(kisSettings.userId, userId), eq(kisSettings.isActive, true))
    ).limit(1);
  }

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

// ─── Capital / Risk Management ───────────────────────────────────────────────

export function calculateRiskManagedOrderQuantity(params: {
  currentPrice: number;
  accountEval: number;
  currentExposure: number;
  maxOrderAmount: number;
  entryCashPct: number;
  riskPerTradePct: number;
  stopLossPct: number;
  maxPortfolioExposurePct: number;
}): {
  quantity: number;
  orderBudget: number;
  reason?: string;
  limits: {
    maxOrderAmount: number;
    entryAllocationAmount: number;
    riskBudgetAmount: number;
    remainingExposureAmount: number;
  };
} {
  const currentPrice = Math.max(0, params.currentPrice);
  const accountEval = Math.max(0, params.accountEval);
  const currentExposure = Math.max(0, params.currentExposure);
  const maxOrderAmount = Math.max(0, params.maxOrderAmount);
  const entryCashPct = Math.min(Math.max(params.entryCashPct || 10, 1), 100);
  const riskPerTradePct = Math.min(Math.max(params.riskPerTradePct || 0, 0), 10);
  const stopLossPct = Math.min(Math.max(params.stopLossPct || 0, 0), 50);
  const maxPortfolioExposurePct = Math.min(Math.max(params.maxPortfolioExposurePct || 50, 1), 100);

  const entryAllocationAmount = accountEval > 0 ? accountEval * entryCashPct / 100 : maxOrderAmount;
  const riskBudgetAmount = accountEval > 0 && riskPerTradePct > 0 && stopLossPct > 0
    ? accountEval * riskPerTradePct / stopLossPct
    : Number.POSITIVE_INFINITY;
  const maxExposureAmount = accountEval > 0 ? accountEval * maxPortfolioExposurePct / 100 : Number.POSITIVE_INFINITY;
  const remainingExposureAmount = Math.max(0, maxExposureAmount - currentExposure);

  const finiteRiskBudget = Number.isFinite(riskBudgetAmount) ? riskBudgetAmount : maxOrderAmount;
  const orderBudget = Math.max(0, Math.min(maxOrderAmount, entryAllocationAmount, riskBudgetAmount, remainingExposureAmount));

  if (currentPrice <= 0) {
    return {
      quantity: 0,
      orderBudget: 0,
      reason: "현재가가 유효하지 않습니다",
      limits: { maxOrderAmount, entryAllocationAmount, riskBudgetAmount: finiteRiskBudget, remainingExposureAmount },
    };
  }

  if (remainingExposureAmount <= 0) {
    return {
      quantity: 0,
      orderBudget: 0,
      reason: "포트폴리오 노출 한도에 도달했습니다",
      limits: { maxOrderAmount, entryAllocationAmount, riskBudgetAmount: finiteRiskBudget, remainingExposureAmount },
    };
  }

  return {
    quantity: Math.floor(orderBudget / currentPrice),
    orderBudget,
    limits: { maxOrderAmount, entryAllocationAmount, riskBudgetAmount: finiteRiskBudget, remainingExposureAmount },
  };
}

export type ExitActionKind = "stop_loss" | "take_profit" | "trailing_stop" | "partial_take_profit" | "break_even_stop";

export function evaluatePositionExit(params: {
  stockCode: string;
  holdQty: number;
  avgPrice: number;
  currentPrice: number;
  previousHighPrice?: number | null;
  stopLossPct: number;
  takeProfitPct: number;
  trailingStopPct: number;
  partialTakeProfitPct: number;
  partialTakeProfitSellPct: number;
  breakEvenTriggerPct: number;
  breakEvenBufferPct: number;
  partialTakeProfitExecuted: boolean;
}): {
  updatedHighPrice: number;
  pnlPct: number;
  action: {
    kind: ExitActionKind;
    quantity: number;
    reason: string;
    strategyId: string;
  } | null;
} {
  const holdQty = Math.max(0, Math.floor(params.holdQty));
  const avgPrice = Math.max(0, params.avgPrice);
  const currentPrice = Math.max(0, params.currentPrice);
  const previousHighPrice = Math.max(0, params.previousHighPrice || 0);
  const updatedHighPrice = Math.max(previousHighPrice, currentPrice);
  const pnlPct = avgPrice > 0 ? (currentPrice - avgPrice) / avgPrice * 100 : 0;

  if (holdQty <= 0 || avgPrice <= 0 || currentPrice <= 0) {
    return { updatedHighPrice, pnlPct, action: null };
  }

  const stopLossPct = Math.max(0, params.stopLossPct || 0);
  const takeProfitPct = Math.max(0, params.takeProfitPct || 0);
  const trailingStopPct = Math.max(0, params.trailingStopPct || 0);
  const partialTakeProfitPct = Math.max(0, params.partialTakeProfitPct || 0);
  const partialTakeProfitSellPct = Math.min(Math.max(params.partialTakeProfitSellPct || 0, 0), 100);
  const breakEvenTriggerPct = Math.max(0, params.breakEvenTriggerPct || 0);
  const breakEvenBufferPct = Math.max(0, params.breakEvenBufferPct || 0);

  if (stopLossPct > 0 && pnlPct <= -stopLossPct) {
    return {
      updatedHighPrice,
      pnlPct,
      action: {
        kind: "stop_loss",
        quantity: holdQty,
        reason: `손절 청산 (수익률: ${pnlPct.toFixed(2)}%, 기준: -${stopLossPct}%)`,
        strategyId: "stop_loss_take_profit",
      },
    };
  }

  if (takeProfitPct > 0 && pnlPct >= takeProfitPct) {
    return {
      updatedHighPrice,
      pnlPct,
      action: {
        kind: "take_profit",
        quantity: holdQty,
        reason: `익절 청산 (수익률: +${pnlPct.toFixed(2)}%, 기준: +${takeProfitPct}%)`,
        strategyId: "stop_loss_take_profit",
      },
    };
  }

  if (trailingStopPct > 0 && updatedHighPrice > avgPrice) {
    const drawdownFromHighPct = (updatedHighPrice - currentPrice) / updatedHighPrice * 100;
    if (drawdownFromHighPct >= trailingStopPct) {
      return {
        updatedHighPrice,
        pnlPct,
        action: {
          kind: "trailing_stop",
          quantity: holdQty,
          reason: `트레일링 스탑 청산 (고점: ${updatedHighPrice.toLocaleString()}원, 현재가: ${currentPrice.toLocaleString()}원, 하락폭: -${drawdownFromHighPct.toFixed(2)}%, 기준: -${trailingStopPct}%)`,
          strategyId: "trailing_stop",
        },
      };
    }
  }

  if (breakEvenTriggerPct > 0 && updatedHighPrice >= avgPrice * (1 + breakEvenTriggerPct / 100)) {
    const breakEvenStopPrice = avgPrice * (1 + breakEvenBufferPct / 100);
    if (currentPrice <= breakEvenStopPrice) {
      return {
        updatedHighPrice,
        pnlPct,
        action: {
          kind: "break_even_stop",
          quantity: holdQty,
          reason: `본전 스탑 청산 (최고 수익률: ${((updatedHighPrice - avgPrice) / avgPrice * 100).toFixed(2)}%, 방어가: ${breakEvenStopPrice.toFixed(0)}원)`,
          strategyId: "break_even_stop",
        },
      };
    }
  }

  if (!params.partialTakeProfitExecuted && partialTakeProfitPct > 0 && partialTakeProfitSellPct > 0 && pnlPct >= partialTakeProfitPct) {
    const quantity = Math.max(1, Math.floor(holdQty * partialTakeProfitSellPct / 100));
    return {
      updatedHighPrice,
      pnlPct,
      action: {
        kind: "partial_take_profit",
        quantity: Math.min(holdQty, quantity),
        reason: `부분익절 청산 (수익률: +${pnlPct.toFixed(2)}%, 기준: +${partialTakeProfitPct}%, 매도비중: ${partialTakeProfitSellPct}%)`,
        strategyId: "partial_take_profit",
      },
    };
  }

  return { updatedHighPrice, pnlPct, action: null };
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

  // Get KIS client (accountProfileId가 설정된 경우 해당 계좌 사용)
  const client = await initKisClientForUser(userId, config.accountProfileId);
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

  // ─── Phase 0: Risk exits on ALL holdings ────────────────────────────────────
  const stopLossPct = Number(config.stopLossPct) || 0;
  const takeProfitPct = Number(config.takeProfitPct) || 0;
  const trailingStopPct = Number(config.trailingStopPct) || 0;
  const partialTakeProfitPct = Number(config.partialTakeProfitPct) || 0;
  const partialTakeProfitSellPct = Number(config.partialTakeProfitSellPct) || 50;
  const breakEvenTriggerPct = Number(config.breakEvenTriggerPct) || 0;
  const breakEvenBufferPct = Number(config.breakEvenBufferPct) || 0;
  let latestBalance: Awaited<ReturnType<KisApiClient["getBalance"]>> | null = null;

  const getLatestBalance = async () => {
    if (!latestBalance) latestBalance = await client.getBalance();
    return latestBalance;
  };

  const hasExitRules = stopLossPct > 0 || takeProfitPct > 0 || trailingStopPct > 0 ||
    partialTakeProfitPct > 0 || breakEvenTriggerPct > 0;

  if (hasExitRules) {
    try {
      const balance = await getLatestBalance();
      for (const holding of balance.holdings) {
        if (holding.holdQty <= 0) continue;

        const avgPrice = holding.avgPrice || 0;
        const currentPrice = holding.currentPrice || 0;
        if (avgPrice <= 0 || currentPrice <= 0) continue;

        const existingState = (await db.select().from(autoPositionStates).where(
          and(
            eq(autoPositionStates.userId, userId),
            eq(autoPositionStates.stockCode, holding.stockCode),
            config.accountProfileId == null
              ? isNull(autoPositionStates.accountProfileId)
              : eq(autoPositionStates.accountProfileId, config.accountProfileId)
          )
        ).limit(1))[0];

        const storedAvgPrice = existingState?.avgPrice ? Number(existingState.avgPrice) : null;
        const storedQty = Number(existingState?.lastQty || 0);
        const shouldResetPositionState = Boolean(existingState) && (
          holding.holdQty > storedQty ||
          (storedAvgPrice !== null && avgPrice > 0 && Math.abs(storedAvgPrice - avgPrice) / avgPrice > 0.001 && holding.holdQty >= storedQty)
        );

        const exitDecision = evaluatePositionExit({
          stockCode: holding.stockCode,
          holdQty: holding.holdQty,
          avgPrice,
          currentPrice,
          previousHighPrice: shouldResetPositionState ? null : (existingState?.highPrice ? Number(existingState.highPrice) : null),
          stopLossPct,
          takeProfitPct,
          trailingStopPct,
          partialTakeProfitPct,
          partialTakeProfitSellPct,
          breakEvenTriggerPct,
          breakEvenBufferPct,
          partialTakeProfitExecuted: shouldResetPositionState ? false : Boolean(existingState?.partialTakeProfitExecuted),
        });

        const stateData = {
          highPrice: String(exitDecision.updatedHighPrice),
          avgPrice: String(avgPrice),
          partialTakeProfitExecuted: shouldResetPositionState ? false : Boolean(existingState?.partialTakeProfitExecuted),
          lastQty: holding.holdQty,
        };
        if (existingState) {
          await db.update(autoPositionStates).set(stateData).where(eq(autoPositionStates.id, existingState.id));
        } else {
          await db.insert(autoPositionStates).values({
            userId,
            stockCode: holding.stockCode,
            accountProfileId: config.accountProfileId ?? null,
            ...stateData,
          });
        }

        if (!exitDecision.action) continue;

        await log(userId, "signal", `${holding.stockCode} ${exitDecision.action.reason}`, holding.stockCode, exitDecision.action.strategyId, exitDecision);

        const orderResult = await client.placeOrder(
          holding.stockCode, "sell", exitDecision.action.quantity, currentPrice, "market"
        );

        const watchlistItem = (await db.select().from(watchlist)
          .where(and(eq(watchlist.userId, userId), eq(watchlist.stockCode, holding.stockCode)))
          .limit(1))[0];

        await db.insert(orders).values({
          userId,
          stockCode: holding.stockCode,
          stockName: watchlistItem?.stockName || holding.stockCode,
          orderType: "sell",
          priceType: "market",
          quantity: exitDecision.action.quantity,
          price: String(currentPrice),
          status: orderResult.success ? "pending" : "rejected",
          kisOrderNo: orderResult.orderNo,
          strategyId: exitDecision.action.strategyId,
          accountProfileId: config.accountProfileId ?? null,
          isAutoOrder: true,
          errorMsg: orderResult.success ? null : orderResult.message,
        });

        if (orderResult.success) {
          if (exitDecision.action.kind === "partial_take_profit") {
            const refreshedState = (await db.select().from(autoPositionStates).where(
              and(
                eq(autoPositionStates.userId, userId),
                eq(autoPositionStates.stockCode, holding.stockCode),
                config.accountProfileId == null
                  ? isNull(autoPositionStates.accountProfileId)
                  : eq(autoPositionStates.accountProfileId, config.accountProfileId)
              )
            ).limit(1))[0];
            if (refreshedState) {
              await db.update(autoPositionStates).set({ partialTakeProfitExecuted: true }).where(eq(autoPositionStates.id, refreshedState.id));
            }
          }

          await sendTelegramMessage(userId, "order",
            `✅ *자동 청산 주문 접수*\n\n` +
            `종목: ${holding.stockCode}\n` +
            `수량: ${exitDecision.action.quantity}주\n` +
            `평단가: ${avgPrice.toLocaleString()}원\n` +
            `현재가: ${currentPrice.toLocaleString()}원\n` +
            `수익률: ${exitDecision.pnlPct >= 0 ? "+" : ""}${exitDecision.pnlPct.toFixed(2)}%\n` +
            `사유: ${exitDecision.action.reason}`
          );
          await log(userId, "info", `자동 청산 주문 접수: ${holding.stockCode} ${exitDecision.action.quantity}주 (${exitDecision.action.kind})`, holding.stockCode);
        } else {
          await sendTelegramMessage(userId, "error",
            `❌ 자동 청산 실패: ${holding.stockCode}\n사유: ${orderResult.message}`
          );
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await log(userId, "error", `자동 청산 체크 오류: ${message}`);
    }
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
  const entryCashPct = Number(config.entryCashPct) || 10;
  const riskPerTradePct = Number(config.riskPerTradePct) || 1;
  const maxPortfolioExposurePct = Number(config.maxPortfolioExposurePct) || 50;
  const today = new Date().toISOString().slice(0, 10);

  for (const result of selected.slice(0, maxPositions)) {
    const candidate = candidates.find(c => c.code === result.stockCode);
    if (!candidate) continue;

    const signal = tradingStrategy.evaluate(candidate.ohlcv, tradingParams);
    const lastBar = candidate.ohlcv[candidate.ohlcv.length - 1];
    const stockItem = watchlistItems.find(w => w.stockCode === result.stockCode);

    // Save screener result to DB
    await saveScreenerResult({
      userId,
      runDate: today,
      stockCode: result.stockCode,
      stockName: stockItem?.stockName || result.stockCode,
      strategyId: tradingConfig.strategyId,
      strategyName: tradingStrategy.meta.name,
      signal: signal.signal,
      strength: signal.strength,
      reason: signal.reason,
      priceAtScan: lastBar?.close,
    }).catch(() => {}); // non-blocking

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
        const balance = await getLatestBalance();
        const currentExposure = balance.holdings.reduce((sum, holding) => sum + Math.max(0, holding.evalAmount || 0), 0);
        const positionSize = calculateRiskManagedOrderQuantity({
          currentPrice,
          accountEval: balance.totalEval,
          currentExposure,
          maxOrderAmount,
          entryCashPct,
          riskPerTradePct,
          stopLossPct,
          maxPortfolioExposurePct,
        });
        const quantity = positionSize.quantity;
        if (quantity < 1) {
          await log(
            userId,
            "warn",
            `${result.stockCode} 매수 보류: ${positionSize.reason || "자금관리 한도 내 주문 가능 수량 없음"}`,
            result.stockCode,
            tradingConfig.strategyId,
            positionSize
          );
          continue;
        }

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
          accountProfileId: config.accountProfileId ?? null,
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
          accountProfileId: config.accountProfileId ?? null,
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
