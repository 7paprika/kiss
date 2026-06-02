/**
 * Trading Strategy Plugin System
 * 
 * Two independent strategy types:
 * 1. SelectionStrategy - Determines which stocks to trade (종목 선정)
 * 2. TradingStrategy   - Determines when to buy/sell (매수/매도 신호)
 * 
 * Each strategy is a self-contained plugin that can be enabled/disabled
 * and configured with custom parameters.
 */

import type { KisOHLCV } from "../kisApi";

// ─── Core Interfaces ──────────────────────────────────────────────────────────

export type Signal = "BUY" | "SELL" | "HOLD";

export interface StrategyMeta {
  id: string;
  name: string;
  description: string;
  type: "selection" | "trading";
  defaultParams: Record<string, number | string | boolean>;
  paramSchema: Array<{
    key: string;
    label: string;
    type: "number" | "boolean";
    min?: number;
    max?: number;
    step?: number;
  }>;
  reference?: string; // Academic paper reference
}

export interface SelectionResult {
  stockCode: string;
  score: number;   // Higher = stronger signal
  reason: string;
}

export interface TradingSignal {
  signal: Signal;
  strength: number;  // 0-1
  reason: string;
  indicators?: Record<string, number>;
}

export interface ISelectionStrategy {
  meta: StrategyMeta;
  select(
    candidates: Array<{ code: string; ohlcv: KisOHLCV[] }>,
    params: Record<string, number | string | boolean>
  ): SelectionResult[];
}

export interface ITradingStrategy {
  meta: StrategyMeta;
  evaluate(
    ohlcv: KisOHLCV[],
    params: Record<string, number | string | boolean>
  ): TradingSignal;
}

// ─── Technical Indicator Helpers ─────────────────────────────────────────────

export function calcSMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    result.push(sum / period);
  }
  return result;
}

export function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) { result.push(data[0]); continue; }
    if (i < period - 1) { result.push(NaN); continue; }
    if (isNaN(result[i - 1])) {
      const sum = data.slice(0, period).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    } else {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
  }
  return result;
}

export function calcRSI(closes: number[], period = 14): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return result;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function calcBollingerBands(
  closes: number[],
  period = 20,
  stdDev = 2
): Array<{ upper: number; middle: number; lower: number }> {
  const sma = calcSMA(closes, period);
  return closes.map((_, i) => {
    if (isNaN(sma[i])) return { upper: NaN, middle: NaN, lower: NaN };
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    return { upper: mean + stdDev * sd, middle: mean, lower: mean - stdDev * sd };
  });
}

export function calcMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): Array<{ macd: number; signal: number; histogram: number }> {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = calcEMA(macdLine, signal);
  return closes.map((_, i) => ({
    macd: macdLine[i],
    signal: signalLine[i],
    histogram: macdLine[i] - signalLine[i],
  }));
}

// ─── Strategy 1: Short-term Momentum (Medhat & Schmeling 2018) ───────────────
// Selection: Rank stocks by 1-month return × volume turnover
// Trading: Buy when momentum score > threshold, sell when reversal detected

export const momentumSelectionStrategy: ISelectionStrategy = {
  meta: {
    id: "momentum_selection",
    name: "단기 모멘텀 종목 선정",
    description: "최근 N일 수익률과 거래회전율을 결합하여 모멘텀 강도가 높은 종목을 선정합니다.",
    type: "selection",
    defaultParams: { lookbackDays: 20, minScore: 0.5 },
    paramSchema: [
      { key: "lookbackDays", label: "모멘텀 기간(일)", type: "number", min: 5, max: 60, step: 1 },
      { key: "minScore", label: "최소 점수 임계값", type: "number", min: 0.1, max: 1.0, step: 0.05 },
    ],
    reference: "Medhat & Schmeling (2018) - Short-term Momentum, SSRN 3150525",
  },
  select(candidates, params) {
    const lookback = Number(params.lookbackDays) || 20;
    const minScore = Number(params.minScore) || 0.5;
    const results: SelectionResult[] = [];

    for (const { code, ohlcv } of candidates) {
      if (ohlcv.length < lookback + 1) continue;
      const recent = ohlcv.slice(-lookback - 1);
      const ret = (recent[recent.length - 1].close - recent[0].close) / recent[0].close;
      const avgVol = recent.reduce((s, d) => s + d.volume, 0) / recent.length;
      const lastVol = recent[recent.length - 1].volume;
      const turnover = avgVol > 0 ? lastVol / avgVol : 0;
      const score = (ret + 1) * 0.6 + Math.min(turnover, 3) / 3 * 0.4;

      if (score >= minScore) {
        results.push({ stockCode: code, score, reason: `수익률 ${(ret * 100).toFixed(2)}%, 거래회전율 ${turnover.toFixed(2)}` });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  },
};

export const momentumTradingStrategy: ITradingStrategy = {
  meta: {
    id: "momentum_trading",
    name: "단기 모멘텀 매매",
    description: "단기 모멘텀 지속성을 이용한 매수/매도 신호를 생성합니다.",
    type: "trading",
    defaultParams: { period: 20, entryThreshold: 0.03, exitThreshold: -0.01 },
    paramSchema: [
      { key: "period", label: "모멘텀 기간(일)", type: "number", min: 5, max: 60, step: 1 },
      { key: "entryThreshold", label: "진입 수익률 임계값", type: "number", min: 0.01, max: 0.1, step: 0.005 },
      { key: "exitThreshold", label: "청산 수익률 임계값", type: "number", min: -0.1, max: 0, step: 0.005 },
    ],
    reference: "Medhat & Schmeling (2018) - Short-term Momentum",
  },
  evaluate(ohlcv, params) {
    const period = Number(params.period) || 20;
    const entryThreshold = Number(params.entryThreshold) || 0.03;
    const exitThreshold = Number(params.exitThreshold) || -0.01;
    if (ohlcv.length < period + 1) return { signal: "HOLD", strength: 0, reason: "데이터 부족" };

    const recent = ohlcv.slice(-period - 1);
    const ret = (recent[recent.length - 1].close - recent[0].close) / recent[0].close;
    const sma5 = calcSMA(ohlcv.map(d => d.close), 5);
    const sma20 = calcSMA(ohlcv.map(d => d.close), 20);
    const last5 = sma5[sma5.length - 1];
    const last20 = sma20[sma20.length - 1];

    if (ret >= entryThreshold && last5 > last20) {
      return { signal: "BUY", strength: Math.min(ret / 0.1, 1), reason: `모멘텀 ${(ret * 100).toFixed(2)}%, 단기MA > 장기MA`, indicators: { momentum: ret, sma5: last5, sma20: last20 } };
    }
    if (ret <= exitThreshold || last5 < last20) {
      return { signal: "SELL", strength: Math.min(Math.abs(ret) / 0.05, 1), reason: `모멘텀 약화 ${(ret * 100).toFixed(2)}%`, indicators: { momentum: ret, sma5: last5, sma20: last20 } };
    }
    return { signal: "HOLD", strength: 0.5, reason: `모멘텀 중립 ${(ret * 100).toFixed(2)}%` };
  },
};

// ─── Strategy 2: Bollinger Band Mean Reversion ───────────────────────────────

export const bollingerSelectionStrategy: ISelectionStrategy = {
  meta: {
    id: "bollinger_selection",
    name: "볼린저밴드 이탈 종목 선정",
    description: "볼린저밴드 하단 이탈 후 반등 가능성이 높은 종목을 선정합니다.",
    type: "selection",
    defaultParams: { period: 20, stdDev: 2, touchThreshold: 0.01 },
    paramSchema: [
      { key: "period", label: "볼린저밴드 기간", type: "number", min: 10, max: 50, step: 1 },
      { key: "stdDev", label: "표준편차 배수", type: "number", min: 1.5, max: 3.0, step: 0.1 },
      { key: "touchThreshold", label: "밴드 접촉 임계값", type: "number", min: 0.001, max: 0.05, step: 0.001 },
    ],
    reference: "Bollinger (1992), Lento et al. (2007) - Bollinger Band Trading Rules",
  },
  select(candidates, params) {
    const period = Number(params.period) || 20;
    const stdDev = Number(params.stdDev) || 2;
    const threshold = Number(params.touchThreshold) || 0.01;
    const results: SelectionResult[] = [];

    for (const { code, ohlcv } of candidates) {
      if (ohlcv.length < period) continue;
      const closes = ohlcv.map(d => d.close);
      const bands = calcBollingerBands(closes, period, stdDev);
      const last = bands[bands.length - 1];
      const price = closes[closes.length - 1];
      if (isNaN(last.lower)) continue;

      const distToLower = (price - last.lower) / last.lower;
      if (distToLower >= 0 && distToLower <= threshold) {
        const bw = (last.upper - last.lower) / last.middle;
        results.push({ stockCode: code, score: 1 - distToLower, reason: `밴드하단 근접 ${(distToLower * 100).toFixed(2)}%, 밴드폭 ${(bw * 100).toFixed(1)}%` });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  },
};

export const bollingerTradingStrategy: ITradingStrategy = {
  meta: {
    id: "bollinger_trading",
    name: "볼린저밴드 평균회귀 매매",
    description: "볼린저밴드 하단 이탈 시 매수, 상단 도달 시 매도하는 평균회귀 전략입니다.",
    type: "trading",
    defaultParams: { period: 20, stdDev: 2 },
    paramSchema: [
      { key: "period", label: "볼린저밴드 기간", type: "number", min: 10, max: 50, step: 1 },
      { key: "stdDev", label: "표준편차 배수", type: "number", min: 1.5, max: 3.0, step: 0.1 },
    ],
    reference: "Bollinger (1992) - Bollinger on Bollinger Bands",
  },
  evaluate(ohlcv, params) {
    const period = Number(params.period) || 20;
    const stdDev = Number(params.stdDev) || 2;
    if (ohlcv.length < period) return { signal: "HOLD", strength: 0, reason: "데이터 부족" };

    const closes = ohlcv.map(d => d.close);
    const bands = calcBollingerBands(closes, period, stdDev);
    const last = bands[bands.length - 1];
    const prevBand = bands[bands.length - 2];
    const price = closes[closes.length - 1];
    const prevPrice = closes[closes.length - 2];

    if (isNaN(last.lower)) return { signal: "HOLD", strength: 0, reason: "지표 계산 중" };

    const pctB = (price - last.lower) / (last.upper - last.lower);
    const prevPctB = (prevPrice - prevBand.lower) / (prevBand.upper - prevBand.lower);
    const clampStrength = (value: number) => Math.max(0, Math.min(value, 1));

    // 하단 이탈 후 반등 진입
    if (prevPctB <= 0.05 && pctB > 0.05) {
      return { signal: "BUY", strength: clampStrength(1 - pctB), reason: `볼린저 하단 반등 (pctB: ${pctB.toFixed(2)})`, indicators: { pctB, upper: last.upper, middle: last.middle, lower: last.lower } };
    }
    // 상단 도달 청산
    if (pctB >= 0.95) {
      return { signal: "SELL", strength: clampStrength(pctB), reason: `볼린저 상단 도달 (pctB: ${pctB.toFixed(2)})`, indicators: { pctB, upper: last.upper, middle: last.middle, lower: last.lower } };
    }
    return { signal: "HOLD", strength: 0.5, reason: `볼린저 중립 (pctB: ${pctB.toFixed(2)})` };
  },
};

// ─── Strategy 3: RSI Overbought/Oversold ─────────────────────────────────────

export const rsiSelectionStrategy: ISelectionStrategy = {
  meta: {
    id: "rsi_selection",
    name: "RSI 과매도 종목 선정",
    description: "RSI가 과매도 구간에 진입한 종목을 반등 후보로 선정합니다.",
    type: "selection",
    defaultParams: { period: 14, oversoldLevel: 30, lookback: 5 },
    paramSchema: [
      { key: "period", label: "RSI 기간", type: "number", min: 7, max: 28, step: 1 },
      { key: "oversoldLevel", label: "과매도 기준", type: "number", min: 20, max: 40, step: 1 },
      { key: "lookback", label: "과매도 확인 기간(일)", type: "number", min: 1, max: 10, step: 1 },
    ],
    reference: "Wilder (1978) - RSI; Yadav et al. (2025) - RSI & Bollinger Bands Effectiveness",
  },
  select(candidates, params) {
    const period = Number(params.period) || 14;
    const oversold = Number(params.oversoldLevel) || 30;
    const lookback = Number(params.lookback) || 5;
    const results: SelectionResult[] = [];

    for (const { code, ohlcv } of candidates) {
      if (ohlcv.length < period + lookback) continue;
      const closes = ohlcv.map(d => d.close);
      const rsi = calcRSI(closes, period);
      const recentRsi = rsi.slice(-lookback);
      const minRsi = Math.min(...recentRsi.filter(v => !isNaN(v)));
      const lastRsi = rsi[rsi.length - 1];

      if (minRsi <= oversold && lastRsi > oversold) {
        results.push({ stockCode: code, score: (oversold - minRsi) / oversold, reason: `RSI 과매도 반등 (최저 ${minRsi.toFixed(1)}, 현재 ${lastRsi.toFixed(1)})` });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  },
};

export const rsiTradingStrategy: ITradingStrategy = {
  meta: {
    id: "rsi_trading",
    name: "RSI 역추세 매매",
    description: "RSI 과매도 구간에서 매수, 과매수 구간에서 매도하는 역추세 전략입니다.",
    type: "trading",
    defaultParams: { period: 14, oversoldLevel: 30, overboughtLevel: 70 },
    paramSchema: [
      { key: "period", label: "RSI 기간", type: "number", min: 7, max: 28, step: 1 },
      { key: "oversoldLevel", label: "과매도 기준", type: "number", min: 20, max: 40, step: 1 },
      { key: "overboughtLevel", label: "과매수 기준", type: "number", min: 60, max: 80, step: 1 },
    ],
    reference: "Wilder (1978) - New Concepts in Technical Trading Systems",
  },
  evaluate(ohlcv, params) {
    const period = Number(params.period) || 14;
    const oversold = Number(params.oversoldLevel) || 30;
    const overbought = Number(params.overboughtLevel) || 70;
    if (ohlcv.length < period + 2) return { signal: "HOLD", strength: 0, reason: "데이터 부족" };

    const closes = ohlcv.map(d => d.close);
    const rsi = calcRSI(closes, period);
    const lastRsi = rsi[rsi.length - 1];
    const prevRsi = rsi[rsi.length - 2];

    if (isNaN(lastRsi)) return { signal: "HOLD", strength: 0, reason: "RSI 계산 중" };

    if (prevRsi <= oversold && lastRsi > oversold) {
      return { signal: "BUY", strength: (oversold - prevRsi) / oversold, reason: `RSI 과매도 탈출 (${prevRsi.toFixed(1)} → ${lastRsi.toFixed(1)})`, indicators: { rsi: lastRsi } };
    }
    if (prevRsi >= overbought && lastRsi < overbought) {
      return { signal: "SELL", strength: (prevRsi - overbought) / (100 - overbought), reason: `RSI 과매수 탈출 (${prevRsi.toFixed(1)} → ${lastRsi.toFixed(1)})`, indicators: { rsi: lastRsi } };
    }
    if (lastRsi <= oversold) {
      return { signal: "BUY", strength: (oversold - lastRsi) / oversold * 0.7, reason: `RSI 과매도 구간 (${lastRsi.toFixed(1)})`, indicators: { rsi: lastRsi } };
    }
    return { signal: "HOLD", strength: 0.5, reason: `RSI 중립 (${lastRsi.toFixed(1)})` };
  },
};

// ─── Strategy 4: Golden Cross / Dead Cross ───────────────────────────────────

export const goldenCrossSelectionStrategy: ISelectionStrategy = {
  meta: {
    id: "golden_cross_selection",
    name: "골든크로스 종목 선정",
    description: "단기 이동평균이 장기 이동평균을 상향 돌파한 종목을 선정합니다.",
    type: "selection",
    defaultParams: { shortPeriod: 5, longPeriod: 20, crossDays: 3 },
    paramSchema: [
      { key: "shortPeriod", label: "단기 이동평균(일)", type: "number", min: 3, max: 20, step: 1 },
      { key: "longPeriod", label: "장기 이동평균(일)", type: "number", min: 10, max: 120, step: 1 },
      { key: "crossDays", label: "크로스 확인 기간(일)", type: "number", min: 1, max: 10, step: 1 },
    ],
    reference: "Brock et al. (1992) - Simple Technical Trading Rules and Stochastic Properties",
  },
  select(candidates, params) {
    const short = Number(params.shortPeriod) || 5;
    const long = Number(params.longPeriod) || 20;
    const crossDays = Number(params.crossDays) || 3;
    const results: SelectionResult[] = [];

    for (const { code, ohlcv } of candidates) {
      if (ohlcv.length < long + crossDays) continue;
      const closes = ohlcv.map(d => d.close);
      const smaShort = calcSMA(closes, short);
      const smaLong = calcSMA(closes, long);

      const recentShort = smaShort.slice(-crossDays - 1);
      const recentLong = smaLong.slice(-crossDays - 1);

      const wasBelowBefore = recentShort[0] < recentLong[0];
      const isAboveNow = recentShort[recentShort.length - 1] > recentLong[recentLong.length - 1];

      if (wasBelowBefore && isAboveNow) {
        const gap = (recentShort[recentShort.length - 1] - recentLong[recentLong.length - 1]) / recentLong[recentLong.length - 1];
        results.push({ stockCode: code, score: Math.min(gap * 100, 1), reason: `골든크로스 발생 (MA${short}: ${recentShort[recentShort.length - 1].toFixed(0)}, MA${long}: ${recentLong[recentLong.length - 1].toFixed(0)})` });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  },
};

export const goldenCrossTradingStrategy: ITradingStrategy = {
  meta: {
    id: "golden_cross_trading",
    name: "골든/데드크로스 추세추종 매매",
    description: "골든크로스 발생 시 매수, 데드크로스 발생 시 매도하는 추세추종 전략입니다.",
    type: "trading",
    defaultParams: { shortPeriod: 5, longPeriod: 20 },
    paramSchema: [
      { key: "shortPeriod", label: "단기 이동평균(일)", type: "number", min: 3, max: 20, step: 1 },
      { key: "longPeriod", label: "장기 이동평균(일)", type: "number", min: 10, max: 120, step: 1 },
    ],
    reference: "Brock et al. (1992) - Journal of Finance",
  },
  evaluate(ohlcv, params) {
    const short = Number(params.shortPeriod) || 5;
    const long = Number(params.longPeriod) || 20;
    if (ohlcv.length < long + 2) return { signal: "HOLD", strength: 0, reason: "데이터 부족" };

    const closes = ohlcv.map(d => d.close);
    const smaShort = calcSMA(closes, short);
    const smaLong = calcSMA(closes, long);

    const lastShort = smaShort[smaShort.length - 1];
    const lastLong = smaLong[smaLong.length - 1];
    const prevShort = smaShort[smaShort.length - 2];
    const prevLong = smaLong[smaLong.length - 2];

    if (isNaN(lastShort) || isNaN(lastLong)) return { signal: "HOLD", strength: 0, reason: "지표 계산 중" };

    const gap = (lastShort - lastLong) / lastLong;

    if (prevShort <= prevLong && lastShort > lastLong) {
      return { signal: "BUY", strength: Math.min(Math.abs(gap) * 50, 1), reason: `골든크로스 (MA${short}: ${lastShort.toFixed(0)}, MA${long}: ${lastLong.toFixed(0)})`, indicators: { smaShort: lastShort, smaLong: lastLong, gap } };
    }
    if (prevShort >= prevLong && lastShort < lastLong) {
      return { signal: "SELL", strength: Math.min(Math.abs(gap) * 50, 1), reason: `데드크로스 (MA${short}: ${lastShort.toFixed(0)}, MA${long}: ${lastLong.toFixed(0)})`, indicators: { smaShort: lastShort, smaLong: lastLong, gap } };
    }
    return { signal: "HOLD", strength: 0.5, reason: `추세 유지 (갭: ${(gap * 100).toFixed(2)}%)` };
  },
};

// ─── Strategy 5: 52-Week High Breakout ───────────────────────────────────────

export const weekHigh52SelectionStrategy: ISelectionStrategy = {
  meta: {
    id: "week52_high_selection",
    name: "52주 신고가 돌파 종목 선정",
    description: "52주 최고가를 갱신하거나 근접한 종목을 모멘텀 후보로 선정합니다.",
    type: "selection",
    defaultParams: { nearHighPct: 0.02, minVolMultiplier: 1.5 },
    paramSchema: [
      { key: "nearHighPct", label: "신고가 근접 임계값(%)", type: "number", min: 0, max: 0.05, step: 0.005 },
      { key: "minVolMultiplier", label: "최소 거래량 배율", type: "number", min: 1.0, max: 5.0, step: 0.1 },
    ],
    reference: "George & Hwang (2004) - 52-Week High and Momentum Investing, Journal of Finance",
  },
  select(candidates, params) {
    const nearHighPct = Number(params.nearHighPct) || 0.02;
    const minVolMultiplier = Number(params.minVolMultiplier) || 1.5;
    const results: SelectionResult[] = [];

    for (const { code, ohlcv } of candidates) {
      const data252 = ohlcv.slice(-252);
      if (data252.length < 20) continue;

      const high52w = Math.max(...data252.map(d => d.high));
      const lastClose = data252[data252.length - 1].close;
      const distToHigh = (high52w - lastClose) / high52w;

      const avgVol20 = data252.slice(-21, -1).reduce((s, d) => s + d.volume, 0) / 20;
      const lastVol = data252[data252.length - 1].volume;
      const volMultiplier = avgVol20 > 0 ? lastVol / avgVol20 : 0;

      if (distToHigh <= nearHighPct && volMultiplier >= minVolMultiplier) {
        results.push({
          stockCode: code,
          score: (1 - distToHigh) * 0.7 + Math.min(volMultiplier / 5, 1) * 0.3,
          reason: `52주 신고가 ${distToHigh <= 0 ? '갱신' : `근접 ${(distToHigh * 100).toFixed(1)}%`}, 거래량 ${volMultiplier.toFixed(1)}배`,
        });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  },
};

export const weekHigh52TradingStrategy: ITradingStrategy = {
  meta: {
    id: "week52_high_trading",
    name: "52주 신고가 돌파 매매",
    description: "52주 최고가 돌파 시 매수 진입, 이탈 시 매도하는 돌파매매 전략입니다.",
    type: "trading",
    defaultParams: { nearHighPct: 0.02, exitDropPct: 0.05 },
    paramSchema: [
      { key: "nearHighPct", label: "신고가 돌파 임계값", type: "number", min: 0, max: 0.05, step: 0.005 },
      { key: "exitDropPct", label: "청산 하락 임계값", type: "number", min: 0.02, max: 0.15, step: 0.01 },
    ],
    reference: "George & Hwang (2004) - Journal of Finance",
  },
  evaluate(ohlcv, params) {
    const nearHighPct = Number(params.nearHighPct) || 0.02;
    const exitDropPct = Number(params.exitDropPct) || 0.05;
    if (ohlcv.length < 20) return { signal: "HOLD", strength: 0, reason: "데이터 부족" };

    const data252 = ohlcv.slice(-252);
    const high52w = Math.max(...data252.slice(0, -1).map(d => d.high));
    const lastClose = data252[data252.length - 1].close;
    const prevClose = data252[data252.length - 2].close;

    const distToHigh = (high52w - lastClose) / high52w;
    const prevDistToHigh = (high52w - prevClose) / high52w;

    // 신고가 돌파 진입
    if (prevDistToHigh > nearHighPct && distToHigh <= 0) {
      return { signal: "BUY", strength: 0.9, reason: `52주 신고가 돌파 (고가: ${high52w.toLocaleString()}, 현재: ${lastClose.toLocaleString()})`, indicators: { high52w, currentPrice: lastClose } };
    }
    // 신고가 근접 진입
    if (distToHigh <= nearHighPct && distToHigh > 0) {
      return { signal: "BUY", strength: 0.7 * (1 - distToHigh / nearHighPct), reason: `52주 신고가 근접 ${(distToHigh * 100).toFixed(1)}%`, indicators: { high52w, currentPrice: lastClose } };
    }
    // 고가 대비 크게 하락 시 청산
    if (lastClose < high52w * (1 - exitDropPct)) {
      return { signal: "SELL", strength: 0.8, reason: `52주 고가 대비 ${(exitDropPct * 100).toFixed(0)}% 이상 하락`, indicators: { high52w, currentPrice: lastClose } };
    }
    return { signal: "HOLD", strength: 0.5, reason: `신고가 대비 ${(distToHigh * 100).toFixed(1)}%` };
  },
};

// ─── Strategy 6: MACD Crossover (Appel 1979, Brock et al. 1992) ─────────────
// Selection: Stocks where MACD line just crossed above signal line
// Trading: Buy on MACD golden cross, sell on death cross

export function calcStochasticHelper(
  highs: number[], lows: number[], closes: number[], k = 14, d = 3
): Array<{ k: number; d: number }> {
  const rawK: number[] = closes.map((_, i) => {
    if (i < k - 1) return NaN;
    const hh = Math.max(...highs.slice(i - k + 1, i + 1));
    const ll = Math.min(...lows.slice(i - k + 1, i + 1));
    return hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
  });
  const smoothK: number[] = rawK.map((_, i) => {
    if (i < k + 1) return NaN;
    const slice = rawK.slice(i - 2, i + 1).filter(v => !isNaN(v));
    return slice.length === 3 ? slice.reduce((a, b) => a + b, 0) / 3 : NaN;
  });
  const smoothD: number[] = smoothK.map((_, i) => {
    if (i < k + 3) return NaN;
    const slice = smoothK.slice(i - 2, i + 1).filter(v => !isNaN(v));
    return slice.length === 3 ? slice.reduce((a, b) => a + b, 0) / 3 : NaN;
  });
  return closes.map((_, i) => ({ k: smoothK[i] ?? NaN, d: smoothD[i] ?? NaN }));
}

export const macdSelectionStrategy: ISelectionStrategy = {
  meta: {
    id: "macd_selection",
    name: "MACD 골든크로스 종목 선정",
    description: "MACD 선이 시그널 선을 상향 돌파한 종목을 선정합니다. (Appel 1979)",
    type: "selection",
    defaultParams: { fast: 12, slow: 26, signal: 9, minHistogram: 0 },
    paramSchema: [
      { key: "fast", label: "단기 EMA 기간", type: "number", min: 5, max: 20, step: 1 },
      { key: "slow", label: "장기 EMA 기간", type: "number", min: 15, max: 50, step: 1 },
      { key: "signal", label: "시그널 기간", type: "number", min: 3, max: 15, step: 1 },
      { key: "minHistogram", label: "최소 히스토그램 값", type: "number", min: 0, max: 100, step: 1 },
    ],
    reference: "Appel (1979) - Technical Analysis Using MACD; Brock et al. (1992) - Journal of Finance",
  },
  select(candidates, params) {
    const fast = Number(params.fast) || 12;
    const slow = Number(params.slow) || 26;
    const signal = Number(params.signal) || 9;
    const minHist = Number(params.minHistogram) || 0;
    const results: SelectionResult[] = [];

    for (const { code, ohlcv } of candidates) {
      if (ohlcv.length < slow + signal + 5) continue;
      const closes = ohlcv.map(d => d.close);
      const macdData = calcMACD(closes, fast, slow, signal);
      const n = macdData.length;
      if (n < 2) continue;
      const curr = macdData[n - 1];
      const prev = macdData[n - 2];
      // MACD golden cross: MACD crossed above signal
      if (!isNaN(curr.macd) && !isNaN(curr.signal) && !isNaN(prev.macd) && !isNaN(prev.signal)) {
        const crossedUp = prev.macd <= prev.signal && curr.macd > curr.signal;
        const histogram = curr.macd - curr.signal;
        if (crossedUp && histogram >= minHist) {
          results.push({
            stockCode: code,
            score: Math.min(histogram / 100, 1),
            reason: `MACD 골든크로스 (MACD: ${curr.macd.toFixed(2)}, Signal: ${curr.signal.toFixed(2)})`,
          });
        }
      }
    }
    return results.sort((a, b) => b.score - a.score);
  },
};

export const macdTradingStrategy: ITradingStrategy = {
  meta: {
    id: "macd_trading",
    name: "MACD 크로스오버 매매",
    description: "MACD 골든크로스 매수, 데드크로스 매도 전략입니다.",
    type: "trading",
    defaultParams: { fast: 12, slow: 26, signal: 9 },
    paramSchema: [
      { key: "fast", label: "단기 EMA 기간", type: "number", min: 5, max: 20, step: 1 },
      { key: "slow", label: "장기 EMA 기간", type: "number", min: 15, max: 50, step: 1 },
      { key: "signal", label: "시그널 기간", type: "number", min: 3, max: 15, step: 1 },
    ],
    reference: "Appel (1979) - Technical Analysis Using MACD",
  },
  evaluate(ohlcv, params) {
    const fast = Number(params.fast) || 12;
    const slow = Number(params.slow) || 26;
    const signal = Number(params.signal) || 9;
    if (ohlcv.length < slow + signal + 5) return { signal: "HOLD", strength: 0, reason: "데이터 부족" };

    const closes = ohlcv.map(d => d.close);
    const macdData = calcMACD(closes, fast, slow, signal);
    const n = macdData.length;
    const curr = macdData[n - 1];
    const prev = macdData[n - 2];

    if (isNaN(curr.macd) || isNaN(curr.signal)) return { signal: "HOLD", strength: 0, reason: "MACD 계산 불가" };

    const histogram = curr.macd - curr.signal;
    const prevHistogram = prev.macd - prev.signal;

    // Golden cross (MACD crosses above signal)
    if (prevHistogram <= 0 && histogram > 0) {
      return { signal: "BUY", strength: Math.min(0.6 + Math.abs(histogram) / 50, 0.95), reason: `MACD 골든크로스 (히스토그램: ${histogram.toFixed(2)})`, indicators: { macd: curr.macd, signal: curr.signal, histogram } };
    }
    // Death cross (MACD crosses below signal)
    if (prevHistogram >= 0 && histogram < 0) {
      return { signal: "SELL", strength: Math.min(0.6 + Math.abs(histogram) / 50, 0.95), reason: `MACD 데드크로스 (히스토그램: ${histogram.toFixed(2)})`, indicators: { macd: curr.macd, signal: curr.signal, histogram } };
    }
    // Trend continuation
    if (histogram > 0 && curr.macd > 0) return { signal: "BUY", strength: 0.4, reason: `MACD 상승 추세 지속 (히스토그램: ${histogram.toFixed(2)})` };
    if (histogram < 0 && curr.macd < 0) return { signal: "SELL", strength: 0.4, reason: `MACD 하락 추세 지속 (히스토그램: ${histogram.toFixed(2)})` };
    return { signal: "HOLD", strength: 0.3, reason: `MACD 중립 (히스토그램: ${histogram.toFixed(2)})` };
  },
};

// ─── Strategy 7: Stochastic Oscillator (Lane 1950s, Jegadeesh 1990) ──────────
// Selection: Stocks in oversold zone with %K crossing above %D
// Trading: Buy on stochastic golden cross in oversold zone, sell in overbought

export const stochasticSelectionStrategy: ISelectionStrategy = {
  meta: {
    id: "stochastic_selection",
    name: "스토캐스틱 과매도 종목 선정",
    description: "스토캐스틱 %K가 과매도 구간에서 %D를 상향 돌파한 종목을 선정합니다.",
    type: "selection",
    defaultParams: { kPeriod: 14, dPeriod: 3, oversoldLevel: 25 },
    paramSchema: [
      { key: "kPeriod", label: "%K 기간", type: "number", min: 5, max: 30, step: 1 },
      { key: "dPeriod", label: "%D 기간", type: "number", min: 2, max: 10, step: 1 },
      { key: "oversoldLevel", label: "과매도 기준", type: "number", min: 10, max: 35, step: 5 },
    ],
    reference: "Lane (1950s) - Stochastic Oscillator; Jegadeesh (1990) - Journal of Finance",
  },
  select(candidates, params) {
    const kPeriod = Number(params.kPeriod) || 14;
    const dPeriod = Number(params.dPeriod) || 3;
    const oversold = Number(params.oversoldLevel) || 25;
    const results: SelectionResult[] = [];

    for (const { code, ohlcv } of candidates) {
      if (ohlcv.length < kPeriod + dPeriod + 5) continue;
      const highs = ohlcv.map(d => d.high);
      const lows = ohlcv.map(d => d.low);
      const closes = ohlcv.map(d => d.close);
      const stoch = calcStochasticHelper(highs, lows, closes, kPeriod, dPeriod);
      const n = stoch.length;
      const curr = stoch[n - 1];
      const prev = stoch[n - 2];
      if (isNaN(curr.k) || isNaN(curr.d) || isNaN(prev.k) || isNaN(prev.d)) continue;
      // Oversold golden cross
      if (curr.k < oversold && prev.k <= prev.d && curr.k > curr.d) {
        results.push({
          stockCode: code,
          score: (oversold - curr.k) / oversold,
          reason: `스토캐스틱 과매도 반전 (%K: ${curr.k.toFixed(1)}, %D: ${curr.d.toFixed(1)})`,
        });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  },
};

export const stochasticTradingStrategy: ITradingStrategy = {
  meta: {
    id: "stochastic_trading",
    name: "스토캐스틱 매매",
    description: "스토캐스틱 과매도 반전 매수, 과매수 반전 매도 전략입니다.",
    type: "trading",
    defaultParams: { kPeriod: 14, dPeriod: 3, oversoldLevel: 20, overboughtLevel: 80 },
    paramSchema: [
      { key: "kPeriod", label: "%K 기간", type: "number", min: 5, max: 30, step: 1 },
      { key: "dPeriod", label: "%D 기간", type: "number", min: 2, max: 10, step: 1 },
      { key: "oversoldLevel", label: "과매도 기준", type: "number", min: 10, max: 35, step: 5 },
      { key: "overboughtLevel", label: "과매수 기준", type: "number", min: 65, max: 90, step: 5 },
    ],
    reference: "Lane (1950s) - Stochastic Oscillator",
  },
  evaluate(ohlcv, params) {
    const kPeriod = Number(params.kPeriod) || 14;
    const dPeriod = Number(params.dPeriod) || 3;
    const oversold = Number(params.oversoldLevel) || 20;
    const overbought = Number(params.overboughtLevel) || 80;
    if (ohlcv.length < kPeriod + dPeriod + 5) return { signal: "HOLD", strength: 0, reason: "데이터 부족" };

    const highs = ohlcv.map(d => d.high);
    const lows = ohlcv.map(d => d.low);
    const closes = ohlcv.map(d => d.close);
    const stoch = calcStochasticHelper(highs, lows, closes, kPeriod, dPeriod);
    const n = stoch.length;
    const curr = stoch[n - 1];
    const prev = stoch[n - 2];

    if (isNaN(curr.k) || isNaN(curr.d)) return { signal: "HOLD", strength: 0, reason: "스토캐스틱 계산 불가" };

    // Oversold golden cross → BUY
    if (curr.k < oversold && prev.k <= prev.d && curr.k > curr.d) {
      const strength = Math.min(0.7 + (oversold - curr.k) / oversold * 0.3, 0.95);
      return { signal: "BUY", strength, reason: `스토캐스틱 과매도 반전 (%K: ${curr.k.toFixed(1)})`, indicators: { k: curr.k, d: curr.d } };
    }
    // Overbought death cross → SELL
    if (curr.k > overbought && prev.k >= prev.d && curr.k < curr.d) {
      const strength = Math.min(0.7 + (curr.k - overbought) / (100 - overbought) * 0.3, 0.95);
      return { signal: "SELL", strength, reason: `스토캐스틱 과매수 반전 (%K: ${curr.k.toFixed(1)})`, indicators: { k: curr.k, d: curr.d } };
    }
    // Zone signals
    if (curr.k < oversold) return { signal: "BUY", strength: 0.45, reason: `스토캐스틱 과매도 구간 (%K: ${curr.k.toFixed(1)})` };
    if (curr.k > overbought) return { signal: "SELL", strength: 0.45, reason: `스토캐스틱 과매수 구간 (%K: ${curr.k.toFixed(1)})` };
    return { signal: "HOLD", strength: 0.3, reason: `스토캐스틱 중립 (%K: ${curr.k.toFixed(1)})` };
  },
};


// ─── Strategy 8: ABC / Fractal / Channel Trading ─────────────────────────────
// Trading: price-action strategies commonly used for short-term Korean equity
// execution. SELL remains a long-only exit signal, not a short entry.

export const abcTradingStrategy: ITradingStrategy = {
  meta: {
    id: "abc_trading",
    name: "ABC 매매",
    description: "A 저점-B 반등-C 눌림 구조에서 C가 A보다 높은 저점을 만들고 B 고점을 돌파하면 매수하는 가격 행동 전략입니다.",
    type: "trading",
    defaultParams: { breakoutPct: 0.005, minPullbackPct: 0.03, stopBufferPct: 0.005 },
    paramSchema: [
      { key: "breakoutPct", label: "B 돌파 확인 비율", type: "number", min: 0.001, max: 0.05, step: 0.001 },
      { key: "minPullbackPct", label: "최소 눌림 비율", type: "number", min: 0.01, max: 0.2, step: 0.005 },
      { key: "stopBufferPct", label: "C 저점 손절 버퍼", type: "number", min: 0.001, max: 0.03, step: 0.001 },
    ],
    reference: "ABC price-action breakout continuation pattern",
  },
  evaluate(ohlcv, params) {
    const breakoutPct = Number(params.breakoutPct) || 0.005;
    const minPullbackPct = Number(params.minPullbackPct) || 0.03;
    const stopBufferPct = Number(params.stopBufferPct) || 0.005;
    if (ohlcv.length < 4) return { signal: "HOLD", strength: 0, reason: "데이터 부족" };

    const aBar = ohlcv[ohlcv.length - 4];
    const bBar = ohlcv[ohlcv.length - 3];
    const cBar = ohlcv[ohlcv.length - 2];
    const curr = ohlcv[ohlcv.length - 1];
    const aPoint = aBar.low;
    const bPoint = bBar.high;
    const cPoint = cBar.low;
    const pullbackPct = bPoint > 0 ? (bPoint - cPoint) / bPoint : 0;
    const higherLow = cPoint > aPoint;
    const validPullback = pullbackPct >= minPullbackPct;
    const brokeB = curr.close >= bPoint * (1 + breakoutPct);
    const failedC = curr.close <= cPoint * (1 - breakoutPct);

    if (higherLow && validPullback && brokeB) {
      const stopLoss = cPoint * (1 - stopBufferPct);
      const structureScore = Math.max(0, Math.min(1, (cPoint - aPoint) / Math.max(1, bPoint - aPoint)));
      const breakoutScore = Math.max(0, Math.min(1, (curr.close / bPoint - 1) / Math.max(breakoutPct, 0.001)));
      return {
        signal: "BUY",
        strength: Math.min(0.95, 0.58 + structureScore * 0.2 + breakoutScore * 0.17),
        reason: `ABC 상승 돌파 (B: ${bPoint.toFixed(0)}, C 손절 기준: ${stopLoss.toFixed(0)})`,
        indicators: { aPoint, bPoint, cPoint, pullbackPct, stopLoss } as Record<string, number>,
      };
    }

    if (higherLow && validPullback && failedC) {
      return {
        signal: "SELL",
        strength: 0.65,
        reason: `ABC 패턴 실패, C 저점 이탈 (C: ${cPoint.toFixed(0)})`,
        indicators: { aPoint, bPoint, cPoint, pullbackPct } as Record<string, number>,
      };
    }

    return {
      signal: "HOLD",
      strength: 0.25,
      reason: higherLow ? "ABC 구조 형성 중, B 돌파 대기" : "ABC 높은 저점 미확인",
      indicators: { aPoint, bPoint, cPoint, pullbackPct } as Record<string, number>,
    };
  },
};

function findLatestFractal(ohlcv: KisOHLCV[], kind: "high" | "low", leftRight: number, endExclusive: number): { index: number; value: number } | undefined {
  for (let i = endExclusive - leftRight - 1; i >= leftRight; i--) {
    const center = kind === "high" ? ohlcv[i].high : ohlcv[i].low;
    let ok = true;
    for (let j = i - leftRight; j <= i + leftRight; j++) {
      if (j === i) continue;
      const other = kind === "high" ? ohlcv[j].high : ohlcv[j].low;
      if (kind === "high" ? center <= other : center >= other) { ok = false; break; }
    }
    if (ok) return { index: i, value: center };
  }
  return undefined;
}

export const fractalTradingStrategy: ITradingStrategy = {
  meta: {
    id: "fractal_trading",
    name: "프랙탈 매매",
    description: "좌우 봉으로 확인된 프랙탈 고점/저점을 기준으로 돌파는 진입, 저점 이탈은 청산 신호로 쓰는 가격 행동 전략입니다.",
    type: "trading",
    defaultParams: { leftRightBars: 2, breakoutPct: 0.005, stopBufferPct: 0.005 },
    paramSchema: [
      { key: "leftRightBars", label: "프랙탈 좌우 봉 수", type: "number", min: 1, max: 5, step: 1 },
      { key: "breakoutPct", label: "돌파 확인 비율", type: "number", min: 0.001, max: 0.05, step: 0.001 },
      { key: "stopBufferPct", label: "저점 손절 버퍼", type: "number", min: 0.001, max: 0.03, step: 0.001 },
    ],
    reference: "Bill Williams-style fractal breakout rule",
  },
  evaluate(ohlcv, params) {
    const leftRightBars = Math.max(1, Math.floor(Number(params.leftRightBars) || 2));
    const breakoutPct = Number(params.breakoutPct) || 0.005;
    const stopBufferPct = Number(params.stopBufferPct) || 0.005;
    if (ohlcv.length < leftRightBars * 2 + 2) return { signal: "HOLD", strength: 0, reason: "데이터 부족" };

    const curr = ohlcv[ohlcv.length - 1];
    const fractalHigh = findLatestFractal(ohlcv, "high", leftRightBars, ohlcv.length - 1);
    const fractalLow = findLatestFractal(ohlcv, "low", leftRightBars, ohlcv.length - 1);
    const highValue = fractalHigh?.value ?? NaN;
    const lowValue = fractalLow?.value ?? NaN;

    if (fractalHigh && curr.close >= highValue * (1 + breakoutPct)) {
      const stopLoss = (fractalLow?.value ?? curr.low) * (1 - stopBufferPct);
      return {
        signal: "BUY",
        strength: Math.min(0.95, 0.62 + Math.min(0.33, (curr.close / highValue - 1) * 10)),
        reason: `상단 프랙탈 돌파 (프랙탈 고점: ${highValue.toFixed(0)}, 손절 기준: ${stopLoss.toFixed(0)})`,
        indicators: { fractalHigh: highValue, fractalLow: lowValue, stopLoss, fractalHighIndex: fractalHigh.index } as Record<string, number>,
      };
    }

    if (fractalLow && curr.close <= lowValue * (1 - breakoutPct)) {
      return {
        signal: "SELL",
        strength: 0.7,
        reason: `하단 프랙탈 이탈 (프랙탈 저점: ${lowValue.toFixed(0)})`,
        indicators: { fractalHigh: highValue, fractalLow: lowValue, fractalLowIndex: fractalLow.index } as Record<string, number>,
      };
    }

    return {
      signal: "HOLD",
      strength: 0.25,
      reason: "프랙탈 돌파 대기",
      indicators: { fractalHigh: highValue, fractalLow: lowValue } as Record<string, number>,
    };
  },
};

export const channelTradingStrategy: ITradingStrategy = {
  meta: {
    id: "channel_trading",
    name: "채널 매매",
    description: "이전 구간의 돈치안 채널 상단 돌파를 매수, 하단 이탈을 보유분 청산으로 보는 돌파형 채널 전략입니다.",
    type: "trading",
    defaultParams: { channelBars: 20, breakoutPct: 0.005, stopBufferPct: 0.005 },
    paramSchema: [
      { key: "channelBars", label: "채널 확인 봉 수", type: "number", min: 10, max: 60, step: 1 },
      { key: "breakoutPct", label: "돌파 확인 비율", type: "number", min: 0.001, max: 0.05, step: 0.001 },
      { key: "stopBufferPct", label: "채널 손절 버퍼", type: "number", min: 0.001, max: 0.03, step: 0.001 },
    ],
    reference: "Donchian channel breakout trading rule",
  },
  evaluate(ohlcv, params) {
    const channelBars = Number(params.channelBars) || 20;
    const breakoutPct = Number(params.breakoutPct) || 0.005;
    const stopBufferPct = Number(params.stopBufferPct) || 0.005;
    if (ohlcv.length < channelBars + 1) return { signal: "HOLD", strength: 0, reason: "데이터 부족" };

    const channel = ohlcv.slice(-(channelBars + 1), -1);
    const curr = ohlcv[ohlcv.length - 1];
    const upperChannel = Math.max(...channel.map(d => d.high));
    const lowerChannel = Math.min(...channel.map(d => d.low));
    const channelWidthPct = curr.close > 0 ? (upperChannel - lowerChannel) / curr.close : 0;
    const brokeUp = curr.close >= upperChannel * (1 + breakoutPct);
    const brokeDown = curr.close <= lowerChannel * (1 - breakoutPct);

    if (brokeUp) {
      const stopLoss = lowerChannel * (1 - stopBufferPct);
      return {
        signal: "BUY",
        strength: Math.min(0.95, 0.6 + Math.min(0.35, (curr.close / upperChannel - 1) * 8)),
        reason: `채널 상단 돌파 (상단: ${upperChannel.toFixed(0)}, 손절 기준: ${stopLoss.toFixed(0)})`,
        indicators: { upperChannel, lowerChannel, channelWidthPct, stopLoss } as Record<string, number>,
      };
    }

    if (brokeDown) {
      return {
        signal: "SELL",
        strength: 0.7,
        reason: `채널 하단 이탈 (하단: ${lowerChannel.toFixed(0)})`,
        indicators: { upperChannel, lowerChannel, channelWidthPct } as Record<string, number>,
      };
    }

    return {
      signal: "HOLD",
      strength: 0.25,
      reason: "채널 내부, 돌파 대기",
      indicators: { upperChannel, lowerChannel, channelWidthPct } as Record<string, number>,
    };
  },
};

// ─── Strategy 8: Triangle Convergence Midpoint Reversion (삼수 매매) ─────────────
// Trading: When a clear contracting triangle breaks out and then returns to the
// triangle midpoint, trade the counter-move with tight invalidation.

function calcLinearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  const sumX = values.reduce((sum, _v, i) => sum + i, 0);
  const sumY = values.reduce((sum, v) => sum + v, 0);
  const sumXY = values.reduce((sum, v, i) => sum + i * v, 0);
  const sumXX = values.reduce((sum, _v, i) => sum + i * i, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: values[0] ?? 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  return { slope, intercept: (sumY - slope * sumX) / n };
}

function projectLine(line: { slope: number; intercept: number }, index: number): number {
  return line.slope * index + line.intercept;
}

export const triangleReversionTradingStrategy: ITradingStrategy = {
  meta: {
    id: "triangle_reversion_trading",
    name: "삼각수렴 회귀 매매",
    description: "삼각수렴 이탈 후 가격이 수렴 중단부로 되돌아오는 구간에서 이탈 방향의 반대 신호를 내는 단기 평균회귀 전략입니다.",
    type: "trading",
    defaultParams: { patternBars: 20, breakoutPct: 0.02, returnTolerancePct: 0.01, minContractionRatio: 0.5, stopBufferPct: 0.005 },
    paramSchema: [
      { key: "patternBars", label: "수렴 확인 봉 수", type: "number", min: 10, max: 60, step: 1 },
      { key: "breakoutPct", label: "이탈 확인 비율", type: "number", min: 0.005, max: 0.08, step: 0.005 },
      { key: "returnTolerancePct", label: "중단부 회귀 허용폭", type: "number", min: 0.002, max: 0.05, step: 0.002 },
      { key: "minContractionRatio", label: "최소 수렴 축소율", type: "number", min: 0.2, max: 0.9, step: 0.05 },
      { key: "stopBufferPct", label: "손절 버퍼", type: "number", min: 0.001, max: 0.03, step: 0.001 },
    ],
    reference: "Triangle/consolidation breakout pullback mean-reversion rule; discretionary '삼수 매매' pattern",
  },
  evaluate(ohlcv, params) {
    const patternBars = Number(params.patternBars) || 20;
    const breakoutPct = Number(params.breakoutPct) || 0.02;
    const returnTolerancePct = Number(params.returnTolerancePct) || 0.01;
    const minContractionRatio = Number(params.minContractionRatio) || 0.5;
    const stopBufferPct = Number(params.stopBufferPct) || 0.005;

    if (ohlcv.length < patternBars + 2) return { signal: "HOLD", strength: 0, reason: "데이터 부족" };

    const pattern = ohlcv.slice(-(patternBars + 2), -2);
    const breakoutBar = ohlcv[ohlcv.length - 2];
    const returnBar = ohlcv[ohlcv.length - 1];

    const upperLine = calcLinearRegression(pattern.map(d => d.high));
    const lowerLine = calcLinearRegression(pattern.map(d => d.low));
    const upperStart = projectLine(upperLine, 0);
    const lowerStart = projectLine(lowerLine, 0);
    const upperEnd = projectLine(upperLine, patternBars - 1);
    const lowerEnd = projectLine(lowerLine, patternBars - 1);
    const widthStart = Math.abs(upperStart - lowerStart);
    const widthEnd = Math.abs(upperEnd - lowerEnd);

    const isContracting = upperLine.slope < 0 && lowerLine.slope > 0 && widthStart > 0 && widthEnd / widthStart <= minContractionRatio;
    if (!isContracting) {
      return {
        signal: "HOLD",
        strength: 0.2,
        reason: "뚜렷한 삼각수렴 아님",
        indicators: { upperSlope: upperLine.slope, lowerSlope: lowerLine.slope, widthStart, widthEnd } as Record<string, number>,
      };
    }

    const breakoutIndex = patternBars;
    const returnIndex = patternBars + 1;
    const upperAtBreakout = projectLine(upperLine, breakoutIndex);
    const lowerAtBreakout = projectLine(lowerLine, breakoutIndex);
    const upperAtReturn = projectLine(upperLine, returnIndex);
    const lowerAtReturn = projectLine(lowerLine, returnIndex);
    const midpoint = (upperAtReturn + lowerAtReturn) / 2;
    const returnDistance = midpoint > 0 ? Math.abs(returnBar.close - midpoint) / midpoint : Infinity;
    const returnedToMidpoint = returnDistance <= returnTolerancePct;

    const brokeUp = breakoutBar.close >= upperAtBreakout * (1 + breakoutPct);
    const brokeDown = breakoutBar.close <= lowerAtBreakout * (1 - breakoutPct);

    const contractionScore = Math.max(0, Math.min(1, 1 - widthEnd / widthStart));
    const returnScore = Math.max(0, Math.min(1, 1 - returnDistance / returnTolerancePct));
    const strength = Math.min(0.95, 0.6 + contractionScore * 0.25 + returnScore * 0.15);

    if (brokeDown && returnedToMidpoint) {
      const stopLoss = breakoutBar.low * (1 - stopBufferPct);
      return {
        signal: "BUY",
        strength,
        reason: `하방 이탈 후 중단부 회귀 (중단부: ${midpoint.toFixed(0)}, 손절 기준: ${stopLoss.toFixed(0)})`,
        indicators: { midpoint, returnDistance, upperAtBreakout, lowerAtBreakout, stopLoss, breakoutDirection: -1 } as Record<string, number>,
      };
    }

    if (brokeUp && returnedToMidpoint) {
      const stopLoss = breakoutBar.high * (1 + stopBufferPct);
      return {
        signal: "SELL",
        strength,
        reason: `상방 이탈 후 중단부 회귀 (중단부: ${midpoint.toFixed(0)}, 손절 기준: ${stopLoss.toFixed(0)})`,
        indicators: { midpoint, returnDistance, upperAtBreakout, lowerAtBreakout, stopLoss, breakoutDirection: 1 } as Record<string, number>,
      };
    }

    const breakoutText = brokeUp ? "상방 이탈" : brokeDown ? "하방 이탈" : "이탈 미확인";
    return {
      signal: "HOLD",
      strength: 0.3,
      reason: `${breakoutText}, 중단부 회귀 대기 (거리 ${(returnDistance * 100).toFixed(2)}%)`,
      indicators: { midpoint, returnDistance, upperAtBreakout, lowerAtBreakout, breakoutDirection: brokeUp ? 1 : brokeDown ? -1 : 0 } as Record<string, number>,
    };
  },
};

// ─── Strategy Registry ────────────────────────────────────────────────────────

export const SELECTION_STRATEGIES: ISelectionStrategy[] = [
  momentumSelectionStrategy,
  bollingerSelectionStrategy,
  rsiSelectionStrategy,
  goldenCrossSelectionStrategy,
  weekHigh52SelectionStrategy,
  macdSelectionStrategy,
  stochasticSelectionStrategy,
];

export const TRADING_STRATEGIES: ITradingStrategy[] = [
  momentumTradingStrategy,
  bollingerTradingStrategy,
  rsiTradingStrategy,
  goldenCrossTradingStrategy,
  weekHigh52TradingStrategy,
  macdTradingStrategy,
  stochasticTradingStrategy,
  abcTradingStrategy,
  fractalTradingStrategy,
  channelTradingStrategy,
  triangleReversionTradingStrategy,
];

export function getSelectionStrategy(id: string): ISelectionStrategy | undefined {
  return SELECTION_STRATEGIES.find(s => s.meta.id === id);
}

export function getTradingStrategy(id: string): ITradingStrategy | undefined {
  return TRADING_STRATEGIES.find(s => s.meta.id === id);
}

export function getAllStrategyMeta(): StrategyMeta[] {
  return [...SELECTION_STRATEGIES, ...TRADING_STRATEGIES].map(s => s.meta);
}
