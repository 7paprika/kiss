/**
 * ScreenerPanel - 오늘의 선정 종목 패널
 * 자동매매 사이클에서 선정된 종목 목록 표시 + 수동 스크리너 실행 + 관심종목 추가
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Plus, Search, Star, ChevronDown, ChevronUp
} from "lucide-react";

interface ScreenerPanelProps {
  onSelectStock?: (stockCode: string, stockName?: string) => void;
}

export default function ScreenerPanel({ onSelectStock }: ScreenerPanelProps) {
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [manualCodes, setManualCodes] = useState("");
  const [manualStrategyId, setManualStrategyId] = useState("bollinger_trading");
  const [isExpanded, setIsExpanded] = useState(true);
  const [manualResults, setManualResults] = useState<Array<{
    stockCode: string;
    signal: "BUY" | "SELL" | "HOLD";
    strength: number;
    reason: string;
    priceAtScan: number;
  }>>([]);

  const utils = trpc.useUtils();

  // 오늘의 선정 종목 조회
  const { data: todayResults, isLoading, refetch } = trpc.screener.getToday.useQuery(
    { date: selectedDate || undefined },
    { refetchInterval: 60_000 } // 1분마다 자동 갱신
  );

  // 전략 목록
  const { data: strategyMeta } = trpc.strategy.getAllMeta.useQuery();
  const tradingStrategies = (strategyMeta || []).filter((m: { type: string }) => m.type === "trading");

  // 수동 스크리너 실행
  const runManualMutation = trpc.screener.runManual.useMutation({
    onSuccess: (results) => {
      setManualResults(results as typeof manualResults);
      toast.success(`스크리너 완료: ${results.length}개 종목 분석`);
    },
    onError: (err) => toast.error(`스크리너 실패: ${err.message}`),
  });

  // 관심종목 추가
  const addToWatchlistMutation = trpc.screener.addToWatchlist.useMutation({
    onSuccess: () => {
      toast.success("관심종목에 추가되었습니다");
      utils.watchlist.list.invalidate();
      utils.screener.getToday.invalidate();
    },
    onError: (err) => toast.error(`추가 실패: ${err.message}`),
  });

  const handleRunManual = () => {
    const codes = manualCodes.split(/[\s,]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
    if (!codes.length) { toast.error("종목코드를 입력해주세요"); return; }
    if (codes.length > 20) { toast.error("최대 20개 종목까지 분석 가능합니다"); return; }
    runManualMutation.mutate({ stockCodes: codes, strategyId: manualStrategyId });
  };

  const getSignalBadge = (signal: string, strength: number) => {
    if (signal === "BUY") return (
      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
        <TrendingUp className="w-3 h-3 mr-1" />매수 {(strength * 100).toFixed(0)}%
      </Badge>
    );
    if (signal === "SELL") return (
      <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
        <TrendingDown className="w-3 h-3 mr-1" />매도 {(strength * 100).toFixed(0)}%
      </Badge>
    );
    return (
      <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 text-xs">
        <Minus className="w-3 h-3 mr-1" />관망
      </Badge>
    );
  };

  const allResults = [
    ...(todayResults || []).map(r => ({
      id: r.id,
      stockCode: r.stockCode,
      stockName: r.stockName || r.stockCode,
      signal: r.signal as "BUY" | "SELL" | "HOLD",
      strength: Number(r.strength),
      reason: r.reason || "",
      priceAtScan: Number(r.priceAtScan),
      strategyName: r.strategyName || "",
      addedToWatchlist: r.addedToWatchlist,
      isManual: false,
    })),
  ];

  return (
    <div className="flex flex-col h-full bg-[#0f1117] text-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50">
        <button
          className="flex items-center gap-2 text-sm font-semibold text-slate-200 hover:text-white transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <Search className="w-4 h-4 text-blue-400" />
          오늘의 선정 종목
          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">
            {allResults.length}개
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-slate-400 hover:text-white"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Manual Screener */}
          <div className="px-3 py-2 border-b border-slate-700/30 space-y-2">
            <div className="text-xs text-slate-500 font-medium">수동 스크리너</div>
            <div className="flex gap-1">
              <Input
                value={manualCodes}
                onChange={e => setManualCodes(e.target.value)}
                placeholder="005930,000660 (쉼표 구분)"
                className="h-7 text-xs bg-slate-800/50 border-slate-600/50 text-slate-200 placeholder:text-slate-600"
              />
            </div>
            <div className="flex gap-1">
              <Select value={manualStrategyId} onValueChange={setManualStrategyId}>
                <SelectTrigger className="h-7 text-xs bg-slate-800/50 border-slate-600/50 text-slate-200 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600 text-slate-200">
                  {tradingStrategies.map((s: { id: string; name: string }) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700"
                onClick={handleRunManual}
                disabled={runManualMutation.isPending}
              >
                {runManualMutation.isPending ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Search className="w-3 h-3" />
                )}
              </Button>
            </div>

            {/* Manual Results */}
            {manualResults.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {manualResults.map(r => (
                  <div
                    key={r.stockCode}
                    className="flex items-center justify-between py-1 px-2 rounded bg-slate-800/40 hover:bg-slate-700/40 cursor-pointer transition-colors"
                    onClick={() => onSelectStock?.(r.stockCode)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-300">{r.stockCode}</span>
                      {getSignalBadge(r.signal, r.strength)}
                    </div>
                    <span className="text-xs text-slate-500">
                      {r.priceAtScan > 0 ? r.priceAtScan.toLocaleString() + "원" : "-"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Today's Auto Screener Results */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-16 text-xs text-slate-500">
                <RefreshCw className="w-3 h-3 animate-spin mr-2" />
                조회 중...
              </div>
            ) : allResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-20 text-xs text-slate-600 gap-1">
                <Search className="w-5 h-5" />
                <span>선정된 종목이 없습니다</span>
                <span className="text-slate-700">자동매매 실행 시 자동으로 저장됩니다</span>
              </div>
            ) : (
              <div className="divide-y divide-slate-700/30">
                {allResults.map(r => (
                  <div
                    key={r.id}
                    className="px-3 py-2 hover:bg-slate-800/40 cursor-pointer transition-colors group"
                    onClick={() => onSelectStock?.(r.stockCode, r.stockName)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-200">{r.stockCode}</span>
                        {r.stockName !== r.stockCode && (
                          <span className="text-xs text-slate-500">{r.stockName}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {getSignalBadge(r.signal, r.strength)}
                        {!r.addedToWatchlist && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-yellow-400 transition-all"
                            onClick={e => {
                              e.stopPropagation();
                              addToWatchlistMutation.mutate({
                                screenerResultId: r.id,
                                stockCode: r.stockCode,
                                stockName: r.stockName,
                              });
                            }}
                          >
                            <Star className="w-3 h-3" />
                          </Button>
                        )}
                        {r.addedToWatchlist && (
                          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-600 truncate max-w-[140px]">{r.reason}</span>
                      <span className="text-xs text-slate-500 font-mono">
                        {r.priceAtScan > 0 ? r.priceAtScan.toLocaleString() + "원" : "-"}
                      </span>
                    </div>
                    {r.strategyName && (
                      <div className="text-xs text-slate-700 mt-0.5">{r.strategyName}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
