import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { X, Key, Server, Eye, EyeOff } from "lucide-react";

interface Props {
  onClose: () => void;
}

export default function KisSettingsModal({ onClose }: Props) {
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [accountProduct, setAccountProduct] = useState("01");
  const [mode, setMode] = useState<"real" | "paper">("paper");
  const [showSecret, setShowSecret] = useState(false);

  const utils = trpc.useUtils();
  const { data: settings } = trpc.kis.getSettings.useQuery();
  const saveMutation = trpc.kis.saveSettings.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.kis.getSettings.invalidate(),
        utils.kis.listAccounts.invalidate(),
      ]);
      toast.success("API 설정이 저장되었습니다");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const connectMutation = trpc.kis.connect.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.kis.getSettings.invalidate(),
        utils.kis.listAccounts.invalidate(),
      ]);
      toast.success("KIS API 연결 성공");
    },
    onError: (e) => toast.error(`연결 실패: ${e.message}`),
  });

  const handleSave = () => {
    if (!appKey && !settings?.hasAppKey) { toast.error("App Key를 입력하세요"); return; }
    if (!appSecret && !settings?.hasAppSecret) { toast.error("App Secret을 입력하세요"); return; }
    if (!accountNo) { toast.error("계좌번호를 입력하세요"); return; }
    saveMutation.mutate({ appKey, appSecret, accountNo, accountProduct, mode });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="panel w-[480px] max-w-[95vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Key size={14} />
            <span>KIS Open API 설정</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Mode Selection */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">투자 환경</label>
            <div className="flex gap-2">
              {(["paper", "real"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 rounded text-xs font-medium transition-colors ${
                    mode === m
                      ? m === "real"
                        ? "bg-bear/20 text-bear border border-bear"
                        : "bg-primary/20 text-primary border border-primary"
                      : "bg-secondary text-muted-foreground border border-border hover:border-muted-foreground"
                  }`}
                >
                  {m === "paper" ? "🧪 모의투자" : "💰 실전투자"}
                </button>
              ))}
            </div>
            {mode === "real" && (
              <p className="text-xs text-bear mt-1">⚠️ 실전투자 모드입니다. 실제 자금이 사용됩니다.</p>
            )}
          </div>

          {/* App Key */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              App Key {settings?.hasAppKey && <span className="text-bull">(저장됨)</span>}
            </label>
            <input
              type="text"
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
              placeholder={settings?.hasAppKey ? "변경하려면 새 키 입력" : "KIS Developers App Key"}
              className="w-full"
            />
          </div>

          {/* App Secret */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              App Secret {settings?.hasAppSecret && <span className="text-bull">(저장됨)</span>}
            </label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder={settings?.hasAppSecret ? "변경하려면 새 시크릿 입력" : "KIS Developers App Secret"}
                className="w-full pr-8"
              />
              <button
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
          </div>

          {/* Account */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">계좌번호 (앞 8자리)</label>
              <input
                type="text"
                value={accountNo}
                onChange={(e) => setAccountNo(e.target.value)}
                placeholder={settings?.accountNo || "12345678"}
                maxLength={8}
                className="w-full"
              />
            </div>
            <div className="w-24">
              <label className="text-xs text-muted-foreground mb-1 block">뒤 2자리</label>
              <select
                value={accountProduct}
                onChange={(e) => setAccountProduct(e.target.value)}
                className="w-full"
              >
                <option value="01">01 (종합)</option>
                <option value="03">03 (선물)</option>
                <option value="22">22 (연금)</option>
              </select>
            </div>
          </div>

          {/* Current Status */}
          {settings && (
            <div className="bg-secondary rounded p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">현재 모드</span>
                <span className={settings.mode === "real" ? "text-bear" : "text-primary"}>
                  {settings.mode === "real" ? "실전투자" : "모의투자"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">연결 상태</span>
                <span className={settings.isActive ? "text-bull" : "text-muted-foreground"}>
                  {settings.isActive ? "● 연결됨" : "○ 미연결"}
                </span>
              </div>
              {settings.tokenExpiredAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">토큰 만료</span>
                  <span>{new Date(settings.tokenExpiredAt).toLocaleString("ko-KR")}</span>
                </div>
              )}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="flex-1 py-2 bg-primary text-primary-foreground rounded text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saveMutation.isPending ? "저장 중..." : "저장"}
            </button>
            {settings?.hasAppKey && (
              <button
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
                className="flex-1 py-2 bg-bull/20 text-bull border border-bull rounded text-xs font-medium hover:bg-bull/30 disabled:opacity-50 transition-colors"
              >
                {connectMutation.isPending ? "연결 중..." : <><Server size={12} className="inline mr-1" />토큰 갱신</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
