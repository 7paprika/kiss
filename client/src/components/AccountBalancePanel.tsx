import { RefreshCw, Wallet, TrendingUp, TrendingDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

function formatWon(value?: number) {
  return `${Number(value || 0).toLocaleString()}원`;
}

function formatRate(value?: number) {
  const n = Number(value || 0);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export default function AccountBalancePanel() {
  const { data, isLoading, error, refetch, isFetching } = trpc.kis.getBalance.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const isProfit = Number(data?.totalProfit || 0) >= 0;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <Wallet size={15} className="text-primary" />
            계좌 잔고
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">예수금, 출금가능금액, 보유종목을 KIS에서 조회합니다</div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          새로고침
        </Button>
      </div>

      {error && (
        <div className="rounded border border-bear/30 bg-bear/10 p-3 text-xs text-bear">
          {error.message}
        </div>
      )}

      {isLoading && !data ? (
        <div className="rounded border border-border bg-card p-4 text-xs text-muted-foreground">계좌 잔고를 조회하는 중입니다...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-border bg-card p-3">
              <div className="text-[10px] text-muted-foreground">총 평가금액</div>
              <div className="mt-1 text-sm font-semibold">{formatWon(data?.totalEval)}</div>
            </div>
            <div className="rounded border border-border bg-card p-3">
              <div className="text-[10px] text-muted-foreground">평가손익</div>
              <div className={`mt-1 text-sm font-semibold flex items-center gap-1 ${isProfit ? "text-bull" : "text-bear"}`}>
                {isProfit ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {formatWon(data?.totalProfit)}
              </div>
            </div>
            <div className="rounded border border-border bg-card p-3">
              <div className="text-[10px] text-muted-foreground">예수금</div>
              <div className="mt-1 text-sm font-semibold">{formatWon(data?.cashBalance)}</div>
            </div>
            <div className="rounded border border-border bg-card p-3">
              <div className="text-[10px] text-muted-foreground">출금가능</div>
              <div className="mt-1 text-sm font-semibold">{formatWon(data?.withdrawableCash)}</div>
            </div>
          </div>

          <div className="rounded border border-border bg-card overflow-hidden">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <div className="text-xs font-semibold">보유종목</div>
              <div className="text-[10px] text-muted-foreground">{data?.holdings?.length || 0}개</div>
            </div>
            {!data?.holdings?.length ? (
              <div className="p-4 text-xs text-muted-foreground">보유종목이 없습니다.</div>
            ) : (
              <div className="divide-y divide-border">
                {data.holdings.map((holding) => {
                  const positive = holding.profitLoss >= 0;
                  return (
                    <div key={holding.stockCode} className="p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">{holding.stockName}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{holding.stockCode}</div>
                        </div>
                        <div className={`text-xs font-semibold ${positive ? "text-bull" : "text-bear"}`}>
                          {formatRate(holding.profitLossRate)}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                        <div>수량 <span className="text-foreground">{holding.holdQty.toLocaleString()}</span></div>
                        <div>평단 <span className="text-foreground">{holding.avgPrice.toLocaleString()}</span></div>
                        <div>현재 <span className="text-foreground">{holding.currentPrice.toLocaleString()}</span></div>
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-muted-foreground">평가 {formatWon(holding.evalAmount)}</span>
                        <span className={positive ? "text-bull" : "text-bear"}>{formatWon(holding.profitLoss)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
