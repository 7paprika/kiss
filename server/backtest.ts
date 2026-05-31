/**
 * Backtest Engine
 * Simulates trading strategy performance on historical OHLCV data.
 * 
 * Methodology:
 * - Walk-forward simulation: process each bar sequentially
 * - Single position per stock (no pyramiding)
 * - Market order execution at next bar's open price (realistic fill)
 * - Commission: 0.015% buy + 0.3% sell (KRX standard)
 * - Reports: total return, win rate, MDD, Sharpe ratio, trade log
 */

import type { KisOHLCV } from "./kisApi";
import { getTradingStrategy } from "./strategies/index";

export interface BacktestTrade {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPct: number;
  exitReason: string;
}

export interface BacktestResult {
  strategyId: string;
  strategyName: string;
  stockCode: string;
  period: string;
  initialCapital: number;
  finalCapital: number;
  totalReturn: number;       // %
  annualizedReturn: number;  // %
  maxDrawdown: number;       // %
  sharpeRatio: number;
  winRate: number;           // %
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  avgPnlPct: number;
  avgWinPct: number;
  avgLossPct: number;
  trades: BacktestTrade[];
  equityCurve: Array<{ date: string; equity: number }>;
}

const BUY_COMMISSION = 0.00015;   // 0.015%
const SELL_COMMISSION = 0.003;    // 0.3% (includes tax)

export function runBacktest(params: {
  strategyId: string;
  ohlcv: KisOHLCV[];
  stockCode: string;
  initialCapital?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  strategyParams?: Record<string, number | string | boolean>;
}): BacktestResult {
  const {
    strategyId,
    ohlcv,
    stockCode,
    initialCapital = 10_000_000,
    stopLossPct = 0,
    takeProfitPct = 0,
    strategyParams = {},
  } = params;

  const strategy = getTradingStrategy(strategyId);
  if (!strategy) {
    throw new Error(`Strategy not found: ${strategyId}`);
  }

  const trades: BacktestTrade[] = [];
  const equityCurve: Array<{ date: string; equity: number }> = [];

  let cash = initialCapital;
  let position: { quantity: number; entryPrice: number; entryDate: string } | null = null;
  let peakEquity = initialCapital;
  let maxDrawdown = 0;

  const formatDate = (d: KisOHLCV) =>
    `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`;

  for (let i = 30; i < ohlcv.length; i++) {
    const bar = ohlcv[i];
    const nextBar = ohlcv[i + 1];
    const historySlice = ohlcv.slice(0, i + 1);

    // Evaluate signal on current bar
    const signal = strategy.evaluate(historySlice, {
      ...strategy.meta.defaultParams,
      ...strategyParams,
    });

    const currentPrice = bar.close;
    const execPrice = nextBar ? nextBar.open : bar.close; // Execute at next bar open

    // Check stop-loss / take-profit if in position
    if (position) {
      const unrealizedPnlPct = (currentPrice - position.entryPrice) / position.entryPrice * 100;
      let exitReason = "";

      if (stopLossPct > 0 && unrealizedPnlPct <= -stopLossPct) {
        exitReason = `손절 (${unrealizedPnlPct.toFixed(2)}%)`;
      } else if (takeProfitPct > 0 && unrealizedPnlPct >= takeProfitPct) {
        exitReason = `익절 (${unrealizedPnlPct.toFixed(2)}%)`;
      } else if (signal.signal === "SELL" && signal.strength >= 0.5) {
        exitReason = `전략 매도: ${signal.reason}`;
      }

      if (exitReason) {
        const sellPrice = exitReason.startsWith("손절") || exitReason.startsWith("익절")
          ? currentPrice  // SL/TP execute at current bar close
          : execPrice;    // Strategy signal executes at next open
        const proceeds = sellPrice * position.quantity * (1 - SELL_COMMISSION);
        const pnl = proceeds - position.entryPrice * position.quantity * (1 + BUY_COMMISSION);
        const pnlPct = pnl / (position.entryPrice * position.quantity) * 100;

        trades.push({
          entryDate: position.entryDate,
          exitDate: formatDate(bar),
          entryPrice: position.entryPrice,
          exitPrice: sellPrice,
          quantity: position.quantity,
          pnl,
          pnlPct,
          exitReason,
        });

        cash += proceeds;
        position = null;
      }
    }

    // Buy signal
    if (!position && signal.signal === "BUY" && signal.strength >= 0.6 && nextBar) {
      const quantity = Math.floor(cash * 0.95 / (execPrice * (1 + BUY_COMMISSION)));
      if (quantity > 0) {
        const cost = execPrice * quantity * (1 + BUY_COMMISSION);
        cash -= cost;
        position = { quantity, entryPrice: execPrice, entryDate: formatDate(nextBar) };
      }
    }

    // Equity curve
    const holdingValue = position ? position.quantity * currentPrice : 0;
    const equity = cash + holdingValue;
    equityCurve.push({ date: formatDate(bar), equity });

    // Max drawdown
    if (equity > peakEquity) peakEquity = equity;
    const drawdown = (peakEquity - equity) / peakEquity * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Close open position at last bar
  if (position && ohlcv.length > 0) {
    const lastBar = ohlcv[ohlcv.length - 1];
    const sellPrice = lastBar.close;
    const proceeds = sellPrice * position.quantity * (1 - SELL_COMMISSION);
    const pnl = proceeds - position.entryPrice * position.quantity * (1 + BUY_COMMISSION);
    const pnlPct = pnl / (position.entryPrice * position.quantity) * 100;
    trades.push({
      entryDate: position.entryDate,
      exitDate: formatDate(lastBar),
      entryPrice: position.entryPrice,
      exitPrice: sellPrice,
      quantity: position.quantity,
      pnl,
      pnlPct,
      exitReason: "백테스트 종료",
    });
    cash += proceeds;
  }

  // Statistics
  const finalCapital = cash;
  const totalReturn = (finalCapital - initialCapital) / initialCapital * 100;

  // Annualized return
  const firstDate = new Date(`${ohlcv[0].date.slice(0, 4)}-${ohlcv[0].date.slice(4, 6)}-${ohlcv[0].date.slice(6, 8)}`);
  const lastDate = new Date(`${ohlcv[ohlcv.length - 1].date.slice(0, 4)}-${ohlcv[ohlcv.length - 1].date.slice(4, 6)}-${ohlcv[ohlcv.length - 1].date.slice(6, 8)}`);
  const years = Math.max((lastDate.getTime() - firstDate.getTime()) / (365.25 * 24 * 3600 * 1000), 0.01);
  const annualizedReturn = (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100;

  // Win/loss stats
  const winTrades = trades.filter(t => t.pnl > 0);
  const lossTrades = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length > 0 ? winTrades.length / trades.length * 100 : 0;
  const avgPnlPct = trades.length > 0 ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0;
  const avgWinPct = winTrades.length > 0 ? winTrades.reduce((s, t) => s + t.pnlPct, 0) / winTrades.length : 0;
  const avgLossPct = lossTrades.length > 0 ? lossTrades.reduce((s, t) => s + t.pnlPct, 0) / lossTrades.length : 0;

  // Sharpe ratio (simplified, daily returns, risk-free = 3.5% annual)
  const dailyReturns = equityCurve.map((e, i) => {
    if (i === 0) return 0;
    return (e.equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity;
  }).slice(1);
  const rfDaily = 0.035 / 252;
  const excessReturns = dailyReturns.map(r => r - rfDaily);
  const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / Math.max(excessReturns.length, 1);
  const stdExcess = Math.sqrt(excessReturns.reduce((s, r) => s + (r - meanExcess) ** 2, 0) / Math.max(excessReturns.length - 1, 1));
  const sharpeRatio = stdExcess > 0 ? (meanExcess / stdExcess) * Math.sqrt(252) : 0;

  const periodStr = `${ohlcv[0].date.slice(0, 4)}.${ohlcv[0].date.slice(4, 6)} ~ ${ohlcv[ohlcv.length - 1].date.slice(0, 4)}.${ohlcv[ohlcv.length - 1].date.slice(4, 6)}`;

  return {
    strategyId,
    strategyName: strategy.meta.name,
    stockCode,
    period: periodStr,
    initialCapital,
    finalCapital,
    totalReturn,
    annualizedReturn,
    maxDrawdown,
    sharpeRatio,
    winRate,
    totalTrades: trades.length,
    winTrades: winTrades.length,
    lossTrades: lossTrades.length,
    avgPnlPct,
    avgWinPct,
    avgLossPct,
    trades,
    equityCurve,
  };
}
