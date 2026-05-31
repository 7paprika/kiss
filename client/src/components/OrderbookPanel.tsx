/**
 * OrderbookPanel - 10단계 호가창 컴포넌트
 * KIS API FHKST01010200 기반 매도/매수 호가 10단계 표시
 */
import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface OrderbookPanelProps {
  stockCode: string;
  currentPrice?: number;
  onPriceClick?: (price: number) => void;
}

export default function OrderbookPanel({ stockCode, currentPrice, onPriceClick }: OrderbookPanelProps) {
  const { data, isLoading, refetch, dataUpdatedAt } = trpc.kis.getOrderbook.useQuery(
    { stockCode },
    {
      enabled: !!stockCode,
      refetchInterval: 3000,
      staleTime: 2000,
    }
  );

  const prevPricesRef = useRef<Map<string, number>>(new Map());

  // 가격 변동 감지용
  useEffect(() => {
    if (!data) return;
    const map = new Map<string, number>();
    data.asks.forEach((l, i) => map.set(`ask_${i}`, l.quantity));
    data.bids.forEach((l, i) => map.set(`bid_${i}`, l.quantity));
    prevPricesRef.current = map;
  }, [dataUpdatedAt]);

  const formatNum = (n: number) => n.toLocaleString("ko-KR");
  const formatPrice = (n: number) => n.toLocaleString("ko-KR");

  if (!stockCode) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        종목을 선택하세요
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">호가 로딩 중...</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <p className="text-sm">호가 데이터를 불러올 수 없습니다</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3 mr-1" /> 재시도
        </Button>
      </div>
    );
  }

  const cp = currentPrice || data.currentPrice;

  // 매도호가: 높은 가격이 위 (역순 정렬)
  const sortedAsks = [...data.asks].sort((a, b) => b.price - a.price);
  // 매수호가: 높은 가격이 위 (정순)
  const sortedBids = [...data.bids].sort((a, b) => b.price - a.price);

  const maxAskQty = Math.max(...data.asks.map(l => l.quantity), 1);
  const maxBidQty = Math.max(...data.bids.map(l => l.quantity), 1);

  return (
    <div className="flex flex-col h-full text-xs select-none">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/40">
        <span className="font-semibold text-foreground">{stockCode} 호가창</span>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>매도잔량: <span className="text-red-400">{formatNum(data.totalAskQty)}</span></span>
          <span>매수잔량: <span className="text-emerald-400">{formatNum(data.totalBidQty)}</span></span>
        </div>
      </div>

      {/* 컬럼 헤더 */}
      <div className="grid grid-cols-3 px-2 py-1 text-muted-foreground/70 text-[10px] border-b border-border/20">
        <span className="text-right">잔량</span>
        <span className="text-center">호가</span>
        <span className="text-left pl-2">잔량</span>
      </div>

      {/* 호가 테이블 */}
      <div className="flex-1 overflow-y-auto">
        {/* 매도호가 10단계 */}
        {sortedAsks.map((level, idx) => {
          const pct = Math.round((level.quantity / maxAskQty) * 100);
          const isCurrentPrice = level.price === cp;
          return (
            <div
              key={`ask_${idx}`}
              className={cn(
                "grid grid-cols-3 items-center px-2 py-[3px] cursor-pointer hover:bg-red-500/10 transition-colors relative",
                isCurrentPrice && "ring-1 ring-inset ring-yellow-400/60"
              )}
              onClick={() => onPriceClick?.(level.price)}
            >
              {/* 잔량 바 (배경) */}
              <div
                className="absolute right-1/3 top-0 bottom-0 bg-red-500/10 pointer-events-none"
                style={{ width: `${pct * 0.33}%` }}
              />
              {/* 매도 잔량 */}
              <span className="text-right text-red-400 font-mono z-10">
                {formatNum(level.quantity)}
              </span>
              {/* 호가 */}
              <span className={cn(
                "text-center font-mono font-semibold z-10",
                level.price > cp ? "text-red-400" : level.price < cp ? "text-emerald-400" : "text-yellow-400"
              )}>
                {formatPrice(level.price)}
              </span>
              {/* 매수 잔량 (없음) */}
              <span className="z-10" />
            </div>
          );
        })}

        {/* 현재가 구분선 */}
        <div className="flex items-center gap-2 px-2 py-1.5 bg-yellow-400/10 border-y border-yellow-400/30">
          <span className="flex-1 text-right text-muted-foreground/60 text-[10px]">현재가</span>
          <span className="font-bold text-yellow-400 font-mono text-sm">
            {formatPrice(cp)}
          </span>
          <span className="flex-1 text-left text-muted-foreground/60 text-[10px]" />
        </div>

        {/* 매수호가 10단계 */}
        {sortedBids.map((level, idx) => {
          const pct = Math.round((level.quantity / maxBidQty) * 100);
          const isCurrentPrice = level.price === cp;
          return (
            <div
              key={`bid_${idx}`}
              className={cn(
                "grid grid-cols-3 items-center px-2 py-[3px] cursor-pointer hover:bg-emerald-500/10 transition-colors relative",
                isCurrentPrice && "ring-1 ring-inset ring-yellow-400/60"
              )}
              onClick={() => onPriceClick?.(level.price)}
            >
              {/* 잔량 바 (배경) */}
              <div
                className="absolute left-1/3 top-0 bottom-0 bg-emerald-500/10 pointer-events-none"
                style={{ width: `${pct * 0.33}%` }}
              />
              {/* 매도 잔량 (없음) */}
              <span className="z-10" />
              {/* 호가 */}
              <span className={cn(
                "text-center font-mono font-semibold z-10",
                level.price > cp ? "text-red-400" : level.price < cp ? "text-emerald-400" : "text-yellow-400"
              )}>
                {formatPrice(level.price)}
              </span>
              {/* 매수 잔량 */}
              <span className="text-left pl-2 text-emerald-400 font-mono z-10">
                {formatNum(level.quantity)}
              </span>
            </div>
          );
        })}
      </div>

      {/* 하단 요약 */}
      <div className="px-2 py-1.5 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          매도비율:{" "}
          <span className="text-red-400">
            {data.totalAskQty + data.totalBidQty > 0
              ? Math.round((data.totalAskQty / (data.totalAskQty + data.totalBidQty)) * 100)
              : 50}%
          </span>
        </span>
        <span>
          매수비율:{" "}
          <span className="text-emerald-400">
            {data.totalAskQty + data.totalBidQty > 0
              ? Math.round((data.totalBidQty / (data.totalAskQty + data.totalBidQty)) * 100)
              : 50}%
          </span>
        </span>
        <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={() => refetch()}>
          <RefreshCw className="w-2.5 h-2.5 mr-0.5" />
          갱신
        </Button>
      </div>
    </div>
  );
}
