import { eq, desc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, kisSettings, watchlist, strategyConfigs, autoTraderConfig, orders, autoTraderLogs, telegramSettings } from "../drizzle/schema";
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
