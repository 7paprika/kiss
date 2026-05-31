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

    // 하단 이탈 후 반등 진입
    if (prevPctB <= 0.05 && pctB > 0.05) {
      return { signal: "BUY", strength: 1 - pctB, reason: `볼린저 하단 반등 (pctB: ${pctB.toFixed(2)})`, indicators: { pctB, upper: last.upper, middle: last.middle, lower: last.lower } };
    }
    // 상단 도달 청산
    if (pctB >= 0.95) {
      return { signal: "SELL", strength: pctB, reason: `볼린저 상단 도달 (pctB: ${pctB.toFixed(2)})`, indicators: { pctB, upper: last.upper, middle: last.middle, lower: last.lower } };
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

// ─── Strategy Registry ────────────────────────────────────────────────────────

export const SELECTION_STRATEGIES: ISelectionStrategy[] = [
  momentumSelectionStrategy,
  bollingerSelectionStrategy,
  rsiSelectionStrategy,
  goldenCrossSelectionStrategy,
  weekHigh52SelectionStrategy,
];

export const TRADING_STRATEGIES: ITradingStrategy[] = [
  momentumTradingStrategy,
  bollingerTradingStrategy,
  rsiTradingStrategy,
  goldenCrossTradingStrategy,
  weekHigh52TradingStrategy,
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
