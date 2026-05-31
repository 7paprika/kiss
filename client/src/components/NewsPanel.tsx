import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Newspaper, FileText, ExternalLink, AlertCircle } from "lucide-react";

interface NewsPanelProps {
  stockCode?: string;
  stockName?: string;
}

export default function NewsPanel({ stockCode, stockName }: NewsPanelProps) {
  const [filter, setFilter] = useState<"all" | "news" | "disclosure">("all");
  const [enabled, setEnabled] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = trpc.news.getStockNews.useQuery(
    {
      stockCode: stockCode || "005930",
      stockName: stockName || "삼성전자",
      limit: 30,
    },
    {
      enabled: !!stockCode && enabled,
      staleTime: 3 * 60 * 1000, // 3분 캐시
      refetchInterval: 5 * 60 * 1000, // 5분마다 자동 갱신
    }
  );

  const marketNews = trpc.news.getMarketNews.useQuery(
    { limit: 15 },
    {
      enabled: !stockCode && enabled,
      staleTime: 3 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
    }
  );

  const newsData = stockCode ? data : marketNews.data;
  const loading = stockCode ? isLoading : marketNews.isLoading;
  const fetchError = stockCode ? error : marketNews.error;
  const doRefetch = stockCode ? refetch : marketNews.refetch;
  const fetching = stockCode ? isFetching : marketNews.isFetching;

  const filtered = newsData?.filter(item =>
    filter === "all" ? true : item.category === filter
  ) || [];

  const newsCount = newsData?.filter(i => i.category === "news").length || 0;
  const disclosureCount = newsData?.filter(i => i.category === "disclosure").length || 0;

  function formatDate(dateStr: string) {
    if (!dateStr) return "";
    // 네이버 금융 날짜 형식: "2024.01.15 14:30" 또는 ISO
    const d = new Date(dateStr.replace(/\./g, "-"));
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}분 전`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}시간 전`;
    return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            {stockCode ? `${stockName || stockCode} 뉴스` : "시장 뉴스"}
          </span>
          {newsData && (
            <span className="text-xs text-muted-foreground">
              ({newsData.length}건)
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => {
              setEnabled(true);
              setTimeout(() => doRefetch(), 100);
            }}
            disabled={fetching}
          >
            <RefreshCw className={`w-3 h-3 ${fetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-border/20">
        {(["all", "news", "disclosure"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
            }`}
          >
            {f === "all" ? `전체 ${newsData ? newsData.length : ""}` :
             f === "news" ? `뉴스 ${newsCount || ""}` :
             `공시 ${disclosureCount || ""}`}
          </button>
        ))}
      </div>

      {/* 컨텐츠 */}
      <ScrollArea className="flex-1">
        {!enabled ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-center px-4">
            <Newspaper className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              {stockCode ? `${stockName || stockCode}의 뉴스를 불러오려면` : "시장 뉴스를 불러오려면"}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setEnabled(true)}
            >
              뉴스 불러오기
            </Button>
          </div>
        ) : loading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : fetchError ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-4">
            <AlertCircle className="w-6 h-6 text-destructive/60" />
            <p className="text-xs text-muted-foreground">뉴스를 불러오지 못했습니다</p>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => doRefetch()}>
              다시 시도
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Newspaper className="w-6 h-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">뉴스가 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {filtered.map((item, idx) => (
              <a
                key={idx}
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col gap-1 px-3 py-2.5 hover:bg-muted/20 transition-colors group"
              >
                <div className="flex items-start gap-1.5">
                  {item.category === "disclosure" ? (
                    <FileText className="w-3 h-3 mt-0.5 text-amber-500 shrink-0" />
                  ) : (
                    <Newspaper className="w-3 h-3 mt-0.5 text-blue-400 shrink-0" />
                  )}
                  <span className="text-xs text-foreground leading-relaxed line-clamp-2 group-hover:text-primary transition-colors">
                    {item.title}
                  </span>
                  <ExternalLink className="w-3 h-3 shrink-0 text-muted-foreground/40 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                {item.description && (
                  <p className="text-xs text-muted-foreground line-clamp-1 pl-4">
                    {item.description}
                  </p>
                )}
                <div className="flex items-center gap-2 pl-4">
                  <Badge
                    variant="outline"
                    className={`h-4 px-1.5 text-[10px] ${
                      item.category === "disclosure"
                        ? "border-amber-500/40 text-amber-500"
                        : "border-blue-400/40 text-blue-400"
                    }`}
                  >
                    {item.source}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDate(item.pubDate)}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
