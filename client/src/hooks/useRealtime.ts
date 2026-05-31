/**
 * useRealtime - Socket.IO 실시간 시세 훅
 * 종목 코드를 구독하면 5초마다 갱신되는 현재가 데이터를 반환합니다.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/_core/hooks/useAuth";

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

// Singleton socket instance
let globalSocket: Socket | null = null;
let globalConnected = false;
const quoteListeners = new Map<string, Set<(q: RealtimeQuote) => void>>();
const signalListeners = new Set<(s: unknown) => void>();
const orderListeners = new Set<(o: unknown) => void>();

function getSocket(userId: number): Socket {
  if (!globalSocket || !globalSocket.connected) {
    globalSocket = io(window.location.origin, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    globalSocket.on("connect", () => {
      globalConnected = true;
      globalSocket?.emit("auth", { userId });
      console.log("[Realtime] Connected to Socket.IO server");
    });

    globalSocket.on("disconnect", () => {
      globalConnected = false;
      console.log("[Realtime] Disconnected from Socket.IO server");
    });

    globalSocket.on("quote", (quote: RealtimeQuote) => {
      const listeners = quoteListeners.get(quote.stockCode);
      if (listeners) {
        listeners.forEach(fn => fn(quote));
      }
    });

    globalSocket.on("signal", (signal: unknown) => {
      signalListeners.forEach(fn => fn(signal));
    });

    globalSocket.on("orderUpdate", (order: unknown) => {
      orderListeners.forEach(fn => fn(order));
    });
  } else if (globalSocket.connected && !globalConnected) {
    globalSocket.emit("auth", { userId });
    globalConnected = true;
  }

  return globalSocket;
}

// ─── useRealtimeQuote ─────────────────────────────────────────────────────────

export function useRealtimeQuote(stockCode: string | null) {
  const { user } = useAuth();
  const [quote, setQuote] = useState<RealtimeQuote | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!stockCode || !user?.id) return;

    const socket = getSocket(user.id);
    socketRef.current = socket;

    const handleConnect = () => {
      setConnected(true);
      socket.emit("subscribe", { stockCode });
      socket.emit("getQuote", { stockCode });
    };

    const handleDisconnect = () => setConnected(false);

    const handleQuote = (q: RealtimeQuote) => {
      if (q.stockCode === stockCode) setQuote(q);
    };

    // Register listener
    if (!quoteListeners.has(stockCode)) quoteListeners.set(stockCode, new Set());
    quoteListeners.get(stockCode)!.add(handleQuote);

    if (socket.connected) {
      handleConnect();
      setConnected(true);
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    return () => {
      quoteListeners.get(stockCode)?.delete(handleQuote);
      if (!quoteListeners.get(stockCode)?.size) {
        socket.emit("unsubscribe", { stockCode });
        quoteListeners.delete(stockCode);
      }
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [stockCode, user?.id]);

  return { quote, connected };
}

// ─── useRealtimeSignals ────────────────────────────────────────────────────────

export interface RealtimeSignal {
  stockCode: string;
  signal: "BUY" | "SELL";
  strength: number;
  reason: string;
  strategyName: string;
}

export function useRealtimeSignals() {
  const { user } = useAuth();
  const [signals, setSignals] = useState<RealtimeSignal[]>([]);

  useEffect(() => {
    if (!user?.id) return;

    const socket = getSocket(user.id);

    const handleSignal = (signal: unknown) => {
      setSignals(prev => [signal as RealtimeSignal, ...prev.slice(0, 49)]);
    };

    signalListeners.add(handleSignal);

    return () => {
      signalListeners.delete(handleSignal);
    };
  }, [user?.id]);

  const clearSignals = useCallback(() => setSignals([]), []);

  return { signals, clearSignals };
}

// ─── useRealtimeSignal (callback variant) ─────────────────────────────────────
export interface RealtimeSignal {
  stockCode: string;
  stockName: string;
  action: "BUY" | "SELL";
  strategy: string;
  strength: number;
  timestamp: number;
}

export function useRealtimeSignal(onSignal: (signal: RealtimeSignal) => void) {
  const { user } = useAuth();
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  useEffect(() => {
    if (!user?.id) return;
    getSocket(user.id);

    const handleSignal = (signal: unknown) => {
      onSignalRef.current(signal as RealtimeSignal);
    };

    signalListeners.add(handleSignal);
    return () => { signalListeners.delete(handleSignal); };
  }, [user?.id]);
}

// ─── useRealtimeOrders ─────────────────────────────────────────────────────────

export interface RealtimeOrderUpdate {
  type: "filled" | "cancelled" | "rejected";
  stockCode: string;
  orderType: "buy" | "sell";
  quantity: number;
  price: number;
  orderId: number;
}

export function useRealtimeOrders(onUpdate?: (order: RealtimeOrderUpdate) => void) {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id || !onUpdate) return;

    const socket = getSocket(user.id);

    const handleOrder = (order: unknown) => {
      onUpdate(order as RealtimeOrderUpdate);
    };

    orderListeners.add(handleOrder);

    return () => {
      orderListeners.delete(handleOrder);
    };
  }, [user?.id, onUpdate]);
}

// ─── useRealtimeConnection ─────────────────────────────────────────────────────

export function useRealtimeConnection() {
  const { user } = useAuth();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

    const socket = getSocket(user.id);

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    setIsConnected(socket.connected);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [user?.id]);

  return isConnected;
}
