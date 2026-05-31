import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Zap, Trophy, TrendingUp, TrendingDown, Target,
  ChevronDown, ChevronUp, CheckCircle, AlertCircle, Loader2
} from "lucide-react";

interface OptimizerPanelProps {
  selectedStock?: string;
}

export default function OptimizerPanel({ selectedStock }: OptimizerPanelProps) {
  const [stockCode, setStockCode] = useState(selectedStock || "005930");
  const [strategyId, setStrategyId] = useState("bollinger_trading");
  const [period, setPeriod] = useState<"D" | "W" | "M">("D");
  const [initialCapital, setInitialCapital] = useState("10000000");
  const [stopLoss, setStopLoss] = useState("5");
  const [takeProfit, setTakeProfit] = useState("10");
  const [maxCombinations, setMaxCombinations] = useState("150");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  const { data: paramSpaces } = trpc.optimizer.getParamSpaces.useQuery();
  const { data: strategies } = trpc.strategy.getAllMeta.useQuery();

  const optimize = trpc.optimizer.runOptimization.useMutation({
    onSuccess: () => {
      toast.success("파라미터 최적화 완료!");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const tradingStrategies = strategies?.filter((s: { type: string; id: string; name: string }) => s.type === "trading") || [];
  const currentParamSpace = paramSpaces?.find(p => p.id === strategyId);

  function handleRun() {
    optimize.mutate({
      strategyId,
      stockCode,
      period,
      initialCapital: parseInt(initialCapital) || 10000000,
      stopLossPct: parseFloat(stopLoss) || undefined,
      takeProfitPct: parseFloat(takeProfit) || undefined,
      maxCombinations: parseInt(maxCombinations) || 150,
    });
  }

  const result = optimize.data;

  function fmtPct(v: number) {
    return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  }
  function fmtScore(v: number) {
    return v.toFixed(3);
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
        <Zap className="w-4 h-4 text-yellow-400" />
        <span className="text-sm font-semibold text-foreground">파라미터 최적화</span>
        <Badge variant="outline" className="text-[10px] h-4 border-yellow-500/40 text-yellow-400">
          그리드 서치
        </Badge>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {/* 입력 폼 */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">종목코드</Label>
                <Input
                  value={stockCode}
                  onChange={e => setStockCode(e.target.value)}
                  placeholder="005930"
                  className="h-7 text-xs mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">차트 주기</Label>
                <Select value={period} onValueChange={v => setPeriod(v as "D" | "W" | "M")}>
                  <SelectTrigger className="h-7 text-xs mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="D">일봉</SelectItem>
                    <SelectItem value="W">주봉</SelectItem>
                    <SelectItem value="M">월봉</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">최적화할 전략</Label>
              <Select value={strategyId} onValueChange={setStrategyId}>
                <SelectTrigger className="h-7 text-xs mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tradingStrategies.map((s: { id: string; name: string }) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 탐색 파라미터 미리보기 */}
            {currentParamSpace && currentParamSpace.ranges.length > 0 && (
              <div className="bg-muted/20 rounded p-2 space-y-1">
                <p className="text-[10px] text-muted-foreground font-medium">탐색 파라미터</p>
                {currentParamSpace.ranges.map(r => (
                  <div key={r.name} className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="text-foreground font-mono">
                      {r.min} ~ {r.max} (step {r.step})
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">초기 자본(원)</Label>
                <Input
                  value={initialCapital}
                  onChange={e => setInitialCapital(e.target.value)}
                  className="h-7 text-xs mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">최대 탐색 수</Label>
                <Input
                  value={maxCombinations}
                  onChange={e => setMaxCombinations(e.target.value)}
                  className="h-7 text-xs mt-1"
                  type="number"
                  min={10}
                  max={500}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">손절(%)</Label>
                <Input
                  value={stopLoss}
                  onChange={e => setStopLoss(e.target.value)}
                  className="h-7 text-xs mt-1"
                  type="number"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">익절(%)</Label>
                <Input
                  value={takeProfit}
                  onChange={e => setTakeProfit(e.target.value)}
                  className="h-7 text-xs mt-1"
                  type="number"
                />
              </div>
            </div>

            <Button
              className="w-full h-8 text-xs bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
              onClick={handleRun}
              disabled={optimize.isPending}
            >
              {optimize.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  최적화 실행 중...
                </>
              ) : (
                <>
                  <Zap className="w-3 h-3 mr-1.5" />
                  그리드 서치 실행
                </>
              )}
            </Button>
          </div>

          {/* 결과 */}
          {optimize.isPending && (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}

          {result && (
            <div className="space-y-3">
              {/* 요약 */}
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2.5 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-yellow-400" />
                  <span className="text-xs font-semibold text-yellow-400">최적 파라미터 발견</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {result.testedCombinations}/{result.totalCombinations}개 조합 탐색 완료
                  ({(result.durationMs / 1000).toFixed(1)}초)
                </div>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  {Object.entries(result.bestResult.params).map(([k, v]) => {
                    const range = result.paramRanges.find(r => r.name === k);
                    return (
                      <div key={k} className="flex justify-between bg-muted/30 rounded px-2 py-1">
                        <span className="text-[10px] text-muted-foreground">{range?.label || k}</span>
                        <span className="text-[10px] font-bold text-yellow-400">{v}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 최적 성과 */}
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: "총 수익률", value: fmtPct(result.bestResult.totalReturn), positive: result.bestResult.totalReturn >= 0 },
                  { label: "연환산 수익률", value: fmtPct(result.bestResult.annualizedReturn), positive: result.bestResult.annualizedReturn >= 0 },
                  { label: "최대 낙폭", value: `-${result.bestResult.maxDrawdown.toFixed(2)}%`, positive: false },
                  { label: "샤프 비율", value: result.bestResult.sharpeRatio.toFixed(2), positive: result.bestResult.sharpeRatio >= 1 },
                  { label: "승률", value: `${result.bestResult.winRate.toFixed(1)}%`, positive: result.bestResult.winRate >= 50 },
                  { label: "총 거래 수", value: `${result.bestResult.totalTrades}회`, positive: true },
                ].map(item => (
                  <div key={item.label} className="bg-muted/20 rounded p-2">
                    <div className="text-[10px] text-muted-foreground">{item.label}</div>
                    <div className={`text-xs font-bold mt-0.5 ${item.positive ? "text-emerald-400" : "text-rose-400"}`}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Top 5 결과 */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">상위 5개 파라미터 조합</p>
                <div className="space-y-1">
                  {result.top5Results.map((r, idx) => (
                    <div
                      key={idx}
                      className="border border-border/30 rounded overflow-hidden"
                    >
                      <button
                        className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-muted/20 transition-colors"
                        onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                      >
                        <div className="flex items-center gap-2">
                          {idx === 0 ? (
                            <Trophy className="w-3 h-3 text-yellow-400" />
                          ) : (
                            <span className="text-[10px] text-muted-foreground w-3 text-center">{idx + 1}</span>
                          )}
                          <span className={`text-xs font-medium ${r.totalReturn >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {fmtPct(r.totalReturn)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            샤프 {r.sharpeRatio.toFixed(2)} | 승률 {r.winRate.toFixed(0)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[9px] h-4 px-1">
                            점수 {fmtScore(r.score)}
                          </Badge>
                          {expandedIdx === idx ? (
                            <ChevronUp className="w-3 h-3 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-muted-foreground" />
                          )}
                        </div>
                      </button>

                      {expandedIdx === idx && (
                        <div className="px-2.5 pb-2 pt-1 bg-muted/10 border-t border-border/20">
                          <div className="grid grid-cols-2 gap-1">
                            {Object.entries(r.params).map(([k, v]) => {
                              const range = result.paramRanges.find(pr => pr.name === k);
                              return (
                                <div key={k} className="flex justify-between">
                                  <span className="text-[10px] text-muted-foreground">{range?.label || k}</span>
                                  <span className="text-[10px] font-mono text-foreground">{v}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="grid grid-cols-3 gap-1 mt-1.5 pt-1.5 border-t border-border/20">
                            <div className="text-center">
                              <div className="text-[9px] text-muted-foreground">MDD</div>
                              <div className="text-[10px] text-rose-400">-{r.maxDrawdown.toFixed(1)}%</div>
                            </div>
                            <div className="text-center">
                              <div className="text-[9px] text-muted-foreground">거래수</div>
                              <div className="text-[10px] text-foreground">{r.totalTrades}회</div>
                            </div>
                            <div className="text-center">
                              <div className="text-[9px] text-muted-foreground">연환산</div>
                              <div className={`text-[10px] ${r.annualizedReturn >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                {fmtPct(r.annualizedReturn)}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 적용 안내 */}
              <div className="bg-muted/20 rounded p-2 flex items-start gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  최적 파라미터를 전략 설정 탭에서 수동으로 적용하세요.
                  과최적화(Overfitting) 방지를 위해 Out-of-Sample 검증을 권장합니다.
                </p>
              </div>
            </div>
          )}

          {optimize.isError && (
            <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded p-2">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
              <p className="text-xs text-destructive">{optimize.error.message}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
