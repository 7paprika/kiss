export type PerformanceOrderLike = {
  stockCode: string;
  strategyId?: string | null;
  orderType: "buy" | "sell";
  status?: string | null;
  price?: string | number | null;
  executedPrice?: string | number | null;
  quantity: number;
  executedQty?: number | null;
  orderedAt: Date;
};

const isIgnoredOrder = (status?: string | null) =>
  status === "cancelled" || status === "rejected";

const numericPrice = (order: PerformanceOrderLike) =>
  Number(order.executedPrice ?? order.price ?? 0);

const numericQty = (order: PerformanceOrderLike) =>
  Number(order.executedQty ?? order.quantity ?? 0);

export function calculateDailyRealizedPnl(orders: PerformanceOrderLike[]): Array<{ date: string; amount: number }> {
  const buyQueue = new Map<string, Array<{ price: number; qty: number }>>();
  const dailyMap = new Map<string, number>();

  for (const order of orders) {
    if (isIgnoredOrder(order.status)) continue;

    const price = numericPrice(order);
    const qty = numericQty(order);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) continue;

    const key = `${order.stockCode}_${order.strategyId || "manual"}`;

    if (order.orderType === "buy") {
      const queue = buyQueue.get(key) ?? [];
      queue.push({ price, qty });
      buyQueue.set(key, queue);
      continue;
    }

    const queue = buyQueue.get(key) ?? [];
    let remaining = qty;
    let realized = 0;

    while (remaining > 0 && queue.length > 0) {
      const buy = queue[0];
      const matched = Math.min(remaining, buy.qty);
      realized += (price - buy.price) * matched;
      buy.qty -= matched;
      remaining -= matched;
      if (buy.qty <= 0) queue.shift();
    }

    buyQueue.set(key, queue);

    if (realized !== 0) {
      const date = order.orderedAt.toISOString().slice(0, 10);
      dailyMap.set(date, (dailyMap.get(date) ?? 0) + realized);
    }
  }

  return Array.from(dailyMap.entries())
    .map(([date, amount]) => ({ date, amount: Math.round(amount) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
