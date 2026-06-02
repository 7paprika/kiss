import type { KisOHLCV } from "./kisApi";
import { TRADING_STRATEGIES, getTradingStrategy, type Signal } from "./strategies/index";

export type StrategyAnnotationPatternKind = "zigzag" | "channel" | "level" | "triangle";

export interface StrategySignalAnnotation {
  strategyId: string;
  strategyName: string;
  date: string;
  signal: Exclude<Signal, "HOLD">;
  strength: number;
  price: number;
  reason: string;
}

export interface StrategyPatternPoint {
  date: string;
  value: number;
}

export interface StrategyPatternAnnotation {
  strategyId: string;
  strategyName: string;
  kind: StrategyAnnotationPatternKind;
  label: string;
  color: string;
  points: StrategyPatternPoint[];
}

export interface StrategyAnnotationsResult {
  signals: StrategySignalAnnotation[];
  patterns: StrategyPatternAnnotation[];
}

export interface GenerateStrategyAnnotationsOptions {
  strategyIds?: string[];
  maxSignalsPerStrategy?: number;
  minStrength?: number;
}

const STRATEGY_COLORS = ["#22c55e", "#ef4444", "#f59e0b", "#38bdf8", "#a855f7", "#14b8a6", "#f97316", "#e879f9"];

function colorForStrategy(strategyId: string): string {
  let hash = 0;
  for (const ch of strategyId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return STRATEGY_COLORS[hash % STRATEGY_COLORS.length];
}

function numeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function point(bar: KisOHLCV, value: number): StrategyPatternPoint {
  return { date: bar.date, value };
}

function makePattern(
  strategyId: string,
  strategyName: string,
  kind: StrategyAnnotationPatternKind,
  label: string,
  points: StrategyPatternPoint[],
): StrategyPatternAnnotation | undefined {
  if (points.length < 2 || points.some((p) => !Number.isFinite(p.value))) return undefined;
  return { strategyId, strategyName, kind, label, color: colorForStrategy(strategyId), points };
}

function buildPatternForSignal(
  strategyId: string,
  strategyName: string,
  ohlcv: KisOHLCV[],
  indicators: Record<string, number> | undefined,
): StrategyPatternAnnotation | undefined {
  const last = ohlcv[ohlcv.length - 1];
  if (!last || !indicators) return undefined;

  if (strategyId === "abc_trading" && ohlcv.length >= 4) {
    const aBar = ohlcv[ohlcv.length - 4];
    const bBar = ohlcv[ohlcv.length - 3];
    const cBar = ohlcv[ohlcv.length - 2];
    return makePattern(strategyId, strategyName, "zigzag", "ABC 패턴", [
      point(aBar, numeric(indicators.aPoint) ? indicators.aPoint : aBar.low),
      point(bBar, numeric(indicators.bPoint) ? indicators.bPoint : bBar.high),
      point(cBar, numeric(indicators.cPoint) ? indicators.cPoint : cBar.low),
      point(last, last.close),
    ]);
  }

  if (strategyId === "fractal_trading") {
    const points: StrategyPatternPoint[] = [];
    if (numeric(indicators.fractalHighIndex) && numeric(indicators.fractalHigh)) {
      const bar = ohlcv[Math.floor(indicators.fractalHighIndex)];
      if (bar) points.push(point(bar, indicators.fractalHigh));
    }
    if (numeric(indicators.fractalLowIndex) && numeric(indicators.fractalLow)) {
      const bar = ohlcv[Math.floor(indicators.fractalLowIndex)];
      if (bar) points.push(point(bar, indicators.fractalLow));
    }
    points.push(point(last, last.close));
    return makePattern(strategyId, strategyName, "level", "프랙탈 기준선", points.sort((a, b) => a.date.localeCompare(b.date)));
  }

  if (strategyId === "channel_trading" && numeric(indicators.upperChannel) && numeric(indicators.lowerChannel)) {
    const channelBars = Math.min(20, Math.max(2, ohlcv.length - 1));
    const start = ohlcv[Math.max(0, ohlcv.length - channelBars - 1)];
    const end = ohlcv[Math.max(0, ohlcv.length - 2)];
    if (!start || !end) return undefined;
    return makePattern(strategyId, strategyName, "channel", "채널 상단/하단", [
      point(start, indicators.upperChannel),
      point(end, indicators.upperChannel),
      point(start, indicators.lowerChannel),
      point(end, indicators.lowerChannel),
      point(last, last.close),
    ]);
  }

  if (strategyId === "triangle_reversion_trading" && numeric(indicators.upperAtBreakout) && numeric(indicators.lowerAtBreakout) && numeric(indicators.midpoint) && ohlcv.length >= 2) {
    const breakoutBar = ohlcv[ohlcv.length - 2];
    return makePattern(strategyId, strategyName, "triangle", "삼각수렴 회귀", [
      point(breakoutBar, indicators.upperAtBreakout),
      point(last, indicators.midpoint),
      point(breakoutBar, indicators.lowerAtBreakout),
      point(last, last.close),
    ]);
  }

  return undefined;
}

export function generateStrategyAnnotations(
  ohlcv: KisOHLCV[],
  options: GenerateStrategyAnnotationsOptions = {},
): StrategyAnnotationsResult {
  const minStrength = options.minStrength ?? 0.5;
  const maxSignalsPerStrategy = options.maxSignalsPerStrategy ?? 12;
  const strategies = (options.strategyIds?.length
    ? options.strategyIds.map((id) => getTradingStrategy(id)).filter(Boolean)
    : TRADING_STRATEGIES) as typeof TRADING_STRATEGIES;

  const signals: StrategySignalAnnotation[] = [];
  const patterns: StrategyPatternAnnotation[] = [];

  for (const strategy of strategies) {
    const strategySignals: StrategySignalAnnotation[] = [];
    const strategyPatterns: StrategyPatternAnnotation[] = [];
    for (let i = 1; i < ohlcv.length; i++) {
      const slice = ohlcv.slice(0, i + 1);
      const signal = strategy.evaluate(slice, strategy.meta.defaultParams);
      if (signal.signal === "HOLD" || signal.strength < minStrength) continue;
      const bar = ohlcv[i];
      strategySignals.push({
        strategyId: strategy.meta.id,
        strategyName: strategy.meta.name,
        date: bar.date,
        signal: signal.signal,
        strength: signal.strength,
        price: bar.close,
        reason: signal.reason,
      });
      const pattern = buildPatternForSignal(strategy.meta.id, strategy.meta.name, slice, signal.indicators);
      if (pattern) strategyPatterns.push(pattern);
    }

    signals.push(...strategySignals.slice(-maxSignalsPerStrategy));
    patterns.push(...strategyPatterns.slice(-maxSignalsPerStrategy));
  }

  return { signals, patterns };
}
