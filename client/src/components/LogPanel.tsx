import { trpc } from "@/lib/trpc";
import { RefreshCw, AlertCircle, Info, TrendingUp, AlertTriangle } from "lucide-react";

export default function LogPanel() {
  const { data: logs = [], refetch, isFetching } = trpc.autoTrader.getLogs.useQuery(
    { limit: 100 },
    { refetchInterval: 10_000 }
  );

  const levelConfig = {
    info: { icon: Info, color: "text-muted-foreground", bg: "" },
    warn: { icon: AlertTriangle, color: "text-yellow-400", bg: "bg-yellow-400/5" },
    error: { icon: AlertCircle, color: "text-bear", bg: "bg-bear/5" },
    signal: { icon: TrendingUp, color: "text-primary", bg: "bg-primary/5" },
  };

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span>자동매매 로그</span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-muted-foreground text-xs gap-2">
            <Info size={16} className="opacity-30" />
            <p>로그 없음</p>
          </div>
        ) : (
          logs.map((log) => {
            const level = (log.level || "info") as keyof typeof levelConfig;
            const { icon: Icon, color, bg } = levelConfig[level] || levelConfig.info;
            return (
              <div key={log.id} className={`flex gap-2 px-3 py-1.5 border-b border-border/30 ${bg}`}>
                <Icon size={11} className={`${color} mt-0.5 shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {log.stockCode && (
                      <span className="font-mono text-[10px] text-primary">{log.stockCode}</span>
                    )}
                    <span className={`text-[11px] ${color}`}>{log.message}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {new Date(log.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
