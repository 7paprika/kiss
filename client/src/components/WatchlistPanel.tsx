import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Plus, Trash2, Bot, BotOff, Search, Star, ChevronUp, ChevronDown, Wifi, WifiOff } from "lucide-react";
import { useRealtimeQuote, useRealtimeConnection } from "@/hooks/useRealtime";

interface Props {
  selectedCode: string | null;
  onSelect: (code: string, name: string) => void;
}

export default function WatchlistPanel({ selectedCode, onSelect }: Props) {
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ code: string; name: string; market: string }>>([])
  const [isSearching, setIsSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const isRealtimeConnected = useRealtimeConnection();

  const utils = trpc.useUtils();
  const { data: watchlist = [] } = trpc.watchlist.list.useQuery();

  const reorderMutation = trpc.watchlist.reorder.useMutation({
    onSuccess: () => utils.watchlist.list.invalidate(),
  });

  const handleMoveUp = (idx: number) => {
    if (idx === 0) return;
    const items = [...watchlist];
    const updates = items.map((item, i) => {
      if (i === idx - 1) return { id: item.id, sortOrder: idx };
      if (i === idx) return { id: item.id, sortOrder: idx - 1 };
      return { id: item.id, sortOrder: i };
    });
    reorderMutation.mutate(updates);
  };

  const handleMoveDown = (idx: number) => {
    if (idx === watchlist.length - 1) return;
    const items = [...watchlist];
    const updates = items.map((item, i) => {
      if (i === idx) return { id: item.id, sortOrder: idx + 1 };
      if (i === idx + 1) return { id: item.id, sortOrder: idx };
      return { id: item.id, sortOrder: i };
    });
    reorderMutation.mutate(updates);
  };

  const addMutation = trpc.watchlist.add.useMutation({
    onSuccess: () => { utils.watchlist.list.invalidate(); toast.success("관심종목에 추가됨"); setShowSearch(false); setSearchKeyword(""); setSearchResults([]); },
    onError: (e) => toast.error(e.message),
  });
  const removeMutation = trpc.watchlist.remove.useMutation({
    onSuccess: () => utils.watchlist.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const toggleAutoMutation = trpc.watchlist.toggleAutoTrading.useMutation({
    onSuccess: () => utils.watchlist.list.invalidate(),
  });

  const searchMutation = trpc.kis.searchStock.useQuery(
    { keyword: searchKeyword },
    { enabled: false }
  );

  const handleSearch = useCallback(async () => {
    if (!searchKeyword.trim()) return;
    setIsSearching(true);
    try {
      const result = await utils.kis.searchStock.fetch({ keyword: searchKeyword });
      setSearchResults(result);
    } catch {
      // Fallback: allow manual add by code
      setSearchResults([{ code: searchKeyword.toUpperCase(), name: searchKeyword, market: "J" }]);
    } finally {
      setIsSearching(false);
    }
  }, [searchKeyword, utils]);

  const formatPrice = (price: number) => price.toLocaleString("ko-KR");
  const formatChange = (rate: number) => `${rate >= 0 ? "+" : ""}${rate.toFixed(2)}%`;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="panel-header">
        <div className="flex items-center gap-1.5">
          <Star size={12} />
          <span>관심종목</span>
          <span className="text-muted-foreground">({watchlist.length})</span>
          <span title={isRealtimeConnected ? "실시간 연결됨" : "실시간 연결 안됨"}>
            {isRealtimeConnected ? (
              <Wifi size={10} className="text-bull" />
            ) : (
              <WifiOff size={10} className="text-muted-foreground" />
            )}
          </span>
        </div>
        <button
          onClick={() => setShowSearch(!showSearch)}
          className="text-muted-foreground hover:text-primary transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Search */}
      {showSearch && (
        <div className="p-2 border-b border-border space-y-2">
          <div className="flex gap-1">
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="종목코드 또는 종목명"
              className="flex-1 text-xs"
            />
            <button
              onClick={handleSearch}
              disabled={isSearching}
              className="px-2 bg-primary text-primary-foreground rounded text-xs"
            >
              <Search size={12} />
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {searchResults.map((r) => (
                <button
                  key={r.code}
                  onClick={() => addMutation.mutate({ stockCode: r.code, stockName: r.name, market: r.market })}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-accent text-xs text-left"
                >
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground font-mono">{r.code}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">종목코드 직접 입력도 가능합니다</p>
        </div>
      )}

      {/* Watchlist Items */}
      <div className="flex-1 overflow-y-auto">
        {watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-xs gap-2">
            <Star size={20} className="opacity-30" />
            <p>관심종목을 추가하세요</p>
          </div>
        ) : (
          watchlist.map((item, idx) => (
            <WatchlistItem
              key={item.id}
              item={item}
              isSelected={selectedCode === item.stockCode}
              onSelect={() => onSelect(item.stockCode, item.stockName || item.stockCode)}
              onRemove={() => removeMutation.mutate({ id: item.id })}
              onToggleAuto={(v) => toggleAutoMutation.mutate({ id: item.id, isAutoTrading: v })}
              onMoveUp={idx > 0 ? () => handleMoveUp(idx) : undefined}
              onMoveDown={idx < watchlist.length - 1 ? () => handleMoveDown(idx) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

function WatchlistItem({
  item,
  isSelected,
  onSelect,
  onRemove,
  onToggleAuto,
  onMoveUp,
  onMoveDown,
}: {
  item: { id: number; stockCode: string; stockName: string | null; isAutoTrading: boolean };
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onToggleAuto: (v: boolean) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  // Use Socket.IO realtime quote (5s polling fallback)
  const { quote: realtimeQuote } = useRealtimeQuote(item.stockCode);
  // REST fallback for initial load
  const { data: restPrice } = trpc.kis.getCurrentPrice.useQuery(
    { stockCode: item.stockCode },
    { refetchInterval: realtimeQuote ? false : 10000, retry: false }
  );

  const price = realtimeQuote
    ? { currentPrice: realtimeQuote.currentPrice, changePrice: realtimeQuote.changePrice, changeRate: realtimeQuote.changeRate }
    : restPrice;

  const isUp = price ? price.changePrice >= 0 : null;

  return (
    <div
      onClick={onSelect}
      className={`flex items-center px-3 py-2 cursor-pointer transition-colors border-b border-border/50 group ${
        isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-accent"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="font-medium text-xs truncate">{item.stockName || item.stockCode}</span>
          {item.isAutoTrading && (
            <span className="text-[10px] px-1 rounded bg-primary/20 text-primary">AUTO</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-[11px] text-muted-foreground">{item.stockCode}</span>
          {price && (
            <span className={`font-mono text-[11px] ${isUp ? "text-bull" : "text-bear"}`}>
              {isUp ? <ChevronUp size={10} className="inline" /> : <ChevronDown size={10} className="inline" />}
              {price.changeRate.toFixed(2)}%
            </span>
          )}
        </div>
      </div>
      <div className="text-right ml-2">
        {price ? (
          <>
            <div className={`font-mono text-xs font-medium ${isUp ? "text-bull" : "text-bear"}`}>
              {price.currentPrice.toLocaleString()}
            </div>
            <div className={`font-mono text-[10px] ${isUp ? "text-bull" : "text-bear"}`}>
              {isUp ? "+" : ""}{price.changePrice.toLocaleString()}
            </div>
          </>
        ) : (
          <div className="text-muted-foreground text-[10px]">--</div>
        )}
      </div>
      <div className="ml-2 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {onMoveUp && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="위로"
          >
            <ChevronUp size={11} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleAuto(!item.isAutoTrading); }}
          className={`p-0.5 rounded transition-colors ${item.isAutoTrading ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
          title={item.isAutoTrading ? "자동매매 해제" : "자동매매 설정"}
        >
          {item.isAutoTrading ? <Bot size={11} /> : <BotOff size={11} />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-0.5 rounded text-muted-foreground hover:text-bear transition-colors"
          title="삭제"
        >
          <Trash2 size={11} />
        </button>
        {onMoveDown && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="아래로"
          >
            <ChevronDown size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
