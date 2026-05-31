import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Wallet, ListOrdered, X, RefreshCw, BookOpen } from "lucide-react";
import OrderbookPanel from "./OrderbookPanel";

interface Props {
  stockCode: string;
  stockName: string;
}

type OrderTab = "buy" | "sell" | "orderbook" | "balance" | "pending";

export default function OrderPanel({ stockCode, stockName }: Props) {
  const [tab, setTab] = useState<OrderTab>("buy");
  const [priceType, setPriceType] = useState<"market" | "limit">("limit");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");

  const utils = trpc.useUtils();
  const { data: currentPrice } = trpc.kis.getCurrentPrice.useQuery(
    { stockCode },
    { enabled: !!stockCode, refetchInterval: 3000 }
  );
  const { data: balance, refetch: refetchBalance } = trpc.kis.getBalance.useQuery(
    undefined,
    { enabled: tab === "balance", staleTime: 10_000 }
  );
  const { data: pendingOrders, refetch: refetchPending } = trpc.kis.getPendingOrders.useQuery(
    undefined,
    { enabled: tab === "pending", refetchInterval: 10_000 }
  );

  const placeMutation = trpc.kis.placeOrder.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`주문 접수 완료 (주문번호: ${result.orderNo})`);
        setQuantity("");
        setPrice("");
        utils.kis.getPendingOrders.invalidate();
      } else {
        toast.error(`주문 실패: ${result.message}`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const cancelMutation = trpc.kis.cancelOrder.useMutation({
    onSuccess: () => { toast.success("주문 취소 완료"); utils.kis.getPendingOrders.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const handleOrder = (orderType: "buy" | "sell") => {
    const qty = parseInt(quantity);
    if (!qty || qty <= 0) { toast.error("수량을 입력하세요"); return; }
    if (priceType === "limit" && (!price || parseFloat(price) <= 0)) {
      toast.error("지정가를 입력하세요"); return;
    }
    placeMutation.mutate({
      stockCode, stockName, orderType, priceType,
      quantity: qty,
      price: priceType === "limit" ? parseFloat(price) : undefined,
    });
  };

  const setCurrentPrice = () => {
    if (currentPrice) setPrice(String(currentPrice.currentPrice));
  };

  const calcTotal = () => {
    const qty = parseInt(quantity) || 0;
    const p = priceType === "market" ? (currentPrice?.currentPrice || 0) : (parseFloat(price) || 0);
    return (qty * p).toLocaleString();
  };

  const tabs: { id: OrderTab; label: string }[] = [
    { id: "buy", label: "매수" },
    { id: "sell", label: "매도" },
    { id: "orderbook", label: "호가" },
    { id: "balance", label: "잔고" },
    { id: "pending", label: "미체결" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === t.id
                ? t.id === "buy"
                  ? "text-bull border-b-2 border-bull"
                  : t.id === "sell"
                  ? "text-bear border-b-2 border-bear"
                  : "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Buy / Sell Form */}
        {(tab === "buy" || tab === "sell") && (
          <div className="space-y-3">
            {/* Current Price */}
            {currentPrice && (
              <div className="bg-secondary rounded p-2 flex justify-between items-center">
                <span className="text-xs text-muted-foreground">현재가</span>
                <div className="text-right">
                  <span className={`font-mono text-sm font-bold ${currentPrice.changePrice >= 0 ? "text-bull" : "text-bear"}`}>
                    {currentPrice.currentPrice.toLocaleString()}
                  </span>
                  <span className={`text-xs ml-2 font-mono ${currentPrice.changePrice >= 0 ? "text-bull" : "text-bear"}`}>
                    {currentPrice.changePrice >= 0 ? "+" : ""}{currentPrice.changeRate.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}

            {/* Price Type */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">주문 유형</label>
              <div className="flex gap-1">
                {(["limit", "market"] as const).map((pt) => (
                  <button
                    key={pt}
                    onClick={() => setPriceType(pt)}
                    className={`flex-1 py-1.5 rounded text-xs transition-colors ${
                      priceType === pt
                        ? "bg-primary/20 text-primary border border-primary/50"
                        : "bg-secondary text-muted-foreground border border-border"
                    }`}
                  >
                    {pt === "limit" ? "지정가" : "시장가"}
                  </button>
                ))}
              </div>
            </div>

            {/* Price Input */}
            {priceType === "limit" && (
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-xs text-muted-foreground">주문가격</label>
                  <button onClick={setCurrentPrice} className="text-xs text-primary hover:underline">현재가 적용</button>
                </div>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0"
                  className="w-full text-right font-mono"
                />
              </div>
            )}

            {/* Quantity */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">수량</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                min="1"
                className="w-full text-right font-mono"
              />
              {/* Quick quantity buttons */}
              <div className="flex gap-1 mt-1">
                {[10, 50, 100].map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuantity(String(q))}
                    className="flex-1 py-0.5 text-[10px] bg-secondary text-muted-foreground rounded hover:text-foreground transition-colors"
                  >
                    {q}주
                  </button>
                ))}
              </div>
            </div>

            {/* Total */}
            <div className="bg-secondary rounded p-2 flex justify-between">
              <span className="text-xs text-muted-foreground">주문금액</span>
              <span className="font-mono text-xs font-medium">{calcTotal()}원</span>
            </div>

            {/* Order Button */}
            <button
              onClick={() => handleOrder(tab as "buy" | "sell")}
              disabled={placeMutation.isPending}
              className={`w-full py-2.5 rounded text-sm font-bold transition-all disabled:opacity-50 ${
                tab === "buy"
                  ? "bg-bull text-white hover:opacity-90"
                  : "bg-bear text-white hover:opacity-90"
              }`}
            >
              {placeMutation.isPending ? "주문 중..." : tab === "buy" ? "매수" : "매도"}
            </button>
          </div>
        )}

        {/* Orderbook */}
        {tab === "orderbook" && (
          <div className="flex-1 overflow-hidden" style={{ height: "calc(100% - 2rem)" }}>
            <OrderbookPanel
              stockCode={stockCode}
              currentPrice={currentPrice?.currentPrice}
              onPriceClick={(p) => { setPrice(String(p)); setPriceType("limit"); }}
            />
          </div>
        )}

        {/* Balance */}
        {tab === "balance" && (
          <div className="space-y-2">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-muted-foreground">보유 종목</span>
              <button onClick={() => refetchBalance()} className="text-muted-foreground hover:text-foreground">
                <RefreshCw size={12} />
              </button>
            </div>
            {!balance ? (
              <div className="text-center text-muted-foreground text-xs py-8">
                <Wallet size={24} className="mx-auto mb-2 opacity-30" />
                <p>잔고 정보 없음</p>
                <p className="text-[10px] mt-1">KIS API 연결 후 조회 가능</p>
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="bg-secondary rounded p-3 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">평가금액</span>
                    <span className="font-mono">{Number(balance.totalEval).toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">평가손익</span>
                    <span className={`font-mono font-medium ${Number(balance.totalProfit) >= 0 ? "text-bull" : "text-bear"}`}>
                      {Number(balance.totalProfit) >= 0 ? "+" : ""}{Number(balance.totalProfit).toLocaleString()}원
                    </span>
                  </div>
                </div>

                {/* Holdings */}
                {balance.holdings.length > 0 && (
                  <div className="space-y-1">
                    {balance.holdings.map((h) => (
                      <div key={h.stockCode} className="bg-secondary rounded p-2">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium">{h.stockName}</span>
                          <span className={`font-mono ${Number(h.profitLossRate) >= 0 ? "text-bull" : "text-bear"}`}>
                            {Number(h.profitLossRate) >= 0 ? "+" : ""}{Number(h.profitLossRate).toFixed(2)}%
                          </span>
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                          <span>{h.holdQty}주 · 평균 {Number(h.avgPrice).toLocaleString()}</span>
                          <span className={`font-mono ${Number(h.profitLoss) >= 0 ? "text-bull" : "text-bear"}`}>
                            {Number(h.profitLoss) >= 0 ? "+" : ""}{Number(h.profitLoss).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Pending Orders */}
        {tab === "pending" && (
          <div className="space-y-2">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-muted-foreground">미체결 주문</span>
              <button onClick={() => refetchPending()} className="text-muted-foreground hover:text-foreground">
                <RefreshCw size={12} />
              </button>
            </div>
            {!pendingOrders || pendingOrders.length === 0 ? (
              <div className="text-center text-muted-foreground text-xs py-8">
                <ListOrdered size={24} className="mx-auto mb-2 opacity-30" />
                <p>미체결 주문 없음</p>
              </div>
            ) : (
              pendingOrders.map((order) => (
                <div key={order.orderNo} className="bg-secondary rounded p-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className={`text-xs font-medium ${order.orderType === "buy" ? "text-bull" : "text-bear"}`}>
                        {order.orderType === "buy" ? "매수" : "매도"}
                      </span>
                      <span className="text-xs ml-2">{order.stockName || order.stockCode}</span>
                    </div>
                    <button
                      onClick={() => cancelMutation.mutate({
                        orderNo: order.orderNo,
                        stockCode: order.stockCode,
                        quantity: order.remainQty,
                      })}
                      className="text-muted-foreground hover:text-bear transition-colors"
                      title="주문 취소"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span className="font-mono">{order.orderPrice.toLocaleString()}원</span>
                    <span>{order.remainQty}/{order.orderQty}주</span>
                    <span className="font-mono text-[9px]">{order.orderNo}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
