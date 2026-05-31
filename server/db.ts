import { eq, desc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, kisSettings, watchlist, strategyConfigs, autoTraderConfig, orders, autoTraderLogs, telegramSettings, screenerResults, backtestResults } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── KIS Settings ─────────────────────────────────────────────────────────────

export async function getKisSettings(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(kisSettings).where(eq(kisSettings.userId, userId)).limit(1);
  return rows[0] || null;
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

export async function getWatchlist(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(watchlist).where(eq(watchlist.userId, userId)).orderBy(watchlist.sortOrder);
}

// ─── Strategy Configs ─────────────────────────────────────────────────────────

export async function getStrategyConfigs(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(strategyConfigs).where(eq(strategyConfigs.userId, userId));
}

// ─── Auto Trader Config ───────────────────────────────────────────────────────

export async function getAutoTraderConfig(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(autoTraderConfig).where(eq(autoTraderConfig.userId, userId)).limit(1);
  return rows[0] || null;
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function getRecentOrders(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.orderedAt)).limit(limit);
}

// ─── Auto Trader Logs ─────────────────────────────────────────────────────────

export async function getAutoTraderLogs(userId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(autoTraderLogs).where(eq(autoTraderLogs.userId, userId)).orderBy(desc(autoTraderLogs.createdAt)).limit(limit);
}

// ─── Telegram Settings ────────────────────────────────────────────────────────

export async function getTelegramSettings(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(telegramSettings).where(eq(telegramSettings.userId, userId)).limit(1);
  return rows[0] || null;
}

// ─── Screener Results ─────────────────────────────────────────────────────────

export async function getScreenerResults(userId: number, date?: string) {
  const db = await getDb();
  if (!db) return [];
  const today = date ?? new Date().toISOString().slice(0, 10);
  return db.select().from(screenerResults)
    .where(and(eq(screenerResults.userId, userId), eq(screenerResults.runDate, today)))
    .orderBy(desc(screenerResults.createdAt));
}

export async function saveScreenerResult(data: {
  userId: number;
  runDate: string;
  stockCode: string;
  stockName?: string;
  strategyId: string;
  strategyName?: string;
  signal: "BUY" | "SELL" | "HOLD";
  strength?: number;
  reason?: string;
  priceAtScan?: number;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(screenerResults).values({
    userId: data.userId,
    runDate: data.runDate,
    stockCode: data.stockCode,
    stockName: data.stockName,
    strategyId: data.strategyId,
    strategyName: data.strategyName,
    signal: data.signal,
    strength: data.strength?.toFixed(4) ?? "0",
    reason: data.reason,
    priceAtScan: data.priceAtScan?.toFixed(2),
    addedToWatchlist: false,
  });
}

export async function markScreenerAddedToWatchlist(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(screenerResults).set({ addedToWatchlist: true }).where(eq(screenerResults.id, id));
}

// ─── Backtest Results ─────────────────────────────────────────────────────────

export async function saveBacktestResult(data: {
  userId: number;
  batchId: string;
  stockCode: string;
  strategyId: string;
  strategyName?: string;
  period?: string;
  initialCapital: number;
  finalCapital: number;
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  resultJson?: unknown;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(backtestResults).values({
    userId: data.userId,
    batchId: data.batchId,
    stockCode: data.stockCode,
    strategyId: data.strategyId,
    strategyName: data.strategyName,
    period: data.period ?? "D",
    initialCapital: data.initialCapital.toFixed(2),
    finalCapital: data.finalCapital.toFixed(2),
    totalReturn: data.totalReturn.toFixed(4),
    annualizedReturn: data.annualizedReturn.toFixed(4),
    maxDrawdown: data.maxDrawdown.toFixed(4),
    sharpeRatio: data.sharpeRatio.toFixed(4),
    winRate: data.winRate.toFixed(4),
    totalTrades: data.totalTrades,
    winTrades: data.winTrades,
    lossTrades: data.lossTrades,
    stopLossPct: (data.stopLossPct ?? 0).toFixed(2),
    takeProfitPct: (data.takeProfitPct ?? 0).toFixed(2),
    resultJson: data.resultJson ?? null,
  });
}

export async function getBacktestResultsByBatch(batchId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(backtestResults)
    .where(eq(backtestResults.batchId, batchId))
    .orderBy(desc(backtestResults.totalReturn));
}

export async function getRecentBacktestBatches(userId: number, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  // Get distinct batchIds ordered by most recent
  const rows = await db.select({
    batchId: backtestResults.batchId,
    stockCode: backtestResults.stockCode,
    createdAt: backtestResults.createdAt,
  }).from(backtestResults)
    .where(eq(backtestResults.userId, userId))
    .orderBy(desc(backtestResults.createdAt))
    .limit(limit * 10); // over-fetch to deduplicate
  const seen = new Set<string>();
  const unique: typeof rows = [];
  for (const row of rows) {
    if (row.batchId && !seen.has(row.batchId)) {
      seen.add(row.batchId);
      unique.push(row);
      if (unique.length >= limit) break;
    }
  }
  return unique;
}
