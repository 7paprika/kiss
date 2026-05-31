import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Play, TrendingUp, TrendingDown, BarChart2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface Props {
  selectedStockCode?: string;
  selectedStockName?: string;
}

export default function BacktestPanel({ selectedStockCode, selectedStockName }: Props) {
  const [stockCode, setStockCode] = useState(selectedStockCode || "");
  const [strategyId, setStrategyId] = useState("");
  const [period, setPeriod] = useState<"D" | "W" | "M">("D");
  const [initialCapital, setInitialCapital] = useState(10_000_000);
  const [stopLossPct, setStopLossPct] = useState(0);
  const [takeProfitPct, setTakeProfitPct] = useState(0);
  const [showTrades, setShowTrades] = useState(false);

  const { data: strategies } = trpc.strategy.getAllMeta.useQuery();
  const tradingStrategies = strategies?.filter(s => s.type === "trading") ?? [];

  const runBacktest = trpc.backtest.run.useMutation();

  // Sync selectedStockCode from parent
  useEffect(() => {
    if (selectedStockCode) setStockCode(selectedStockCode);
  }, [selectedStockCode]);

  const handleRun = () => {
    if (!stockCode || !strategyId) return;
    runBacktest.mutate({ stockCode, strategyId, period, initialCapital, stopLossPct, takeProfitPct });
  };

  const result = runBacktest.data;

  const equityCurveData = result?.equityCurve.map(e => ({
    date: e.date.slice(5), // MM-DD
    equity: Math.round(e.equity / 10_000), // 만원 단위
  })) ?? [];

  const statCard = (label: string, value: string, color?: string) => (
    <div className="bg-secondary/50 rounded p-2 text-center">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-bold font-mono ${color ?? ""}`}>{value}</div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 gap-3">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">백테스트</div>

      {/* Input Section */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">종목코드</label>
            <input
              type="text"
              value={stockCode}
              onChange={e => setStockCode(e.target.value.toUpperCase())}
              placeholder={selectedStockCode || "005930"}
              className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs font-mono mt-0.5"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">봉 주기</label>
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as "D" | "W" | "M")}
              className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs mt-0.5"
            >
              <option value="D">일봉</option>
              <option value="W">주봉</option>
              <option value="M">월봉</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground">매매 전략</label>
          <select
            value={strategyId}
            onChange={e => setStrategyId(e.target.value)}
            className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs mt-0.5"
          >
            <option value="">전략 선택...</option>
            {tradingStrategies.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">초기자본(만원)</label>
            <input
              type="number"
              value={initialCapital / 10_000}
              onChange={e => setInitialCapital(Number(e.target.value) * 10_000)}
              min={10}
              step={100}
              className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs font-mono mt-0.5"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">손절(%)</label>
            <input
              type="number"
              value={stopLossPct}
              onChange={e => setStopLossPct(Number(e.target.value))}
              min={0}
              max={50}
              step={0.5}
              className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs font-mono mt-0.5"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">익절(%)</label>
            <input
              type="number"
              value={takeProfitPct}
              onChange={e => setTakeProfitPct(Number(e.target.value))}
              min={0}
              max={100}
              step={0.5}
              className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs font-mono mt-0.5"
            />
          </div>
        </div>

        <button
          onClick={handleRun}
          disabled={!stockCode || !strategyId || runBacktest.isPending}
          className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded py-1.5 text-xs font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {runBacktest.isPending ? (
            <><span className="animate-spin">⟳</span> 백테스트 실행 중...</>
          ) : (
            <><Play size={12} /> 백테스트 실행</>
          )}
        </button>

        {runBacktest.isError && (
          <div className="flex items-center gap-2 text-bear text-xs bg-bear/10 rounded p-2">
            <AlertCircle size={12} />
            {runBacktest.error.message}
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-3">
          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold">{result.strategyName}</div>
              <div className="text-[10px] text-muted-foreground">{result.period}</div>
            </div>

            {/* Key Stats Grid */}
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              {statCard("총 수익률", `${result.totalReturn >= 0 ? "+" : ""}${result.totalReturn.toFixed(2)}%`,
                result.totalReturn >= 0 ? "text-bull" : "text-bear")}
              {statCard("연환산 수익률", `${result.annualizedReturn >= 0 ? "+" : ""}${result.annualizedReturn.toFixed(2)}%`,
                result.annualizedReturn >= 0 ? "text-bull" : "text-bear")}
              {statCard("최대 낙폭(MDD)", `-${result.maxDrawdown.toFixed(2)}%`, "text-bear")}
              {statCard("샤프 비율", result.sharpeRatio.toFixed(2),
                result.sharpeRatio >= 1 ? "text-bull" : result.sharpeRatio >= 0 ? "text-foreground" : "text-bear")}
              {statCard("승률", `${result.winRate.toFixed(1)}%`,
                result.winRate >= 50 ? "text-bull" : "text-bear")}
              {statCard("총 거래수", `${result.totalTrades}회`)}
            </div>

            {/* Capital Summary */}
            <div className="bg-secondary/30 rounded p-2 text-xs font-mono flex justify-between items-center">
              <span className="text-muted-foreground">
                {(result.initialCapital / 10_000).toLocaleString()}만원
              </span>
              <span className="text-muted-foreground">→</span>
              <span className={result.finalCapital >= result.initialCapital ? "text-bull font-bold" : "text-bear font-bold"}>
                {(result.finalCapital / 10_000).toLocaleString()}만원
              </span>
              <span className={`text-xs ${result.finalCapital >= result.initialCapital ? "text-bull" : "text-bear"}`}>
                ({result.totalReturn >= 0 ? "+" : ""}{((result.finalCapital - result.initialCapital) / 10_000).toLocaleString()}만원)
              </span>
            </div>
          </div>

          {/* Equity Curve Chart */}
          {equityCurveData.length > 1 && (
            <div>
              <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                <BarChart2 size={10} /> 자산 곡선 (만원)
              </div>
              <div className="h-28 bg-secondary/20 rounded">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equityCurveData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "oklch(0.55 0.01 240)" }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9, fill: "oklch(0.55 0.01 240)" }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip
                      contentStyle={{ background: "oklch(0.2 0.01 240)", border: "1px solid oklch(0.3 0.01 240)", fontSize: 10 }}
                      formatter={(v: number) => [`${v.toLocaleString()}만원`, "자산"]}
                    />
                    <ReferenceLine y={initialCapital / 10_000} stroke="oklch(0.45 0.01 240)" strokeDasharray="3 3" />
                    <Line
                      type="monotone"
                      dataKey="equity"
                      stroke={result.totalReturn >= 0 ? "oklch(0.62 0.18 145)" : "oklch(0.58 0.22 25)"}
                      dot={false}
                      strokeWidth={1.5}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Win/Loss Stats */}
          <div className="grid grid-cols-3 gap-1.5 text-[10px]">
            <div className="bg-bull/10 rounded p-2 text-center">
              <div className="text-muted-foreground">승리</div>
              <div className="text-bull font-bold">{result.winTrades}회</div>
              <div className="text-bull">+{result.avgWinPct.toFixed(2)}%</div>
            </div>
            <div className="bg-bear/10 rounded p-2 text-center">
              <div className="text-muted-foreground">손실</div>
              <div className="text-bear font-bold">{result.lossTrades}회</div>
              <div className="text-bear">{result.avgLossPct.toFixed(2)}%</div>
            </div>
            <div className="bg-secondary/50 rounded p-2 text-center">
              <div className="text-muted-foreground">평균</div>
              <div className={`font-bold ${result.avgPnlPct >= 0 ? "text-bull" : "text-bear"}`}>{result.avgPnlPct >= 0 ? "+" : ""}{result.avgPnlPct.toFixed(2)}%</div>
              <div className="text-muted-foreground">수익</div>
            </div>
          </div>

          {/* Trade Log Toggle */}
          {result.trades.length > 0 && (
            <div>
              <button
                onClick={() => setShowTrades(!showTrades)}
                className="w-full flex items-center justify-between text-[10px] text-muted-foreground hover:text-foreground py-1 border-t border-border transition-colors"
              >
                <span>거래 내역 ({result.trades.length}건)</span>
                {showTrades ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {showTrades && (
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="text-left py-1">진입</th>
                        <th className="text-left">청산</th>
                        <th className="text-right">수익률</th>
                        <th className="text-right">사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.map((t, i) => (
                        <tr key={i} className="border-b border-border/30">
                          <td className="py-0.5 font-mono">{t.entryDate.slice(2)}</td>
                          <td className="font-mono">{t.exitDate.slice(2)}</td>
                          <td className={`text-right font-mono font-bold ${t.pnlPct >= 0 ? "text-bull" : "text-bear"}`}>
                            {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
                          </td>
                          <td className="text-right text-muted-foreground truncate max-w-[80px]" title={t.exitReason}>
                            {t.exitReason.slice(0, 8)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!result && !runBacktest.isPending && (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground text-xs gap-2 py-8">
          <BarChart2 size={32} className="opacity-30" />
          <p>종목코드와 전략을 선택 후</p>
          <p>백테스트를 실행하세요</p>
          {selectedStockCode && (
            <p className="text-primary text-[10px]">{selectedStockName} ({selectedStockCode}) 선택됨</p>
          )}
        </div>
      )}
    </div>
  );
}
