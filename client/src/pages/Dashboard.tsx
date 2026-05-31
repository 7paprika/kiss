import { useState, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Settings, Key, BarChart2, ChevronLeft, ChevronRight,
  Activity, Wifi, WifiOff, Bot, MessageSquare, FileText,
  Zap, Loader2
} from "lucide-react";

import WatchlistPanel from "@/components/WatchlistPanel";
import TradingChart from "@/components/TradingChart";
import OrderPanel from "@/components/OrderPanel";
import StrategyPanel from "@/components/StrategyPanel";
import TelegramPanel from "@/components/TelegramPanel";
import LogPanel from "@/components/LogPanel";
import KisSettingsModal from "@/components/KisSettingsModal";
import BacktestPanel from "@/components/BacktestPanel";

type RightTab = "strategy" | "telegram" | "log" | "backtest";

export default function Dashboard() {
  const { user, loading, isAuthenticated } = useAuth();
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null);
  const [showKisSettings, setShowKisSettings] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("strategy");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const { data: kisSettings } = trpc.kis.getSettings.useQuery(
    undefined,
    { enabled: isAuthenticated, refetchInterval: 60_000 }
  );
  const { data: autoConfig } = trpc.autoTrader.getConfig.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  // Show KIS settings on first login if not configured
  useEffect(() => {
    if (isAuthenticated && kisSettings !== undefined && !kisSettings?.hasAppKey) {
      setShowKisSettings(true);
    }
  }, [isAuthenticated, kisSettings]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background gap-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <BarChart2 size={32} className="text-primary" />
            <h1 className="text-2xl font-bold">KIS Auto Trader</h1>
          </div>
          <p className="text-muted-foreground text-sm">한국투자증권 Open API 자동매매 시스템</p>
        </div>
        <a
          href={getLoginUrl()}
          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          로그인하여 시작하기
        </a>
        <div className="text-xs text-muted-foreground text-center max-w-sm">
          <p>논문 검증 단기·스윙 전략 5종 내장</p>
          <p>전문가 수준 캔들차트 · 텔레그램 알림 · 보안 강화</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Top Header */}
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <BarChart2 size={16} className="text-primary" />
            <span className="font-bold text-sm">KIS Auto Trader</span>
          </div>

          {/* Connection Status */}
          <div className={`flex items-center gap-1 text-xs ${kisSettings?.isActive ? "text-bull" : "text-muted-foreground"}`}>
            {kisSettings?.isActive ? <Wifi size={12} /> : <WifiOff size={12} />}
            <span>{kisSettings?.isActive ? (kisSettings.mode === "real" ? "실전" : "모의") : "미연결"}</span>
          </div>

          {/* Auto Trading Status */}
          {autoConfig?.isRunning && (
            <div className="flex items-center gap-1 text-xs text-bull">
              <Bot size={12} className="animate-pulse-green" />
              <span>자동매매 중</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Selected Stock */}
          {selectedStock && (
            <div className="flex items-center gap-1 px-2 py-0.5 bg-secondary rounded text-xs">
              <Activity size={11} className="text-primary" />
              <span className="font-medium">{selectedStock.name}</span>
              <span className="text-muted-foreground font-mono">{selectedStock.code}</span>
            </div>
          )}

          {/* User */}
          <span className="text-xs text-muted-foreground">{user?.name}</span>

          {/* KIS Settings Button */}
          <button
            onClick={() => setShowKisSettings(true)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              kisSettings?.hasAppKey
                ? "text-muted-foreground hover:text-foreground"
                : "text-bear hover:text-foreground bg-bear/10"
            }`}
            title="KIS API 설정"
          >
            <Key size={12} />
            <span className="hidden sm:inline">API 설정</span>
          </button>

          {/* Logout */}
          <LogoutButton />
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Watchlist */}
        <div
          className={`flex flex-col border-r border-border bg-card transition-all duration-200 shrink-0 ${
            leftCollapsed ? "w-0 overflow-hidden" : "w-52"
          }`}
        >
          <WatchlistPanel
            selectedCode={selectedStock?.code || null}
            onSelect={(code, name) => setSelectedStock({ code, name })}
          />
        </div>

        {/* Collapse Toggle Left */}
        <button
          onClick={() => setLeftCollapsed(!leftCollapsed)}
          className="w-3 flex items-center justify-center bg-card border-r border-border hover:bg-accent transition-colors shrink-0 text-muted-foreground hover:text-foreground"
        >
          {leftCollapsed ? <ChevronRight size={10} /> : <ChevronLeft size={10} />}
        </button>

        {/* Center - Chart + Order */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedStock ? (
            <>
              {/* Chart Area */}
              <div className="flex-1 overflow-hidden">
                <TradingChart stockCode={selectedStock.code} stockName={selectedStock.name} />
              </div>
              {/* Order Panel */}
              <div className="h-72 border-t border-border overflow-hidden">
                <OrderPanel stockCode={selectedStock.code} stockName={selectedStock.name} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
              <BarChart2 size={48} className="opacity-20" />
              <div className="text-center">
                <p className="text-sm font-medium">종목을 선택하세요</p>
                <p className="text-xs mt-1">좌측 관심종목에서 종목을 클릭하거나 추가하세요</p>
              </div>
              {!kisSettings?.hasAppKey && (
                <button
                  onClick={() => setShowKisSettings(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-primary/20 text-primary border border-primary/30 rounded text-sm hover:bg-primary/30 transition-colors"
                >
                  <Key size={14} />
                  KIS API 설정하기
                </button>
              )}
            </div>
          )}
        </div>

        {/* Collapse Toggle Right */}
        <button
          onClick={() => setRightCollapsed(!rightCollapsed)}
          className="w-3 flex items-center justify-center bg-card border-l border-border hover:bg-accent transition-colors shrink-0 text-muted-foreground hover:text-foreground"
        >
          {rightCollapsed ? <ChevronLeft size={10} /> : <ChevronRight size={10} />}
        </button>

        {/* Right Panel - Strategy / Telegram / Log */}
        <div
          className={`flex flex-col border-l border-border bg-card transition-all duration-200 shrink-0 ${
            rightCollapsed ? "w-0 overflow-hidden" : "w-80"
          }`}
        >
          {/* Right Tab Bar */}
          <div className="flex border-b border-border shrink-0">
            {([
              { id: "strategy" as RightTab, icon: Zap, label: "전략" },
              { id: "backtest" as RightTab, icon: BarChart2, label: "백테스트" },
              { id: "telegram" as RightTab, icon: MessageSquare, label: "알림" },
              { id: "log" as RightTab, icon: FileText, label: "로그" },
            ] as const).map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setRightTab(id)}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs transition-colors ${
                  rightTab === id
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={11} />
                {label}
              </button>
            ))}
          </div>

          {/* Right Tab Content */}
          <div className="flex-1 overflow-hidden">
            {rightTab === "strategy" && <StrategyPanel />}
            {rightTab === "backtest" && (
              <BacktestPanel
                selectedStockCode={selectedStock?.code}
                selectedStockName={selectedStock?.name}
              />
            )}
            {rightTab === "telegram" && (
              <div className="overflow-y-auto h-full">
                <TelegramPanel />
              </div>
            )}
            {rightTab === "log" && <LogPanel />}
          </div>
        </div>
      </div>

      {/* KIS Settings Modal */}
      {showKisSettings && <KisSettingsModal onClose={() => setShowKisSettings(false)} />}
    </div>
  );
}

function LogoutButton() {
  const utils = trpc.useUtils();
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      toast.success("로그아웃되었습니다");
    },
  });

  return (
    <button
      onClick={() => logoutMutation.mutate()}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-accent"
    >
      로그아웃
    </button>
  );
}
