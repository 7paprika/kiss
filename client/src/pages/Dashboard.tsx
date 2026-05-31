import { useState, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Settings, Key, BarChart2, ChevronLeft, ChevronRight,
  Activity, Wifi, WifiOff, Bot, MessageSquare, FileText,
  Zap, Loader2, TrendingUp, CreditCard, Newspaper, Star,
  LayoutDashboard, LineChart
} from "lucide-react";

import WatchlistPanel from "@/components/WatchlistPanel";
import TradingChart from "@/components/TradingChart";
import OrderPanel from "@/components/OrderPanel";
import StrategyPanel from "@/components/StrategyPanel";
import TelegramPanel from "@/components/TelegramPanel";
import LogPanel from "@/components/LogPanel";
import KisSettingsModal from "@/components/KisSettingsModal";
import BacktestPanel from "@/components/BacktestPanel";
import ScreenerPanel from "@/components/ScreenerPanel";
import PerformancePanel from "@/components/PerformancePanel";
import AccountManagerModal from "@/components/AccountManagerModal";
import NewsPanel from "@/components/NewsPanel";
import OptimizerPanel from "@/components/OptimizerPanel";
import { useRealtimeSignal } from "@/hooks/useRealtime";

type RightTab = "strategy" | "backtest" | "screener" | "performance" | "telegram" | "log" | "news" | "optimizer";
type MobileTab = "watchlist" | "chart" | "order" | "strategy" | "more";

export default function Dashboard() {
  const { user, loading, isAuthenticated } = useAuth();
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null);
  const [showKisSettings, setShowKisSettings] = useState(false);
  const [showAccountManager, setShowAccountManager] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("strategy");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [signalBanner, setSignalBanner] = useState<{
    stockCode: string; stockName?: string; action?: string;
    signal?: string; strategy?: string; strategyName?: string
  } | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  const [isMobile, setIsMobile] = useState(false);

  // 모바일 감지
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // 실시간 신호 수신
  useRealtimeSignal((signal) => {
    setSignalBanner(signal);
    toast((
      <div className="flex flex-col gap-0.5">
        <div className="font-semibold text-xs">
          {(signal.action ?? signal.signal) === "BUY" ? "📈 매수" : "📉 매도"} 신호 발생
        </div>
        <div className="text-xs text-muted-foreground">
          {signal.stockName ?? signal.stockCode} ({signal.stockCode}) · {signal.strategy ?? signal.strategyName}
        </div>
      </div>
    ), { duration: 6000 });
    setTimeout(() => setSignalBanner(null), 10000);
  });

  const { data: kisSettings } = trpc.kis.getSettings.useQuery(
    undefined,
    { enabled: isAuthenticated, refetchInterval: 60_000 }
  );
  const { data: autoConfig } = trpc.autoTrader.getConfig.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

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
          <p>논문 검증 단기·스윙 전략 7종 내장</p>
          <p>전문가 수준 캔들차트 · 백테스트 · 텔레그램 알림 · 보안 강화</p>
        </div>
      </div>
    );
  }

  // ─── 우측 탭 정의 ─────────────────────────────────────────────────────────
  const rightTabs = [
    { id: "strategy" as RightTab, icon: Zap, label: "전략" },
    { id: "backtest" as RightTab, icon: BarChart2, label: "백테스트" },
    { id: "optimizer" as RightTab, icon: Zap, label: "최적화" },
    { id: "screener" as RightTab, icon: Activity, label: "스크리너" },
    { id: "performance" as RightTab, icon: TrendingUp, label: "성과" },
    { id: "news" as RightTab, icon: Newspaper, label: "뉴스" },
    { id: "telegram" as RightTab, icon: MessageSquare, label: "알림" },
    { id: "log" as RightTab, icon: FileText, label: "로그" },
  ] as const;

  // ─── 모바일 탭 정의 ────────────────────────────────────────────────────────
  const mobileTabs = [
    { id: "watchlist" as MobileTab, icon: Star, label: "관심" },
    { id: "chart" as MobileTab, icon: LineChart, label: "차트" },
    { id: "order" as MobileTab, icon: LayoutDashboard, label: "주문" },
    { id: "strategy" as MobileTab, icon: Zap, label: "전략" },
    { id: "more" as MobileTab, icon: FileText, label: "더보기" },
  ] as const;

  // ─── 공통 헤더 ─────────────────────────────────────────────────────────────
  const header = (
    <header className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-card shrink-0">
      <div className="flex items-center gap-2 md:gap-3">
        <div className="flex items-center gap-1.5">
          <BarChart2 size={16} className="text-primary" />
          <span className="font-bold text-sm">KIS Auto Trader</span>
        </div>
        <div className={`flex items-center gap-1 text-xs ${kisSettings?.isActive ? "text-bull" : "text-muted-foreground"}`}>
          {kisSettings?.isActive ? <Wifi size={12} /> : <WifiOff size={12} />}
          <span className="hidden sm:inline">{kisSettings?.isActive ? (kisSettings.mode === "real" ? "실전" : "모의") : "미연결"}</span>
        </div>
        {autoConfig?.isRunning && (
          <div className="flex items-center gap-1 text-xs text-bull">
            <Bot size={12} className="animate-pulse-green" />
            <span className="hidden sm:inline">자동매매 중</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 md:gap-2">
        {selectedStock && (
          <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 bg-secondary rounded text-xs">
            <Activity size={11} className="text-primary" />
            <span className="font-medium">{selectedStock.name}</span>
            <span className="text-muted-foreground font-mono">{selectedStock.code}</span>
          </div>
        )}
        <span className="hidden md:inline text-xs text-muted-foreground">{user?.name}</span>
        <button
          onClick={() => setShowAccountManager(true)}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="계좌 관리"
        >
          <CreditCard size={12} />
          <span className="hidden md:inline">계좌</span>
        </button>
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
        <LogoutButton />
      </div>
    </header>
  );

  // ─── 신호 배너 ─────────────────────────────────────────────────────────────
  const signalBannerEl = signalBanner && (
    <div className={`flex items-center justify-between px-4 py-1.5 text-xs font-medium shrink-0 ${
      (signalBanner.action ?? signalBanner.signal) === "BUY"
        ? "bg-bull/20 text-bull border-b border-bull/30"
        : "bg-bear/20 text-bear border-b border-bear/30"
    }`}>
      <div className="flex items-center gap-2">
        <Zap size={12} className="animate-pulse" />
        <span>{(signalBanner.action ?? signalBanner.signal) === "BUY" ? "매수" : "매도"} 신호</span>
        <span className="font-bold">{signalBanner.stockName ?? signalBanner.stockCode} ({signalBanner.stockCode})</span>
        <span className="text-muted-foreground hidden sm:inline">· {signalBanner.strategy ?? signalBanner.strategyName}</span>
      </div>
      <button onClick={() => setSignalBanner(null)} className="opacity-60 hover:opacity-100 text-lg leading-none">×</button>
    </div>
  );

  // ─── 우측 패널 콘텐츠 ──────────────────────────────────────────────────────
  const rightPanelContent = (
    <div className="flex flex-col h-full">
      {/* 탭 바 - 스크롤 가능 */}
      <div className="flex border-b border-border shrink-0 overflow-x-auto scrollbar-none">
        {rightTabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setRightTab(id)}
            className={`flex-shrink-0 flex items-center justify-center gap-1 px-2 py-2 text-[10px] transition-colors ${
              rightTab === id
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={10} />
            {label}
          </button>
        ))}
      </div>
      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-hidden">
        {rightTab === "strategy" && <StrategyPanel />}
        {rightTab === "backtest" && (
          <BacktestPanel
            selectedStockCode={selectedStock?.code}
            selectedStockName={selectedStock?.name}
          />
        )}
        {rightTab === "optimizer" && (
          <OptimizerPanel selectedStock={selectedStock?.code} />
        )}
        {rightTab === "telegram" && (
          <div className="overflow-y-auto h-full">
            <TelegramPanel />
          </div>
        )}
        {rightTab === "log" && <LogPanel />}
        {rightTab === "screener" && (
          <ScreenerPanel
            onSelectStock={(code, name) => setSelectedStock({ code, name: name || code })}
          />
        )}
        {rightTab === "performance" && (
          <div className="overflow-y-auto h-full">
            <PerformancePanel />
          </div>
        )}
        {rightTab === "news" && (
          <NewsPanel
            stockCode={selectedStock?.code}
            stockName={selectedStock?.name}
          />
        )}
      </div>
    </div>
  );

  // ─── 모바일 레이아웃 ───────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        {signalBannerEl}
        {header}

        {/* 모바일 메인 콘텐츠 */}
        <div className="flex-1 overflow-hidden">
          {mobileTab === "watchlist" && (
            <WatchlistPanel
              selectedCode={selectedStock?.code || null}
              onSelect={(code, name) => {
                setSelectedStock({ code, name });
                setMobileTab("chart");
              }}
            />
          )}

          {mobileTab === "chart" && (
            <div className="h-full flex flex-col">
              {selectedStock ? (
                <TradingChart stockCode={selectedStock.code} stockName={selectedStock.name} />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <BarChart2 size={40} className="opacity-20" />
                  <div className="text-center">
                    <p className="text-sm font-medium">종목을 선택하세요</p>
                    <p className="text-xs mt-1">관심종목 탭에서 종목을 선택하세요</p>
                  </div>
                  <button
                    onClick={() => setMobileTab("watchlist")}
                    className="px-4 py-2 bg-primary/20 text-primary border border-primary/30 rounded text-sm"
                  >
                    관심종목 보기
                  </button>
                </div>
              )}
            </div>
          )}

          {mobileTab === "order" && selectedStock && (
            <OrderPanel stockCode={selectedStock.code} stockName={selectedStock.name} />
          )}

          {mobileTab === "order" && !selectedStock && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground h-full">
              <LayoutDashboard size={40} className="opacity-20" />
              <p className="text-sm">종목을 먼저 선택하세요</p>
              <button
                onClick={() => setMobileTab("watchlist")}
                className="px-4 py-2 bg-primary/20 text-primary border border-primary/30 rounded text-sm"
              >
                관심종목 보기
              </button>
            </div>
          )}

          {mobileTab === "strategy" && (
            <div className="h-full overflow-y-auto">
              <StrategyPanel />
            </div>
          )}

          {mobileTab === "more" && (
            <div className="h-full flex flex-col">
              {/* 더보기 탭 내 서브 탭 */}
              <div className="flex border-b border-border overflow-x-auto scrollbar-none shrink-0">
                {([
                  { id: "backtest", label: "백테스트" },
                  { id: "optimizer", label: "최적화" },
                  { id: "screener", label: "스크리너" },
                  { id: "performance", label: "성과" },
                  { id: "news", label: "뉴스" },
                  { id: "telegram", label: "알림" },
                  { id: "log", label: "로그" },
                ] as const).map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setRightTab(id)}
                    className={`flex-shrink-0 px-3 py-2 text-xs transition-colors ${
                      rightTab === id
                        ? "text-primary border-b-2 border-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-hidden">
                {rightTab === "backtest" && (
                  <BacktestPanel
                    selectedStockCode={selectedStock?.code}
                    selectedStockName={selectedStock?.name}
                  />
                )}
                {rightTab === "optimizer" && <OptimizerPanel selectedStock={selectedStock?.code} />}
                {rightTab === "screener" && (
                  <ScreenerPanel
                    onSelectStock={(code, name) => {
                      setSelectedStock({ code, name: name || code });
                      setMobileTab("chart");
                    }}
                  />
                )}
                {rightTab === "performance" && (
                  <div className="overflow-y-auto h-full"><PerformancePanel /></div>
                )}
                {rightTab === "news" && (
                  <NewsPanel stockCode={selectedStock?.code} stockName={selectedStock?.name} />
                )}
                {rightTab === "telegram" && (
                  <div className="overflow-y-auto h-full"><TelegramPanel /></div>
                )}
                {rightTab === "log" && <LogPanel />}
              </div>
            </div>
          )}
        </div>

        {/* 하단 탭 네비게이션 */}
        <nav className="flex border-t border-border bg-card shrink-0 safe-area-bottom">
          {mobileTabs.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setMobileTab(id)}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] transition-colors ${
                mobileTab === id
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {showKisSettings && <KisSettingsModal onClose={() => setShowKisSettings(false)} />}
        {showAccountManager && <AccountManagerModal onClose={() => setShowAccountManager(false)} />}
      </div>
    );
  }

  // ─── 데스크톱 레이아웃 ─────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {signalBannerEl}
      {header}

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
              <div className="flex-1 overflow-hidden">
                <TradingChart stockCode={selectedStock.code} stockName={selectedStock.name} />
              </div>
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

        {/* Right Panel */}
        <div
          className={`flex flex-col border-l border-border bg-card transition-all duration-200 shrink-0 ${
            rightCollapsed ? "w-0 overflow-hidden" : "w-80"
          }`}
        >
          {rightPanelContent}
        </div>
      </div>

      {showKisSettings && <KisSettingsModal onClose={() => setShowKisSettings(false)} />}
      {showAccountManager && <AccountManagerModal onClose={() => setShowAccountManager(false)} />}
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
