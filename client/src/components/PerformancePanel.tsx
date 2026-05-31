/**
 * PerformancePanel - 전략 성과 히스토리 대시보드
 * 실제 주문 데이터 기반 수익률·승률·평균 보유기간 시각화
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown, Target, Clock, Award, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

type DaysFilter = 30 | 60 | 90 | 180;

const STRATEGY_LABELS: Record<string, string> = {
  momentum: "단기 모멘텀",
  bollinger_band: "볼린저밴드",
  rsi_reversal: "RSI 역추세",
  golden_cross: "골든크로스",
  high_52w: "52주 신고가",
  macd_trading: "MACD",
  stochastic_trading: "스토캐스틱",
  manual: "수동 주문",
};

export default function PerformancePanel() {
  const [days, setDays] = useState<DaysFilter>(90);
  const [activeTab, setActiveTab] = useState<"strategy" | "daily" | "stock">("strategy");

  const { data: strategyStats, isLoading: loadingStrategy } = trpc.performance.getStrategyStats.useQuery({ days });
  const { data: dailyPnl, isLoading: loadingDaily } = trpc.performance.getDailyPnl.useQuery({ days });
  const { data: stockStats, isLoading: loadingStock } = trpc.performance.getStockStats.useQuery({ days });

  const formatKRW = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}백만`;
    if (Math.abs(n) >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
    return n.toLocaleString("ko-KR");
  };

  const totalPnl = strategyStats?.reduce((s, r) => s + r.totalPnl, 0) ?? 0;
  const totalTrades = strategyStats?.reduce((s, r) => s + r.totalTrades, 0) ?? 0;
  const avgWinRate = strategyStats && strategyStats.length > 0
    ? Math.round(strategyStats.reduce((s, r) => s + r.winRate, 0) / strategyStats.length)
    : 0;

  return (
    <div className="flex flex-col h-full gap-3 overflow-y-auto p-2">
      {/* 기간 필터 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Award className="w-4 h-4 text-yellow-400" />
          전략 성과 히스토리
        </h3>
        <div className="flex gap-1">
          {([30, 60, 90, 180] as DaysFilter[]).map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                days === d ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {d}일
            </button>
          ))}
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-secondary rounded-lg p-2.5 text-center">
          <div className={cn("text-lg font-bold font-mono", totalPnl >= 0 ? "text-emerald-400" : "text-red-400")}>
            {totalPnl >= 0 ? "+" : ""}{formatKRW(totalPnl)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">총 실현 손익</div>
        </div>
        <div className="bg-secondary rounded-lg p-2.5 text-center">
          <div className="text-lg font-bold font-mono text-blue-400">{totalTrades}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">총 거래 수</div>
        </div>
        <div className="bg-secondary rounded-lg p-2.5 text-center">
          <div className={cn("text-lg font-bold font-mono", avgWinRate >= 50 ? "text-emerald-400" : "text-orange-400")}>
            {avgWinRate}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">평균 승률</div>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex border-b border-border/40 gap-1">
        {[
          { id: "strategy" as const, label: "전략별" },
          { id: "daily" as const, label: "일별 손익" },
          { id: "stock" as const, label: "종목별" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium border-b-2 transition-colors",
              activeTab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 전략별 성과 */}
      {activeTab === "strategy" && (
        <div className="space-y-3">
          {loadingStrategy ? (
            <div className="text-center text-muted-foreground text-xs py-8">로딩 중...</div>
          ) : !strategyStats || strategyStats.length === 0 ? (
            <div className="text-center py-10">
              <BarChart2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">아직 거래 데이터가 없습니다</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">자동매매 실행 후 성과가 집계됩니다</p>
            </div>
          ) : (
            <>
              {/* 전략별 수익률 바 차트 */}
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-[10px] text-muted-foreground mb-2">전략별 평균 수익률 (%)</p>
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={strategyStats} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="strategyId" tickFormatter={id => STRATEGY_LABELS[id]?.slice(0, 4) ?? id} tick={{ fontSize: 9, fill: "#888" }} />
                    <YAxis tick={{ fontSize: 9, fill: "#888" }} tickFormatter={v => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 6, fontSize: 11 }}
                      formatter={(v: number) => [`${v.toFixed(2)}%`, "평균 수익률"]}
                      labelFormatter={id => STRATEGY_LABELS[id as string] ?? id}
                    />
                    <ReferenceLine y={0} stroke="#555" />
                    <Bar dataKey="avgPnlRate" radius={[3, 3, 0, 0]}>
                      {strategyStats.map((entry, i) => (
                        <Cell key={i} fill={entry.avgPnlRate >= 0 ? "#26a69a" : "#ef5350"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* 전략별 상세 테이블 */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 text-muted-foreground">
                      <th className="text-left py-1.5 pr-2">전략</th>
                      <th className="text-right py-1.5 pr-2">거래</th>
                      <th className="text-right py-1.5 pr-2">승률</th>
                      <th className="text-right py-1.5 pr-2">손익</th>
                      <th className="text-right py-1.5 pr-2">평균수익</th>
                      <th className="text-right py-1.5">보유일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strategyStats.map(s => (
                      <tr key={s.strategyId} className="border-b border-border/20 hover:bg-secondary/30 transition-colors">
                        <td className="py-1.5 pr-2 font-medium text-foreground">
                          {STRATEGY_LABELS[s.strategyId] ?? s.strategyId}
                        </td>
                        <td className="text-right py-1.5 pr-2 text-muted-foreground">{s.totalTrades}</td>
                        <td className={cn("text-right py-1.5 pr-2 font-mono", s.winRate >= 50 ? "text-emerald-400" : "text-orange-400")}>
                          {s.winRate}%
                        </td>
                        <td className={cn("text-right py-1.5 pr-2 font-mono", s.totalPnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                          {s.totalPnl >= 0 ? "+" : ""}{formatKRW(s.totalPnl)}
                        </td>
                        <td className={cn("text-right py-1.5 pr-2 font-mono", s.avgPnlRate >= 0 ? "text-emerald-400" : "text-red-400")}>
                          {s.avgPnlRate >= 0 ? "+" : ""}{s.avgPnlRate.toFixed(2)}%
                        </td>
                        <td className="text-right py-1.5 text-muted-foreground font-mono">{s.avgHoldDays}일</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* 일별 손익 */}
      {activeTab === "daily" && (
        <div className="space-y-3">
          {loadingDaily ? (
            <div className="text-center text-muted-foreground text-xs py-8">로딩 중...</div>
          ) : !dailyPnl || dailyPnl.length === 0 ? (
            <div className="text-center py-10">
              <TrendingUp className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">일별 손익 데이터가 없습니다</p>
            </div>
          ) : (
            <>
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-[10px] text-muted-foreground mb-2">일별 매도 금액 추이</p>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={dailyPnl} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: "#888" }}
                      tickFormatter={d => d.slice(5)}
                      interval={Math.floor(dailyPnl.length / 6)}
                    />
                    <YAxis tick={{ fontSize: 9, fill: "#888" }} tickFormatter={v => formatKRW(v)} />
                    <Tooltip
                      contentStyle={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 6, fontSize: 11 }}
                      formatter={(v: number) => [`${v.toLocaleString("ko-KR")}원`, "매도금액"]}
                    />
                    <Line type="monotone" dataKey="amount" stroke="#26a69a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {[...dailyPnl].reverse().slice(0, 20).map(d => (
                  <div key={d.date} className="flex justify-between items-center px-2 py-1 rounded hover:bg-secondary/30 text-xs">
                    <span className="text-muted-foreground font-mono">{d.date}</span>
                    <span className="font-mono text-emerald-400">{d.amount.toLocaleString("ko-KR")}원</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 종목별 성과 */}
      {activeTab === "stock" && (
        <div className="space-y-3">
          {loadingStock ? (
            <div className="text-center text-muted-foreground text-xs py-8">로딩 중...</div>
          ) : !stockStats || stockStats.length === 0 ? (
            <div className="text-center py-10">
              <Target className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">종목별 성과 데이터가 없습니다</p>
            </div>
          ) : (
            <>
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-[10px] text-muted-foreground mb-2">종목별 실현 손익 (상위 10)</p>
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={stockStats.slice(0, 10)} layout="vertical" margin={{ top: 4, right: 30, bottom: 4, left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" tick={{ fontSize: 9, fill: "#888" }} tickFormatter={v => formatKRW(v)} />
                    <YAxis type="category" dataKey="stockName" tick={{ fontSize: 9, fill: "#888" }} width={40} />
                    <Tooltip
                      contentStyle={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 6, fontSize: 11 }}
                      formatter={(v: number) => [`${v.toLocaleString("ko-KR")}원`, "실현 손익"]}
                    />
                    <ReferenceLine x={0} stroke="#555" />
                    <Bar dataKey="realizedPnl" radius={[0, 3, 3, 0]}>
                      {stockStats.slice(0, 10).map((entry, i) => (
                        <Cell key={i} fill={entry.realizedPnl >= 0 ? "#26a69a" : "#ef5350"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 text-muted-foreground">
                      <th className="text-left py-1.5 pr-2">종목</th>
                      <th className="text-right py-1.5 pr-2">실현 손익</th>
                      <th className="text-right py-1.5">수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockStats.map(s => (
                      <tr key={s.stockCode} className="border-b border-border/20 hover:bg-secondary/30 transition-colors">
                        <td className="py-1.5 pr-2">
                          <span className="font-medium text-foreground">{s.stockName}</span>
                          <span className="text-muted-foreground ml-1 text-[10px]">{s.stockCode}</span>
                        </td>
                        <td className={cn("text-right py-1.5 pr-2 font-mono", s.realizedPnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                          {s.realizedPnl >= 0 ? "+" : ""}{s.realizedPnl.toLocaleString("ko-KR")}
                        </td>
                        <td className={cn("text-right py-1.5 font-mono", s.pnlRate >= 0 ? "text-emerald-400" : "text-red-400")}>
                          {s.pnlRate >= 0 ? "+" : ""}{s.pnlRate.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
