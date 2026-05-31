import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Play, TrendingUp, TrendingDown, BarChart2, AlertCircle, ChevronDown, ChevronUp, GitCompare, RefreshCw } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { toast } from "sonner";

interface Props {
  selectedStockCode?: string;
  selectedStockName?: string;
}

type TabType = "single" | "compare";

// Colors for multi-strategy comparison chart
const STRATEGY_COLORS = [
  "oklch(0.62 0.18 145)",  // green
  "oklch(0.65 0.20 240)",  // blue
  "oklch(0.70 0.18 60)",   // yellow
  "oklch(0.65 0.22 300)",  // purple
  "oklch(0.65 0.22 25)",   // orange
  "oklch(0.60 0.20 180)",  // teal
  "oklch(0.58 0.22 0)",    // red
];

export default function BacktestPanel({ selectedStockCode, selectedStockName }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>("single");

  // ── Single backtest state ──────────────────────────────────────────────────
  const [stockCode, setStockCode] = useState(selectedStockCode || "");
  const [strategyId, setStrategyId] = useState("");
  const [period, setPeriod] = useState<"D" | "W" | "M">("D");
  const [initialCapital, setInitialCapital] = useState(10_000_000);
  const [stopLossPct, setStopLossPct] = useState(0);
  const [takeProfitPct, setTakeProfitPct] = useState(0);
  const [showTrades, setShowTrades] = useState(false);

  // ── Compare backtest state ─────────────────────────────────────────────────
  const [cmpStockCode, setCmpStockCode] = useState(selectedStockCode || "");
  const [selectedStrategyIds, setSelectedStrategyIds] = useState<string[]>([]);
  const [cmpPeriod, setCmpPeriod] = useState<"D" | "W" | "M">("D");
  const [cmpCapital, setCmpCapital] = useState(10_000_000);
  const [cmpStopLoss, setCmpStopLoss] = useState(0);
  const [cmpTakeProfit, setCmpTakeProfit] = useState(0);

  const { data: strategies } = trpc.strategy.getAllMeta.useQuery();
  const tradingStrategies = strategies?.filter(s => s.type === "trading") ?? [];

  const runBacktest = trpc.backtest.run.useMutation();
  const runCompare = trpc.backtest.compare.useMutation({
    onError: (err) => toast.error(`비교 백테스트 실패: ${err.message}`),
  });

  // compare returns { batchId, results: unknown[], stockCode }
  type CompareResult = {
    strategyId: string;
    strategyName: string;
    totalReturn: number;
    annualizedReturn: number;
    maxDrawdown: number;
    sharpeRatio: number;
    winRate: number;
    totalTrades: number;
    winTrades: number;
    lossTrades: number;
    equityCurve: Array<{ date: string; equity: number }>;
    error?: string;
  };
  const compareResults: CompareResult[] = (runCompare.data?.results || []) as CompareResult[];

  // Sync selectedStockCode from parent
  useEffect(() => {
    if (selectedStockCode) {
      setStockCode(selectedStockCode);
      setCmpStockCode(selectedStockCode);
    }
  }, [selectedStockCode]);

  const handleRun = () => {
    if (!stockCode || !strategyId) return;
    runBacktest.mutate({ stockCode, strategyId, period, initialCapital, stopLossPct, takeProfitPct });
  };

  const handleCompare = () => {
    if (!cmpStockCode || selectedStrategyIds.length < 2) {
      toast.error("종목코드와 비교할 전략을 2개 이상 선택해주세요");
      return;
    }
    runCompare.mutate({
      stockCode: cmpStockCode,
      strategyIds: selectedStrategyIds,
      period: cmpPeriod,
      initialCapital: cmpCapital,
      stopLossPct: cmpStopLoss,
      takeProfitPct: cmpTakeProfit,
    });
  };

  const toggleStrategy = (id: string) => {
    setSelectedStrategyIds(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const result = runBacktest.data;
  // compareResults defined above

  const equityCurveData = result?.equityCurve.map(e => ({
    date: e.date.slice(5),
    equity: Math.round(e.equity / 10_000),
  })) ?? [];

  // Build merged equity curve for comparison chart
  const compareChartData = (() => {
    if (!compareResults?.length) return [];
    const dateSet = new Set<string>();
    compareResults.forEach(r => r.equityCurve.forEach(e => dateSet.add(e.date.slice(5))));
    const dates = Array.from(dateSet).sort();
    return dates.map(date => {
      const row: Record<string, number | string> = { date };
      compareResults.forEach((r, i) => {
        const point = r.equityCurve.find(e => e.date.slice(5) === date);
        if (point) row[`s${i}`] = Math.round(point.equity / 10_000);
      });
      return row;
    });
  })();

  const statCard = (label: string, value: string, color?: string) => (
    <div className="bg-secondary/50 rounded p-2 text-center">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-bold font-mono ${color ?? ""}`}>{value}</div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Tab Header */}
      <div className="flex border-b border-border shrink-0">
        <button
          onClick={() => setActiveTab("single")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
            activeTab === "single"
              ? "text-primary border-b-2 border-primary bg-primary/5"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart2 size={12} />
          단일 백테스트
        </button>
        <button
          onClick={() => setActiveTab("compare")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
            activeTab === "compare"
              ? "text-primary border-b-2 border-primary bg-primary/5"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <GitCompare size={12} />
          전략 비교
        </button>
      </div>

      {/* ── Single Backtest Tab ─────────────────────────────────────────────── */}
      {activeTab === "single" && (
        <div className="flex flex-col p-3 gap-3 overflow-y-auto">
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
                  min={10} step={100}
                  className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs font-mono mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">손절(%)</label>
                <input
                  type="number"
                  value={stopLossPct}
                  onChange={e => setStopLossPct(Number(e.target.value))}
                  min={0} max={50} step={0.5}
                  className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs font-mono mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">익절(%)</label>
                <input
                  type="number"
                  value={takeProfitPct}
                  onChange={e => setTakeProfitPct(Number(e.target.value))}
                  min={0} max={100} step={0.5}
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
                <><RefreshCw size={12} className="animate-spin" /> 실행 중...</>
              ) : (
                <><Play size={12} /> 백테스트 실행</>
              )}
            </button>

            {runBacktest.isError && (
              <div className="flex items-center gap-2 text-destructive text-xs bg-destructive/10 rounded p-2">
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
                <div className="bg-secondary/30 rounded p-2 text-xs font-mono flex justify-between items-center">
                  <span className="text-muted-foreground">{(result.initialCapital / 10_000).toLocaleString()}만원</span>
                  <span className="text-muted-foreground">→</span>
                  <span className={result.finalCapital >= result.initialCapital ? "text-bull font-bold" : "text-bear font-bold"}>
                    {(result.finalCapital / 10_000).toLocaleString()}만원
                  </span>
                  <span className={`text-xs ${result.finalCapital >= result.initialCapital ? "text-bull" : "text-bear"}`}>
                    ({result.totalReturn >= 0 ? "+" : ""}{((result.finalCapital - result.initialCapital) / 10_000).toLocaleString()}만원)
                  </span>
                </div>
              </div>

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
                        <Line type="monotone" dataKey="equity"
                          stroke={result.totalReturn >= 0 ? "oklch(0.62 0.18 145)" : "oklch(0.58 0.22 25)"}
                          dot={false} strokeWidth={1.5} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

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
                  <div className={`font-bold ${result.avgPnlPct >= 0 ? "text-bull" : "text-bear"}`}>
                    {result.avgPnlPct >= 0 ? "+" : ""}{result.avgPnlPct.toFixed(2)}%
                  </div>
                  <div className="text-muted-foreground">수익</div>
                </div>
              </div>

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
      )}

      {/* ── Compare Tab ─────────────────────────────────────────────────────── */}
      {activeTab === "compare" && (
        <div className="flex flex-col p-3 gap-3 overflow-y-auto">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">종목코드</label>
                <input
                  type="text"
                  value={cmpStockCode}
                  onChange={e => setCmpStockCode(e.target.value.toUpperCase())}
                  placeholder="005930"
                  className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs font-mono mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">봉 주기</label>
                <select
                  value={cmpPeriod}
                  onChange={e => setCmpPeriod(e.target.value as "D" | "W" | "M")}
                  className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs mt-0.5"
                >
                  <option value="D">일봉</option>
                  <option value="W">주봉</option>
                  <option value="M">월봉</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">초기자본(만원)</label>
                <input
                  type="number"
                  value={cmpCapital / 10_000}
                  onChange={e => setCmpCapital(Number(e.target.value) * 10_000)}
                  min={10} step={100}
                  className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs font-mono mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">손절(%)</label>
                <input
                  type="number"
                  value={cmpStopLoss}
                  onChange={e => setCmpStopLoss(Number(e.target.value))}
                  min={0} max={50} step={0.5}
                  className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs font-mono mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">익절(%)</label>
                <input
                  type="number"
                  value={cmpTakeProfit}
                  onChange={e => setCmpTakeProfit(Number(e.target.value))}
                  min={0} max={100} step={0.5}
                  className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs font-mono mt-0.5"
                />
              </div>
            </div>

            {/* Strategy Multi-Select */}
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">
                비교 전략 선택 ({selectedStrategyIds.length}개 선택)
              </label>
              <div className="grid grid-cols-1 gap-1 max-h-32 overflow-y-auto">
                {tradingStrategies.map((s, i) => (
                  <label
                    key={s.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${
                      selectedStrategyIds.includes(s.id)
                        ? "bg-primary/20 text-primary border border-primary/40"
                        : "bg-secondary/30 text-muted-foreground hover:bg-secondary/60 border border-transparent"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedStrategyIds.includes(s.id)}
                      onChange={() => toggleStrategy(s.id)}
                      className="sr-only"
                    />
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: STRATEGY_COLORS[i % STRATEGY_COLORS.length] }}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleCompare}
              disabled={!cmpStockCode || selectedStrategyIds.length < 2 || runCompare.isPending}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded py-1.5 text-xs font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              {runCompare.isPending ? (
                <><RefreshCw size={12} className="animate-spin" /> 비교 실행 중...</>
              ) : (
                <><GitCompare size={12} /> 전략 비교 실행</>
              )}
            </button>
          </div>

          {/* Compare Results */}
          {compareResults && compareResults.filter(r => !r.error).length > 0 && (
            <div className="space-y-3">
              {/* Comparison Table */}
              <div className="border-t border-border pt-3">
                <div className="text-[10px] text-muted-foreground mb-2 font-medium">전략 비교 결과</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-1.5 pr-2 text-muted-foreground font-medium">전략</th>
                        <th className="text-right py-1.5 px-1 text-muted-foreground font-medium">수익률</th>
                        <th className="text-right py-1.5 px-1 text-muted-foreground font-medium">MDD</th>
                        <th className="text-right py-1.5 px-1 text-muted-foreground font-medium">샤프</th>
                        <th className="text-right py-1.5 pl-1 text-muted-foreground font-medium">승률</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareResults
                        .slice()
                        .sort((a: CompareResult, b: CompareResult) => b.totalReturn - a.totalReturn)
                        .map((r: CompareResult, i: number) => {
                          const origIdx = compareResults.indexOf(r);
                          return (
                            <tr key={r.strategyId} className="border-b border-border/30 hover:bg-secondary/20">
                              <td className="py-1.5 pr-2">
                                <div className="flex items-center gap-1.5">
                                  <div
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{ backgroundColor: STRATEGY_COLORS[origIdx % STRATEGY_COLORS.length] }}
                                  />
                                  <span className="truncate max-w-[90px]" title={r.strategyName}>{r.strategyName}</span>
                                  {i === 0 && (
                                    <span className="text-yellow-400 text-[9px]">👑</span>
                                  )}
                                </div>
                              </td>
                              <td className={`text-right px-1 font-mono font-bold ${r.totalReturn >= 0 ? "text-bull" : "text-bear"}`}>
                                {r.totalReturn >= 0 ? "+" : ""}{r.totalReturn.toFixed(1)}%
                              </td>
                              <td className="text-right px-1 font-mono text-bear">
                                -{r.maxDrawdown.toFixed(1)}%
                              </td>
                              <td className={`text-right px-1 font-mono ${r.sharpeRatio >= 1 ? "text-bull" : r.sharpeRatio >= 0 ? "text-foreground" : "text-bear"}`}>
                                {r.sharpeRatio.toFixed(2)}
                              </td>
                              <td className={`text-right pl-1 font-mono ${r.winRate >= 50 ? "text-bull" : "text-bear"}`}>
                                {r.winRate.toFixed(0)}%
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Multi-Strategy Equity Curve */}
              {compareChartData.length > 1 && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                    <BarChart2 size={10} /> 전략별 자산 곡선 비교 (만원)
                  </div>
                  <div className="h-40 bg-secondary/20 rounded">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={compareChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: "oklch(0.55 0.01 240)" }} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 9, fill: "oklch(0.55 0.01 240)" }} tickLine={false} axisLine={false} width={40} />
                        <Tooltip
                          contentStyle={{ background: "oklch(0.2 0.01 240)", border: "1px solid oklch(0.3 0.01 240)", fontSize: 10 }}
                          formatter={(v: number, name: string) => {
                            const idx = parseInt(name.replace("s", ""));
                            const stratName = compareResults[idx]?.strategyName || name;
                            return [`${v.toLocaleString()}만원`, stratName];
                          }}
                        />
                        <ReferenceLine y={cmpCapital / 10_000} stroke="oklch(0.45 0.01 240)" strokeDasharray="3 3" />
                        {compareResults.map((r: CompareResult, i: number) => (
                          <Line
                            key={r.strategyId}
                            type="monotone"
                            dataKey={`s${i}`}
                            stroke={STRATEGY_COLORS[i % STRATEGY_COLORS.length]}
                            dot={false}
                            strokeWidth={1.5}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Best Strategy Recommendation */}
              {compareResults.filter(r => !r.error).length > 0 && (() => {
                const best = [...compareResults].filter(r => !r.error).sort((a: CompareResult, b: CompareResult) => b.totalReturn - a.totalReturn)[0];
                return (
                  <div className="bg-primary/10 border border-primary/30 rounded p-2 text-xs">
                    <div className="flex items-center gap-1.5 mb-1">
                      <TrendingUp size={12} className="text-primary" />
                      <span className="font-semibold text-primary">최적 전략 추천</span>
                    </div>
                    <div className="text-foreground font-medium">{best.strategyName}</div>
                    <div className="text-muted-foreground text-[10px] mt-0.5">
                      수익률 {best.totalReturn >= 0 ? "+" : ""}{best.totalReturn.toFixed(2)}% · 샤프 {best.sharpeRatio.toFixed(2)} · 승률 {best.winRate.toFixed(1)}%
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {!runCompare.data && !runCompare.isPending && (
            <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground text-xs gap-2 py-8">
              <GitCompare size={32} className="opacity-30" />
              <p>2개 이상의 전략을 선택하고</p>
              <p>비교 백테스트를 실행하세요</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
