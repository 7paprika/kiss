/**
 * 전략 파라미터 최적화 엔진 (그리드 서치)
 * - 전략별 파라미터 탐색 공간 정의
 * - 백테스트 엔진을 활용한 조합별 성과 측정
 * - 최적 파라미터 추천
 */

import { runBacktest } from "./backtest";
import type { KisOHLCV } from "./kisApi";

export interface ParamRange {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface OptimizationResult {
  params: Record<string, number>;
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  totalTrades: number;
  score: number; // 종합 점수 (샤프비율 기반)
}

export interface OptimizationSummary {
  strategyId: string;
  strategyName: string;
  stockCode: string;
  period: string;
  totalCombinations: number;
  testedCombinations: number;
  bestResult: OptimizationResult;
  top5Results: OptimizationResult[];
  paramRanges: ParamRange[];
  durationMs: number;
}

/**
 * 전략별 파라미터 탐색 공간 정의
 */
export const STRATEGY_PARAM_SPACES: Record<string, ParamRange[]> = {
  // 종목 선정 전략
  momentum_selection: [
    { name: "lookbackDays", label: "모멘텀 기간(일)", min: 5, max: 60, step: 5, default: 20 },
    { name: "topN", label: "선정 종목 수", min: 3, max: 20, step: 1, default: 10 },
  ],
  bollinger_selection: [
    { name: "period", label: "볼린저 기간(일)", min: 10, max: 30, step: 2, default: 20 },
    { name: "stdDev", label: "표준편차 배수", min: 1.5, max: 3.0, step: 0.25, default: 2.0 },
  ],
  rsi_selection: [
    { name: "period", label: "RSI 기간(일)", min: 7, max: 21, step: 2, default: 14 },
    { name: "oversoldThreshold", label: "과매도 기준", min: 20, max: 40, step: 5, default: 30 },
  ],
  golden_cross_selection: [
    { name: "shortPeriod", label: "단기 이평(일)", min: 5, max: 20, step: 5, default: 5 },
    { name: "longPeriod", label: "장기 이평(일)", min: 20, max: 60, step: 10, default: 20 },
  ],
  // 실제 등록된 ID: week52_high_selection
  week52_high_selection: [
    { name: "lookbackDays", label: "52주 기간(일)", min: 120, max: 260, step: 20, default: 252 },
    { name: "breakoutPct", label: "돌파 비율(%)", min: 95, max: 100, step: 1, default: 98 },
  ],
  macd_selection: [
    { name: "fastPeriod", label: "단기 EMA(일)", min: 8, max: 16, step: 2, default: 12 },
    { name: "slowPeriod", label: "장기 EMA(일)", min: 20, max: 30, step: 2, default: 26 },
    { name: "signalPeriod", label: "시그널 기간(일)", min: 7, max: 11, step: 1, default: 9 },
  ],
  stochastic_selection: [
    { name: "kPeriod", label: "%K 기간(일)", min: 5, max: 21, step: 2, default: 14 },
    { name: "dPeriod", label: "%D 기간(일)", min: 2, max: 7, step: 1, default: 3 },
    { name: "oversoldThreshold", label: "과매도 기준", min: 15, max: 30, step: 5, default: 20 },
  ],
  // 매매 실행 전략
  momentum_trading: [
    { name: "lookbackDays", label: "모멘텀 기간(일)", min: 5, max: 60, step: 5, default: 20 },
    { name: "threshold", label: "신호 임계값(%)", min: 1, max: 10, step: 1, default: 3 },
  ],
  week52_high_trading: [
    { name: "lookbackDays", label: "52주 기간(일)", min: 120, max: 260, step: 20, default: 252 },
    { name: "breakoutPct", label: "돌파 비율(%)", min: 95, max: 100, step: 1, default: 98 },
  ],
  bollinger_trading: [
    { name: "period", label: "볼린저 기간(일)", min: 10, max: 30, step: 2, default: 20 },
    { name: "stdDev", label: "표준편차 배수", min: 1.5, max: 3.0, step: 0.25, default: 2.0 },
  ],
  rsi_trading: [
    { name: "period", label: "RSI 기간(일)", min: 7, max: 21, step: 2, default: 14 },
    { name: "oversoldThreshold", label: "과매도 기준", min: 20, max: 40, step: 5, default: 30 },
    { name: "overboughtThreshold", label: "과매수 기준", min: 60, max: 80, step: 5, default: 70 },
  ],
  golden_cross_trading: [
    { name: "shortPeriod", label: "단기 이평(일)", min: 5, max: 20, step: 5, default: 5 },
    { name: "longPeriod", label: "장기 이평(일)", min: 20, max: 60, step: 10, default: 20 },
  ],
  macd_trading: [
    { name: "fastPeriod", label: "단기 EMA(일)", min: 8, max: 16, step: 2, default: 12 },
    { name: "slowPeriod", label: "장기 EMA(일)", min: 20, max: 30, step: 2, default: 26 },
    { name: "signalPeriod", label: "시그널 기간(일)", min: 7, max: 11, step: 1, default: 9 },
  ],
  stochastic_trading: [
    { name: "kPeriod", label: "%K 기간(일)", min: 5, max: 21, step: 2, default: 14 },
    { name: "dPeriod", label: "%D 기간(일)", min: 2, max: 7, step: 1, default: 3 },
    { name: "oversoldThreshold", label: "과매도 기준", min: 15, max: 30, step: 5, default: 20 },
  ],
};

/**
 * 파라미터 조합 생성 (카르테시안 곱)
 */
function generateParamCombinations(ranges: ParamRange[]): Record<string, number>[] {
  if (ranges.length === 0) return [{}];

  const allValues: number[][] = ranges.map(r => {
    const values: number[] = [];
    for (let v = r.min; v <= r.max + 1e-9; v += r.step) {
      values.push(Math.round(v * 100) / 100);
    }
    return values;
  });

  // 카르테시안 곱
  let combinations: Record<string, number>[] = [{}];
  for (let i = 0; i < ranges.length; i++) {
    const newCombinations: Record<string, number>[] = [];
    for (const combo of combinations) {
      for (const val of allValues[i]) {
        newCombinations.push({ ...combo, [ranges[i].name]: val });
      }
    }
    combinations = newCombinations;
  }

  return combinations;
}

/**
 * 종합 점수 계산 (샤프비율 + 수익률 + MDD 패널티)
 */
function calcScore(result: {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
}): number {
  if (result.totalTrades < 3) return -999; // 거래 수 부족

  const sharpePenalty = result.sharpeRatio < 0 ? result.sharpeRatio * 2 : result.sharpeRatio;
  const mddPenalty = result.maxDrawdown > 30 ? -(result.maxDrawdown - 30) * 0.1 : 0;
  const returnScore = Math.min(result.totalReturn / 100, 2); // 최대 2점
  const winRateScore = (result.winRate - 50) / 100; // 50% 기준

  return sharpePenalty + returnScore + winRateScore + mddPenalty;
}

/**
 * 그리드 서치 최적화 실행
 */
export async function runGridSearch(options: {
  strategyId: string;
  ohlcv: KisOHLCV[];
  stockCode: string;
  period: string;
  initialCapital: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  maxCombinations?: number; // 최대 탐색 조합 수 (성능 제한)
}): Promise<OptimizationSummary> {
  const {
    strategyId,
    ohlcv,
    stockCode,
    period,
    initialCapital,
    stopLossPct,
    takeProfitPct,
    maxCombinations = 200,
  } = options;

  const startTime = Date.now();
  const paramRanges = STRATEGY_PARAM_SPACES[strategyId] || [];
  let combinations = generateParamCombinations(paramRanges);

  // 조합이 너무 많으면 랜덤 샘플링
  if (combinations.length > maxCombinations) {
    const shuffled = combinations.sort(() => Math.random() - 0.5);
    combinations = shuffled.slice(0, maxCombinations);
  }

  const results: OptimizationResult[] = [];

  for (const params of combinations) {
    try {
      const bt = runBacktest({
        strategyId,
        ohlcv,
        stockCode,
        initialCapital,
        stopLossPct,
        takeProfitPct,
        strategyParams: params,
      });

      const score = calcScore({
        totalReturn: bt.totalReturn,
        sharpeRatio: bt.sharpeRatio,
        maxDrawdown: bt.maxDrawdown,
        winRate: bt.winRate,
        totalTrades: bt.totalTrades,
      });

      results.push({
        params,
        totalReturn: bt.totalReturn,
        annualizedReturn: bt.annualizedReturn,
        maxDrawdown: bt.maxDrawdown,
        sharpeRatio: bt.sharpeRatio,
        winRate: bt.winRate,
        totalTrades: bt.totalTrades,
        score,
      });
    } catch {
      // 파라미터 조합이 유효하지 않은 경우 스킵
    }
  }

  // 점수 기준 정렬
  results.sort((a, b) => b.score - a.score);

  const bestResult = results[0] || {
    params: paramRanges.reduce((acc, r) => ({ ...acc, [r.name]: r.default }), {}),
    totalReturn: 0,
    annualizedReturn: 0,
    maxDrawdown: 0,
    sharpeRatio: 0,
    winRate: 0,
    totalTrades: 0,
    score: 0,
  };

  // 기본 백테스트 결과 가져오기 (전략명)
  let strategyName = strategyId;
  try {
    const defaultBt = runBacktest({ strategyId, ohlcv, stockCode, initialCapital });
    strategyName = defaultBt.strategyName;
  } catch {}

  return {
    strategyId,
    strategyName,
    stockCode,
    period,
    totalCombinations: combinations.length,
    testedCombinations: results.length,
    bestResult,
    top5Results: results.slice(0, 5),
    paramRanges,
    durationMs: Date.now() - startTime,
  };
}
