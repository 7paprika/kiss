import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Settings2, Zap, Target, Play, Square, Info, Link2, ShieldAlert, TrendingUp, TrendingDown, CreditCard } from "lucide-react";

export default function StrategyPanel() {
  const [expandedStrategy, setExpandedStrategy] = useState<string | null>(null);
  const [editingParams, setEditingParams] = useState<Record<string, Record<string, number | string | boolean>>>({});

  const utils = trpc.useUtils();
  const { data: allMeta = [] } = trpc.strategy.getAllMeta.useQuery();
  const { data: userConfigs = [] } = trpc.strategy.getUserConfigs.useQuery();
  const { data: autoConfig } = trpc.autoTrader.getConfig.useQuery();
  const { data: kisSettings } = trpc.kis.getSettings.useQuery();
  const { data: accounts = [] } = trpc.kis.listAccounts.useQuery();

  const initMutation = trpc.strategy.initDefaults.useMutation({
    onSuccess: () => utils.strategy.getUserConfigs.invalidate(),
  });
  const saveMutation = trpc.strategy.saveConfig.useMutation({
    onSuccess: () => { utils.strategy.getUserConfigs.invalidate(); toast.success("전략 설정 저장됨"); },
    onError: (e) => toast.error(e.message),
  });
  const saveAutoMutation = trpc.autoTrader.saveConfig.useMutation({
    onSuccess: () => { utils.autoTrader.getConfig.invalidate(); toast.success("자동매매 설정 저장됨"); },
    onError: (e) => toast.error(e.message),
  });
  const toggleRunMutation = trpc.autoTrader.toggleRunning.useMutation({
    onSuccess: () => utils.autoTrader.getConfig.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (userConfigs.length === 0) initMutation.mutate();
  }, [userConfigs.length]);

  const selectionMeta = allMeta.filter((m) => m.type === "selection");
  const tradingMeta = allMeta.filter((m) => m.type === "trading");

  const getConfig = (strategyId: string) => userConfigs.find((c) => c.strategyId === strategyId);

  const handleToggle = (strategyId: string, strategyType: "selection" | "trading", isEnabled: boolean) => {
    const config = getConfig(strategyId);
    const meta = allMeta.find((m) => m.id === strategyId);
    if (!meta) return;
    saveMutation.mutate({
      id: config?.id,
      strategyType,
      strategyId,
      strategyName: meta.name,
      isEnabled,
      params: (editingParams[strategyId] || config?.params || meta.defaultParams) as Record<string, number | string | boolean>,
    });
  };

  const handleSaveParams = (strategyId: string, strategyType: "selection" | "trading") => {
    const config = getConfig(strategyId);
    const meta = allMeta.find((m) => m.id === strategyId);
    if (!meta) return;
    saveMutation.mutate({
      id: config?.id,
      strategyType,
      strategyId,
      strategyName: meta.name,
      isEnabled: config?.isEnabled || false,
      params: editingParams[strategyId] as Record<string, number | string | boolean>,
    });
    setExpandedStrategy(null);
  };

  const getParamValue = (strategyId: string, key: string, defaultVal: number | string | boolean) => {
    if (editingParams[strategyId]?.[key] !== undefined) return editingParams[strategyId][key];
    const config = getConfig(strategyId);
    if (config?.params && (config.params as Record<string, unknown>)[key] !== undefined) {
      return (config.params as Record<string, unknown>)[key] as number | string | boolean;
    }
    return defaultVal;
  };

  const setParamValue = (strategyId: string, key: string, value: number | string | boolean) => {
    setEditingParams((prev) => ({
      ...prev,
      [strategyId]: { ...(prev[strategyId] || {}), [key]: value },
    }));
  };

  const enabledSelectionConfigs = userConfigs.filter((c) => c.strategyType === "selection" && c.isEnabled);
  const enabledTradingConfigs = userConfigs.filter((c) => c.strategyType === "trading" && c.isEnabled);

  const buildAutoConfigPayload = (overrides: Partial<{
    selectionStrategyId: number | null;
    tradingStrategyId: number | null;
    maxPositions: number;
    maxOrderAmount: number;
    entryCashPct: number;
    riskPerTradePct: number;
    maxPortfolioExposurePct: number;
    stopLossPct: number;
    takeProfitPct: number;
    trailingStopPct: number;
    partialTakeProfitPct: number;
    partialTakeProfitSellPct: number;
    breakEvenTriggerPct: number;
    breakEvenBufferPct: number;
    accountProfileId: number | null;
  }> = {}) => ({
    selectionStrategyId: autoConfig?.selectionStrategyId ?? null,
    tradingStrategyId: autoConfig?.tradingStrategyId ?? null,
    maxPositions: autoConfig?.maxPositions || 5,
    maxOrderAmount: Number(autoConfig?.maxOrderAmount) || 1_000_000,
    entryCashPct: Number(autoConfig?.entryCashPct) || 10,
    riskPerTradePct: Number(autoConfig?.riskPerTradePct) || 1,
    maxPortfolioExposurePct: Number(autoConfig?.maxPortfolioExposurePct) || 50,
    stopLossPct: Number(autoConfig?.stopLossPct) || 3,
    takeProfitPct: Number(autoConfig?.takeProfitPct) || 5,
    trailingStopPct: Number(autoConfig?.trailingStopPct) || 0,
    partialTakeProfitPct: Number(autoConfig?.partialTakeProfitPct) || 0,
    partialTakeProfitSellPct: Number(autoConfig?.partialTakeProfitSellPct) || 50,
    breakEvenTriggerPct: Number(autoConfig?.breakEvenTriggerPct) || 0,
    breakEvenBufferPct: Number(autoConfig?.breakEvenBufferPct) || 0,
    accountProfileId: autoConfig?.accountProfileId ?? null,
    ...overrides,
  });

  const saveAutoConfig = (overrides: Parameters<typeof buildAutoConfigPayload>[0]) => {
    saveAutoMutation.mutate(buildAutoConfigPayload(overrides));
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Auto Trading Control */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Zap size={12} className={autoConfig?.isRunning ? "text-bull animate-pulse-green" : "text-muted-foreground"} />
            <span className="text-xs font-semibold">자동매매</span>
            {autoConfig?.isRunning && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bull/20 text-bull">실행 중</span>
            )}
          </div>
          <button
            onClick={() => toggleRunMutation.mutate({ isRunning: !autoConfig?.isRunning })}
            disabled={toggleRunMutation.isPending || !kisSettings?.isActive}
            className={`flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40 ${
              autoConfig?.isRunning
                ? "bg-bear/20 text-bear border border-bear hover:bg-bear/30"
                : "bg-bull/20 text-bull border border-bull hover:bg-bull/30"
            }`}
          >
            {autoConfig?.isRunning ? <><Square size={10} />중지</> : <><Play size={10} />시작</>}
          </button>
        </div>
        {!kisSettings?.isActive && (
          <p className="text-[10px] text-bear">⚠️ KIS API 연결 후 자동매매 사용 가능</p>
        )}

        {/* Account Assignment */}
        {accounts.length > 1 && (
          <div className="mt-2">
            <div className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1 mb-1">
              <CreditCard size={10} />
              자동매매 계좌 배정
            </div>
            <select
              value={autoConfig?.accountProfileId || ""}
              onChange={(e) => saveAutoConfig({
                accountProfileId: e.target.value ? parseInt(e.target.value) : null,
              })}
              className="w-full text-xs bg-secondary border border-border rounded px-2 py-1 text-foreground"
            >
              <option value="">-- 활성 계좌 사용 (기본값) --</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.profileName} ({acc.accountNo}-{acc.accountProduct}) [{acc.mode === 'paper' ? '모의' : '실전'}]
                </option>
              ))}
            </select>
            {autoConfig?.accountProfileId && (
              <p className="text-[9px] text-primary mt-0.5">
                ✓ 지정 계좌로 자동매매 실행됩니다
              </p>
            )}
          </div>
        )}

        {/* Strategy Combination Selector */}
        <div className="mt-2 space-y-1.5">
          <div className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1">
            <Link2 size={10} />
            전략 조합 설정
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">종목 선정 전략</label>
            <select
              value={autoConfig?.selectionStrategyId || ""}
              onChange={(e) => saveAutoConfig({
                selectionStrategyId: e.target.value ? parseInt(e.target.value) : null,
              })}
              className="w-full text-xs mt-0.5 bg-secondary border border-border rounded px-2 py-1 text-foreground"
            >
              <option value="">-- 선택 안함 (전체 관심종목) --</option>
              {selectionMeta.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">매매 실행 전략</label>
            <select
              value={autoConfig?.tradingStrategyId || ""}
              onChange={(e) => saveAutoConfig({
                tradingStrategyId: e.target.value ? parseInt(e.target.value) : null,
              })}
              className="w-full text-xs mt-0.5 bg-secondary border border-border rounded px-2 py-1 text-foreground"
            >
              <option value="">-- 선택 안함 --</option>
              {tradingMeta.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Auto Trader Config */}
        <div className="space-y-2 mt-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">최대 포지션</label>
              <input
                type="number"
                defaultValue={autoConfig?.maxPositions || 5}
                min={1} max={20}
                onBlur={(e) => saveAutoConfig({
                  maxPositions: parseInt(e.target.value) || 5,
                })}
                className="w-full text-xs mt-0.5"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">최대 주문금액</label>
              <input
                type="number"
                defaultValue={Number(autoConfig?.maxOrderAmount) || 1_000_000}
                step={100000}
                onBlur={(e) => saveAutoConfig({
                  maxOrderAmount: parseInt(e.target.value) || 1_000_000,
                })}
                className="w-full text-xs mt-0.5"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">손절 (%)</label>
              <input
                type="number"
                defaultValue={Number(autoConfig?.stopLossPct) || 3}
                min={0} max={50} step={0.5}
                onBlur={(e) => saveAutoConfig({
                  stopLossPct: Math.max(0, parseFloat(e.target.value) || 0),
                })}
                className="w-full text-xs mt-0.5"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">익절 (%)</label>
              <input
                type="number"
                defaultValue={Number(autoConfig?.takeProfitPct) || 5}
                min={0} max={100} step={0.5}
                onBlur={(e) => saveAutoConfig({
                  takeProfitPct: Math.max(0, parseFloat(e.target.value) || 0),
                })}
                className="w-full text-xs mt-0.5"
              />
            </div>
          </div>

          <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-300">
                <TrendingDown size={11} />
                트레일링·부분청산
              </div>
              <span className="text-[9px] text-muted-foreground">Exit guard</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="text-[9px] text-muted-foreground">트레일링</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.trailingStopPct) || 0}
                  min={0} max={50} step={0.5}
                  onBlur={(e) => saveAutoConfig({
                    trailingStopPct: Math.max(0, parseFloat(e.target.value) || 0),
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">부분익절</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.partialTakeProfitPct) || 0}
                  min={0} max={100} step={0.5}
                  onBlur={(e) => saveAutoConfig({
                    partialTakeProfitPct: Math.max(0, parseFloat(e.target.value) || 0),
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">매도비중</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.partialTakeProfitSellPct) || 50}
                  min={1} max={100} step={5}
                  onBlur={(e) => saveAutoConfig({
                    partialTakeProfitSellPct: Math.min(100, Math.max(1, parseFloat(e.target.value) || 50)),
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">본전발동</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.breakEvenTriggerPct) || 0}
                  min={0} max={100} step={0.5}
                  onBlur={(e) => saveAutoConfig({
                    breakEvenTriggerPct: Math.max(0, parseFloat(e.target.value) || 0),
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">본전버퍼</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.breakEvenBufferPct) || 0}
                  min={0} max={20} step={0.25}
                  onBlur={(e) => saveAutoConfig({
                    breakEvenBufferPct: Math.max(0, parseFloat(e.target.value) || 0),
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
            </div>
            <p className="text-[9px] leading-relaxed text-muted-foreground">
              트레일링은 보유 중 최고가 대비 하락률로 전량 청산합니다. 부분익절은 종목별 1회만 설정 비중만큼 매도하고, 본전 스탑은 지정 수익률 도달 후 평단가+버퍼까지 되밀리면 방어 청산합니다.
            </p>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-primary">
                <ShieldAlert size={11} />
                자금관리 가드레일
              </div>
              <span className="text-[9px] text-muted-foreground">Fixed fractional</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="text-[9px] text-muted-foreground">진입 비중</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.entryCashPct) || 10}
                  min={1} max={100} step={1}
                  onBlur={(e) => saveAutoConfig({
                    entryCashPct: parseFloat(e.target.value) || 10,
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">거래당 위험</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.riskPerTradePct) || 1}
                  min={0} max={10} step={0.25}
                  onBlur={(e) => saveAutoConfig({
                    riskPerTradePct: parseFloat(e.target.value) || 1,
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">총 노출 한도</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.maxPortfolioExposurePct) || 50}
                  min={1} max={100} step={1}
                  onBlur={(e) => saveAutoConfig({
                    maxPortfolioExposurePct: parseFloat(e.target.value) || 50,
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
            </div>
            <p className="text-[9px] leading-relaxed text-muted-foreground">
              신규 진입금액은 주문금액, 평가금 대비 진입 비중, 손절폭 기준 거래당 위험, 총 노출 한도 중 가장 작은 값으로 제한합니다. 시장가 체결·갭 하락 손실을 보장하지는 않습니다.
            </p>
          </div>
        </div>

        {/* Stop-loss / Take-profit Status */}
        {(Number(autoConfig?.stopLossPct) > 0 || Number(autoConfig?.takeProfitPct) > 0 || Number(autoConfig?.trailingStopPct) > 0 || Number(autoConfig?.partialTakeProfitPct) > 0 || Number(autoConfig?.breakEvenTriggerPct) > 0) && (
          <div className="mt-2 p-2 rounded bg-secondary/40 border border-border/50">
            <div className="flex items-center gap-1.5 mb-1.5">
              <ShieldAlert size={11} className="text-yellow-400" />
              <span className="text-[10px] font-semibold text-yellow-400">자동 청산 활성</span>
            </div>
            <div className="flex flex-wrap gap-3 text-[10px]">
              {Number(autoConfig?.stopLossPct) > 0 && (
                <div className="flex items-center gap-1">
                  <TrendingDown size={10} className="text-bear" />
                  <span className="text-muted-foreground">손절:</span>
                  <span className="text-bear font-mono font-bold">-{autoConfig?.stopLossPct}%</span>
                </div>
              )}
              {Number(autoConfig?.takeProfitPct) > 0 && (
                <div className="flex items-center gap-1">
                  <TrendingUp size={10} className="text-bull" />
                  <span className="text-muted-foreground">익절:</span>
                  <span className="text-bull font-mono font-bold">+{autoConfig?.takeProfitPct}%</span>
                </div>
              )}
              {Number(autoConfig?.trailingStopPct) > 0 && (
                <div className="flex items-center gap-1">
                  <TrendingDown size={10} className="text-amber-300" />
                  <span className="text-muted-foreground">트레일링:</span>
                  <span className="text-amber-300 font-mono font-bold">-{autoConfig?.trailingStopPct}%</span>
                </div>
              )}
              {Number(autoConfig?.partialTakeProfitPct) > 0 && (
                <div className="flex items-center gap-1">
                  <TrendingUp size={10} className="text-bull" />
                  <span className="text-muted-foreground">부분익절:</span>
                  <span className="text-bull font-mono font-bold">+{autoConfig?.partialTakeProfitPct}%/{autoConfig?.partialTakeProfitSellPct}%</span>
                </div>
              )}
              {Number(autoConfig?.breakEvenTriggerPct) > 0 && (
                <div className="flex items-center gap-1">
                  <ShieldAlert size={10} className="text-primary" />
                  <span className="text-muted-foreground">본전스탑:</span>
                  <span className="text-primary font-mono font-bold">+{autoConfig?.breakEvenTriggerPct}% 후 +{autoConfig?.breakEvenBufferPct}%</span>
                </div>
              )}
            </div>
            <p className="text-[9px] text-muted-foreground mt-1">
              자동매매 사이클마다 보유 종목 전체를 스캔하여 손절·익절·트레일링·부분익절·본전 스탑 조건을 시장가 청산으로 실행합니다.
            </p>
          </div>
        )}
      </div>

      {/* Strategy Sections */}
      {[
        { title: "종목 선정 전략", icon: Target, type: "selection" as const, metas: selectionMeta },
        { title: "매매 실행 전략", icon: Zap, type: "trading" as const, metas: tradingMeta },
      ].map(({ title, icon: Icon, type, metas }) => (
        <div key={type} className="border-b border-border">
          <div className="panel-header">
            <div className="flex items-center gap-1.5">
              <Icon size={12} />
              <span>{title}</span>
            </div>
          </div>
          <div className="divide-y divide-border/50">
            {metas.map((meta) => {
              const config = getConfig(meta.id);
              const isEnabled = config?.isEnabled || false;
              const isExpanded = expandedStrategy === meta.id;

              return (
                <div key={meta.id}>
                  <div className="flex items-center px-3 py-2 gap-2">
                    <button
                      onClick={() => setExpandedStrategy(isExpanded ? null : meta.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{meta.name}</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) => handleToggle(meta.id, type, e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-muted-foreground after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary/30 peer-checked:after:bg-primary"></div>
                    </label>
                  </div>

                  {/* Expanded params */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 bg-secondary/30">
                      {/* Description */}
                      <div className="flex gap-1 text-[10px] text-muted-foreground">
                        <Info size={10} className="mt-0.5 shrink-0" />
                        <span>{meta.description}</span>
                      </div>
                      {meta.reference && (
                        <div className="text-[10px] text-primary/70 italic">{meta.reference}</div>
                      )}

                      {/* Parameters */}
                      {meta.paramSchema.map((param) => (
                        <div key={param.key}>
                          <div className="flex justify-between mb-0.5">
                            <label className="text-[10px] text-muted-foreground">{param.label}</label>
                            <span className="text-[10px] font-mono text-foreground">
                              {getParamValue(meta.id, param.key, meta.defaultParams[param.key])}
                            </span>
                          </div>
                          {param.type === "number" ? (
                            <input
                              type="range"
                              min={param.min}
                              max={param.max}
                              step={param.step}
                              value={Number(getParamValue(meta.id, param.key, meta.defaultParams[param.key]))}
                              onChange={(e) => setParamValue(meta.id, param.key, parseFloat(e.target.value))}
                              className="w-full h-1 accent-primary"
                            />
                          ) : (
                            <input
                              type="checkbox"
                              checked={Boolean(getParamValue(meta.id, param.key, meta.defaultParams[param.key]))}
                              onChange={(e) => setParamValue(meta.id, param.key, e.target.checked)}
                            />
                          )}
                        </div>
                      ))}

                      <button
                        onClick={() => handleSaveParams(meta.id, type)}
                        className="w-full py-1 bg-primary/20 text-primary text-[10px] rounded hover:bg-primary/30 transition-colors"
                      >
                        파라미터 저장
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Active Strategy Summary */}
      {(enabledSelectionConfigs.length > 0 || enabledTradingConfigs.length > 0) && (
        <div className="p-3 space-y-2">
          <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">활성 전략</div>
          {enabledSelectionConfigs.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 text-[10px]">
              <Target size={10} className="text-primary" />
              <span className="text-foreground">{c.strategyName}</span>
            </div>
          ))}
          {enabledTradingConfigs.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 text-[10px]">
              <Zap size={10} className="text-bull" />
              <span className="text-foreground">{c.strategyName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
