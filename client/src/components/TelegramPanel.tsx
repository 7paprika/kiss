import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Send, TestTube, Eye, EyeOff, MessageSquare } from "lucide-react";

export default function TelegramPanel() {
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [showToken, setShowToken] = useState(false);

  const utils = trpc.useUtils();
  const { data: settings } = trpc.settings.getTelegramSettings.useQuery();

  const saveMutation = trpc.settings.saveTelegramSettings.useMutation({
    onSuccess: () => { utils.settings.getTelegramSettings.invalidate(); toast.success("텔레그램 설정 저장됨"); setBotToken(""); },
    onError: (e) => toast.error(e.message),
  });
  const testMutation = trpc.settings.testTelegram.useMutation({
    onSuccess: (r) => r.success ? toast.success(r.message) : toast.error(r.message),
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    if (!chatId && !settings?.chatId) { toast.error("Chat ID를 입력하세요"); return; }
    saveMutation.mutate({
      botToken: botToken || undefined,
      chatId: chatId || settings?.chatId || "",
      isEnabled: settings?.isEnabled ?? true,
      notifyOrder: settings?.notifyOrder ?? true,
      notifySignal: settings?.notifySignal ?? true,
      notifyError: settings?.notifyError ?? true,
    });
  };

  const handleTest = () => {
    const token = botToken || "";
    const id = chatId || settings?.chatId || "";
    if (!token && !settings?.hasBotToken) { toast.error("Bot Token을 입력하세요"); return; }
    if (!id) { toast.error("Chat ID를 입력하세요"); return; }
    if (token) {
      testMutation.mutate({ botToken: token, chatId: id });
    } else {
      toast.info("저장된 토큰으로 테스트하려면 먼저 저장하세요");
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <MessageSquare size={12} />
        <span>텔레그램 알림</span>
      </div>

      {/* Status */}
      {settings && (
        <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
          settings.isEnabled ? "bg-bull/10 text-bull" : "bg-secondary text-muted-foreground"
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${settings.isEnabled ? "bg-bull" : "bg-muted-foreground"}`} />
          {settings.isEnabled ? "알림 활성화됨" : "알림 비활성화됨"}
          {settings.hasBotToken && settings.chatId && (
            <span className="ml-auto text-[10px]">Chat: {settings.chatId}</span>
          )}
        </div>
      )}

      {/* Bot Token */}
      <div>
        <label className="text-[10px] text-muted-foreground mb-1 block">
          Bot Token {settings?.hasBotToken && <span className="text-bull">(저장됨)</span>}
        </label>
        <div className="relative">
          <input
            type={showToken ? "text" : "password"}
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder={settings?.hasBotToken ? "변경하려면 새 토큰 입력" : "1234567890:AABBcc..."}
            className="w-full pr-7 text-xs"
          />
          <button onClick={() => setShowToken(!showToken)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
            {showToken ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        </div>
      </div>

      {/* Chat ID */}
      <div>
        <label className="text-[10px] text-muted-foreground mb-1 block">Chat ID</label>
        <input
          type="text"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder={settings?.chatId || "-1001234567890"}
          className="w-full text-xs"
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">
          @userinfobot 에서 확인 가능
        </p>
      </div>

      {/* Notification toggles */}
      {settings && (
        <div className="space-y-1.5">
          {[
            { key: "notifyOrder" as const, label: "주문 체결 알림" },
            { key: "notifySignal" as const, label: "매매 신호 알림" },
            { key: "notifyError" as const, label: "오류 알림" },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between cursor-pointer">
              <span className="text-xs text-muted-foreground">{label}</span>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => saveMutation.mutate({
                  chatId: chatId || settings.chatId || "",
                  isEnabled: settings.isEnabled,
                  notifyOrder: key === "notifyOrder" ? e.target.checked : settings.notifyOrder,
                  notifySignal: key === "notifySignal" ? e.target.checked : settings.notifySignal,
                  notifyError: key === "notifyError" ? e.target.checked : settings.notifyError,
                })}
                className="accent-primary"
              />
            </label>
          ))}
        </div>
      )}

      {/* Enable toggle */}
      {settings && (
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-xs font-medium">알림 활성화</span>
          <input
            type="checkbox"
            checked={settings.isEnabled}
            onChange={(e) => saveMutation.mutate({
              chatId: chatId || settings.chatId || "",
              isEnabled: e.target.checked,
              notifyOrder: settings.notifyOrder,
              notifySignal: settings.notifySignal,
              notifyError: settings.notifyError,
            })}
            className="accent-primary"
          />
        </label>
      )}

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-primary/20 text-primary border border-primary/30 rounded text-xs hover:bg-primary/30 disabled:opacity-50 transition-colors"
        >
          <Send size={11} />저장
        </button>
        <button
          onClick={handleTest}
          disabled={testMutation.isPending}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-secondary text-muted-foreground border border-border rounded text-xs hover:text-foreground disabled:opacity-50 transition-colors"
        >
          <TestTube size={11} />테스트
        </button>
      </div>
    </div>
  );
}
