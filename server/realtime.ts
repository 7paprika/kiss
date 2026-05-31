/**
 * Realtime WebSocket Bridge
 * KIS WebSocket (실시간 시세) → Socket.IO → 프론트엔드
 *
 * 구조:
 *   1. 프론트엔드가 Socket.IO로 연결 후 subscribe(stockCode) 이벤트 전송
 *   2. 서버가 KIS WebSocket에 해당 종목 구독 요청
 *   3. KIS에서 수신된 시세 데이터를 Socket.IO로 브로드캐스트
 */

import { Server as SocketIOServer, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { getDb } from "./db";
import { kisSettings } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "./crypto";
import { getKisClient, KisApiClient } from "./kisApi";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RealtimeQuote {
  stockCode: string;
  currentPrice: number;
  changePrice: number;
  changeRate: number;
  volume: number;
  tradingValue: number;
  high: number;
  low: number;
  open: number;
  timestamp: number;
}

export interface RealtimeTrade {
  stockCode: string;
  price: number;
  quantity: number;
  side: "buy" | "sell";
  timestamp: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

let io: SocketIOServer | null = null;

// Map: userId → Set of subscribed stockCodes
const userSubscriptions = new Map<number, Set<string>>();

// Map: stockCode → Set of userIds watching
const stockWatchers = new Map<string, Set<number>>();

// Map: userId → KIS WS connection
const kisWsConnections = new Map<number, KisApiClient>();

// Polling fallback: Map stockCode → interval
const pollingIntervals = new Map<string, ReturnType<typeof setInterval>>();

// ─── Socket.IO Server Setup ───────────────────────────────────────────────────

export function setupRealtimeServer(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    path: "/api/socket.io",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[Realtime] Client connected: ${socket.id}`);
    let userId: number | null = null;

    // Authenticate via userId passed from client
    socket.on("auth", (data: { userId: number }) => {
      userId = data.userId;
      socket.join(`user:${userId}`);
      console.log(`[Realtime] User ${userId} authenticated on socket ${socket.id}`);
      socket.emit("auth:ok", { userId });
    });

    // Subscribe to stock realtime quotes
    socket.on("subscribe", async (data: { stockCode: string }) => {
      if (!userId) { socket.emit("error", { message: "인증이 필요합니다" }); return; }
      const code = data.stockCode?.trim().toUpperCase();
      if (!code) return;

      // Track subscription
      if (!userSubscriptions.has(userId)) userSubscriptions.set(userId, new Set());
      userSubscriptions.get(userId)!.add(code);

      if (!stockWatchers.has(code)) stockWatchers.set(code, new Set());
      stockWatchers.get(code)!.add(userId);

      // Join room for this stock
      socket.join(`stock:${code}`);
      console.log(`[Realtime] User ${userId} subscribed to ${code}`);

      // Start polling for this stock (fallback since KIS WS requires approval key)
      startPollingForStock(code, userId);

      socket.emit("subscribed", { stockCode: code });
    });

    // Unsubscribe from stock
    socket.on("unsubscribe", (data: { stockCode: string }) => {
      if (!userId) return;
      const code = data.stockCode?.trim().toUpperCase();
      if (!code) return;

      userSubscriptions.get(userId)?.delete(code);
      stockWatchers.get(code)?.delete(userId);
      socket.leave(`stock:${code}`);

      // Stop polling if no more watchers
      if (!stockWatchers.get(code)?.size) {
        stopPollingForStock(code);
      }

      socket.emit("unsubscribed", { stockCode: code });
    });

    // Request current quote immediately
    socket.on("getQuote", async (data: { stockCode: string }) => {
      if (!userId) { socket.emit("error", { message: "인증이 필요합니다" }); return; }
      const code = data.stockCode?.trim().toUpperCase();
      if (!code) return;

      try {
        const quote = await fetchCurrentQuote(code, userId);
        if (quote) socket.emit("quote", quote);
      } catch (err) {
        socket.emit("error", { message: `시세 조회 실패: ${String(err)}` });
      }
    });

    socket.on("disconnect", () => {
      console.log(`[Realtime] Client disconnected: ${socket.id}`);
      if (userId) {
        const subs = userSubscriptions.get(userId);
        if (subs) {
          Array.from(subs).forEach(code => {
            if (userId !== null) stockWatchers.get(code)?.delete(userId);
            if (!stockWatchers.get(code)?.size) {
              stopPollingForStock(code);
            }
          });
        }
        userSubscriptions.delete(userId);
      }
    });
  });

  console.log("[Realtime] Socket.IO server initialized at /api/socket.io");
  return io;
}

// ─── Quote Polling (Fallback) ─────────────────────────────────────────────────
// KIS REST API를 3초마다 폴링하여 실시간 시세를 시뮬레이션
// (KIS WebSocket 승인키 발급 후 실제 WS 연결로 교체 가능)

const quoteCache = new Map<string, RealtimeQuote>();

async function fetchCurrentQuote(stockCode: string, userId: number): Promise<RealtimeQuote | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(kisSettings)
      .where(and(eq(kisSettings.userId, userId), eq(kisSettings.isActive, true))).limit(1);
    if (!rows.length) return null;

    const setting = rows[0];
    if (!setting.encryptedAppKey || !setting.encryptedAppSecret) return null;

    const appKey = decrypt(setting.encryptedAppKey);
    const appSecret = decrypt(setting.encryptedAppSecret);
    const mode = setting.mode as "real" | "paper";

    let client = kisWsConnections.get(userId);
    if (!client) {
      client = new KisApiClient({ appKey, appSecret, accountNo: setting.accountNo || "", accountProduct: setting.accountProduct || "01", mode });
      if (setting.accessToken && setting.tokenExpiredAt && new Date(setting.tokenExpiredAt) > new Date()) {
        client.setToken(setting.accessToken, new Date(setting.tokenExpiredAt));
      } else {
        // Token will be issued on first API call via the client's internal logic
      }
      kisWsConnections.set(userId, client);
    }

    const quote = await client.getCurrentPrice(stockCode);
    if (!quote) return null;

    const result: RealtimeQuote = {
      stockCode,
      currentPrice: quote.currentPrice,
      changePrice: quote.changePrice,
      changeRate: quote.changeRate,
      volume: quote.volume,
      tradingValue: 0, // not available in REST price endpoint
      high: quote.highPrice || 0,
      low: quote.lowPrice || 0,
      open: quote.openPrice || 0,
      timestamp: Date.now(),
    };

    quoteCache.set(stockCode, result);
    return result;
  } catch (err) {
    console.error(`[Realtime] Failed to fetch quote for ${stockCode}:`, err);
    return null;
  }
}

function startPollingForStock(stockCode: string, userId: number) {
  if (pollingIntervals.has(stockCode)) return; // Already polling

  const interval = setInterval(async () => {
    if (!io) return;
    const watchers = stockWatchers.get(stockCode);
    if (!watchers?.size) {
      stopPollingForStock(stockCode);
      return;
    }

    // Use first watcher's credentials to fetch quote
    const firstUserId = watchers.values().next().value as number;
    const quote = await fetchCurrentQuote(stockCode, firstUserId);
    if (quote) {
      // Broadcast to all clients in the stock room
      io.to(`stock:${stockCode}`).emit("quote", quote);
    }
  }, 3000); // 3-second polling interval (KIS REST fallback)

  pollingIntervals.set(stockCode, interval);
  console.log(`[Realtime] Started polling for ${stockCode}`);
}

function stopPollingForStock(stockCode: string) {
  const interval = pollingIntervals.get(stockCode);
  if (interval) {
    clearInterval(interval);
    pollingIntervals.delete(stockCode);
    console.log(`[Realtime] Stopped polling for ${stockCode}`);
  }
}

// ─── Broadcast helpers (called from other server modules) ─────────────────────

export function broadcastOrderUpdate(userId: number, data: {
  type: "filled" | "cancelled" | "rejected";
  stockCode: string;
  orderType: "buy" | "sell";
  quantity: number;
  price: number;
  orderId: number;
}) {
  if (!io) return;
  io.to(`user:${userId}`).emit("orderUpdate", data);
}

export function broadcastSignal(userId: number, data: {
  stockCode: string;
  signal: "BUY" | "SELL";
  strength: number;
  reason: string;
  strategyName: string;
}) {
  if (!io) return;
  io.to(`user:${userId}`).emit("signal", data);
}

export function broadcastAutoTraderStatus(userId: number, data: {
  isRunning: boolean;
  message: string;
}) {
  if (!io) return;
  io.to(`user:${userId}`).emit("autoTraderStatus", data);
}

export function getSocketIO() {
  return io;
}
