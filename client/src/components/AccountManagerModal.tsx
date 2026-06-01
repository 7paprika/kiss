/**
 * AccountManagerModal - 다중 계좌 관리 모달
 * 계좌 프로필 추가/수정/삭제/전환 기능
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { X, Plus, Trash2, Edit2, Check, RefreshCw, ChevronDown, ChevronUp, CreditCard, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  onClose: () => void;
}

type AccountForm = {
  profileName: string;
  appKey: string;
  appSecret: string;
  accountNo: string;
  accountProduct: string;
  mode: "real" | "paper";
};

const defaultForm: AccountForm = {
  profileName: "",
  appKey: "",
  appSecret: "",
  accountNo: "",
  accountProduct: "01",
  mode: "paper",
};

export default function AccountManagerModal({ onClose }: Props) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<AccountForm>(defaultForm);
  const [editForm, setEditForm] = useState<Partial<AccountForm> & { id?: number }>({});

  const utils = trpc.useUtils();

  const { data: accounts, isLoading } = trpc.kis.listAccounts.useQuery();

  const addMutation = trpc.kis.addAccount.useMutation({
    onSuccess: () => {
      toast.success("계좌가 추가되었습니다");
      utils.kis.listAccounts.invalidate();
      utils.kis.getSettings.invalidate();
      setShowAddForm(false);
      setForm(defaultForm);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.kis.updateAccount.useMutation({
    onSuccess: () => {
      toast.success("계좌 정보가 수정되었습니다");
      utils.kis.listAccounts.invalidate();
      utils.kis.getSettings.invalidate();
      setEditingId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.kis.deleteAccount.useMutation({
    onSuccess: () => {
      toast.success("계좌가 삭제되었습니다");
      utils.kis.listAccounts.invalidate();
      utils.kis.getSettings.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const switchMutation = trpc.kis.switchAccount.useMutation({
    onSuccess: () => {
      toast.success("계좌가 전환되었습니다. 재연결이 필요합니다.");
      utils.kis.listAccounts.invalidate();
      utils.kis.getSettings.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const connectMutation = trpc.kis.connect.useMutation({
    onSuccess: () => {
      toast.success("KIS API 연결 완료");
      utils.kis.getSettings.invalidate();
      utils.kis.listAccounts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleAdd = () => {
    if (!form.profileName) { toast.error("계좌 이름을 입력하세요"); return; }
    if (!form.appKey || !form.appSecret) { toast.error("App Key/Secret을 입력하세요"); return; }
    if (!form.accountNo) { toast.error("계좌번호를 입력하세요"); return; }
    addMutation.mutate(form);
  };

  const handleUpdate = () => {
    if (!editingId) return;
    updateMutation.mutate({ id: editingId, ...editForm });
  };

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`"${name}" 계좌를 삭제하시겠습니까?`)) return;
    deleteMutation.mutate({ id });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">계좌 관리</h2>
            <span className="text-xs text-muted-foreground">({accounts?.length ?? 0}개)</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* 계좌 목록 */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">로딩 중...</span>
            </div>
          ) : accounts?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              등록된 계좌가 없습니다. 계좌를 추가하세요.
            </div>
          ) : (
            <div className="space-y-2">
              {accounts?.map(acc => (
                <div
                  key={acc.id}
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    acc.isActive ? "border-primary/50 bg-primary/5" : "border-border bg-secondary/30"
                  )}
                >
                  {editingId === acc.id ? (
                    /* 수정 폼 */
                    <div className="space-y-2">
                      <input
                        className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
                        placeholder="계좌 이름"
                        value={editForm.profileName ?? acc.profileName ?? ""}
                        onChange={e => setEditForm(f => ({ ...f, profileName: e.target.value }))}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="bg-background border border-border rounded px-2 py-1 text-xs"
                          placeholder="App Key (변경 시 입력)"
                          value={editForm.appKey ?? ""}
                          onChange={e => setEditForm(f => ({ ...f, appKey: e.target.value }))}
                        />
                        <input
                          className="bg-background border border-border rounded px-2 py-1 text-xs"
                          placeholder="App Secret (변경 시 입력)"
                          type="password"
                          value={editForm.appSecret ?? ""}
                          onChange={e => setEditForm(f => ({ ...f, appSecret: e.target.value }))}
                        />
                        <input
                          className="bg-background border border-border rounded px-2 py-1 text-xs"
                          placeholder="계좌번호"
                          value={editForm.accountNo ?? acc.accountNo ?? ""}
                          onChange={e => setEditForm(f => ({ ...f, accountNo: e.target.value }))}
                        />
                        <select
                          className="bg-background border border-border rounded px-2 py-1 text-xs"
                          value={editForm.mode ?? acc.mode}
                          onChange={e => setEditForm(f => ({ ...f, mode: e.target.value as "real" | "paper" }))}
                        >
                          <option value="paper">모의투자</option>
                          <option value="real">실전투자</option>
                        </select>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingId(null)}>취소</Button>
                        <Button size="sm" className="h-7 text-xs" onClick={handleUpdate} disabled={updateMutation.isPending}>
                          {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
                          저장
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* 계좌 정보 표시 */
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm truncate">{acc.profileName ?? "계좌"}</span>
                          {acc.isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-medium">활성</span>
                          )}
                          {acc.isDefault && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">기본</span>
                          )}
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                            acc.mode === "real" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                          )}>
                            {acc.mode === "real" ? "실전" : "모의"}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {acc.accountNo ? `${acc.accountNo}-${acc.accountProduct}` : "계좌번호 미설정"}
                        </div>
                        {acc.isActive && acc.tokenExpiredAt && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            토큰 만료: {new Date(acc.tokenExpiredAt).toLocaleString("ko-KR")}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!acc.isActive && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs px-2"
                            onClick={() => switchMutation.mutate({ id: acc.id })}
                            disabled={switchMutation.isPending}
                            title="이 계좌로 전환"
                          >
                            전환
                          </Button>
                        )}
                        {acc.isActive && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs px-2 border-primary/50 text-primary"
                            onClick={() => connectMutation.mutate({ id: acc.id })}
                            disabled={connectMutation.isPending}
                            title="재연결"
                          >
                            {connectMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                            연결
                          </Button>
                        )}
                        <button
                          onClick={() => { setEditingId(acc.id); setEditForm({}); }}
                          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          title="수정"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(acc.id, acc.profileName ?? "계좌")}
                          className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                          title="삭제"
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 계좌 추가 폼 */}
          {showAddForm && (
            <div className="border border-primary/30 rounded-lg p-4 bg-primary/5 space-y-3">
              <h4 className="text-xs font-semibold text-foreground">새 계좌 추가</h4>
              <div className="space-y-2">
                <input
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs"
                  placeholder="계좌 이름 (예: 모의투자 계좌)"
                  value={form.profileName}
                  onChange={e => setForm(f => ({ ...f, profileName: e.target.value }))}
                />
                <input
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs font-mono"
                  placeholder="App Key"
                  value={form.appKey}
                  onChange={e => setForm(f => ({ ...f, appKey: e.target.value }))}
                />
                <input
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs font-mono"
                  placeholder="App Secret"
                  type="password"
                  value={form.appSecret}
                  onChange={e => setForm(f => ({ ...f, appSecret: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="bg-background border border-border rounded px-3 py-1.5 text-xs font-mono"
                    placeholder="계좌번호 (8자리)"
                    value={form.accountNo}
                    onChange={e => setForm(f => ({ ...f, accountNo: e.target.value }))}
                  />
                  <input
                    className="bg-background border border-border rounded px-3 py-1.5 text-xs font-mono"
                    placeholder="상품코드 (기본: 01)"
                    value={form.accountProduct}
                    onChange={e => setForm(f => ({ ...f, accountProduct: e.target.value }))}
                  />
                </div>
                <select
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs"
                  value={form.mode}
                  onChange={e => setForm(f => ({ ...f, mode: e.target.value as "real" | "paper" }))}
                >
                  <option value="paper">모의투자</option>
                  <option value="real">실전투자 ⚠️</option>
                </select>
                {form.mode === "real" && (
                  <p className="text-[10px] text-red-400">⚠️ 실전투자 계좌는 실제 자금이 사용됩니다. 신중하게 설정하세요.</p>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setShowAddForm(false); setForm(defaultForm); }}>
                  취소
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={handleAdd} disabled={addMutation.isPending}>
                  {addMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                  추가
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => { setShowAddForm(!showAddForm); setForm(defaultForm); }}
          >
            {showAddForm ? <ChevronUp className="w-3 h-3 mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
            {showAddForm ? "닫기" : "계좌 추가"}
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
}
