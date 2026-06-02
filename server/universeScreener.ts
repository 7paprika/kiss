import type { KisApiClient, KisOHLCV, KisRankCandidate } from "./kisApi";
import { loadKrxStocks, type StockSearchItem } from "./stockSearch";
import { TRADING_STRATEGIES, type ITradingStrategy, type Signal } from "./strategies/index";

export interface UniverseStock {
  code: string;
  name: string;
  market: string;
}

export interface UniverseQuote extends UniverseStock {
  price: number;
  volume: number;
  amount: number;
  statusCode?: string;
  warningCode?: string;
  halted?: boolean;
}

export interface ExcludedUniverseStock extends UniverseQuote {
  excludeReason: string;
}

export interface UniverseFilterOptions {
  minPrice: number;
  minVolume: number;
  minAmount: number;
  excludeManaged: boolean;
  excludeHalted: boolean;
  excludeEtfEtn: boolean;
  excludePreferred: boolean;
  excludeSpac: boolean;
  excludeReit: boolean;
}

export interface UniverseCandidate extends UniverseQuote {
  ohlcv: KisOHLCV[];
}

export interface StrategyUniverseMatch {
  stockCode: string;
  stockName: string;
  market: string;
  signal: Signal;
  strength: number;
  reason: string;
  priceAtScan: number;
  volume: number;
  amount: number;
}

export interface StrategyUniverseGroup {
  strategyId: string;
  strategyName: string;
  matches: StrategyUniverseMatch[];
}

export const DEFAULT_UNIVERSE_FILTERS: UniverseFilterOptions = {
  minPrice: 1_000,
  minVolume: 50_000,
  minAmount: 500_000_000,
  excludeManaged: true,
  excludeHalted: true,
  excludeEtfEtn: true,
  excludePreferred: true,
  excludeSpac: true,
  excludeReit: true,
};

export function normalizeUniverseStock(stock: StockSearchItem): UniverseStock {
  const rawMarket = stock.market.trim();
  const market = /코스닥|KOSDAQ/i.test(rawMarket) ? "KOSDAQ" : /코넥스|KONEX/i.test(rawMarket) ? "KONEX" : "KOSPI";
  return {
    code: stock.code.replace(/\D/g, "").padStart(6, "0"),
    name: stock.name.trim(),
    market,
  };
}

function isEtfEtnName(name: string): boolean {
  return /^(KODEX|TIGER|ACE|SOL|KBSTAR|HANARO|KOSEF|ARIRANG|RISE|PLUS|TIMEFOLIO|마이다스|히어로즈)/i.test(name)
    || /(ETF|ETN|인버스|레버리지|선물|채권|TR\b|액티브)/i.test(name);
}

function isPreferredName(name: string): boolean {
  return /(우$|우B$|우C$|우선주|[0-9]우B$)/.test(name);
}

function isSpacName(name: string): boolean {
  return /(스팩|SPAC)/i.test(name);
}

function isReitName(name: string): boolean {
  return /(리츠|REIT)/i.test(name);
}

function isManagedOrWarned(row: UniverseQuote): boolean {
  const status = String(row.statusCode || "").trim();
  const warning = String(row.warningCode || "").trim();
  if (!status && !warning) return false;
  return !["", "00", "0", "정상"].includes(status) || !["", "00", "0", "정상"].includes(warning);
}

export function getUniverseExclusionReason(row: UniverseQuote, options: UniverseFilterOptions): string | null {
  if (options.excludeHalted && row.halted) return "거래정지 제외";
  if (options.excludeManaged && isManagedOrWarned(row)) return "관리/투자주의 상태 제외";
  if (options.excludeSpac && isSpacName(row.name)) return "스팩 제외";
  if (options.excludePreferred && isPreferredName(row.name)) return "우선주 제외";
  if (options.excludeReit && isReitName(row.name)) return "리츠 제외";
  if (options.excludeEtfEtn && isEtfEtnName(row.name)) return "ETF/ETN 제외";
  if (row.price > 0 && row.price < options.minPrice) return "동전주 제외";
  if (row.volume < options.minVolume) return "저거래량 제외";
  if (row.amount < options.minAmount) return "거래대금 부족 제외";
  return null;
}

export function applyUniverseExclusions(rows: UniverseQuote[], options: UniverseFilterOptions = DEFAULT_UNIVERSE_FILTERS): { included: UniverseQuote[]; excluded: ExcludedUniverseStock[] } {
  const included: UniverseQuote[] = [];
  const excluded: ExcludedUniverseStock[] = [];
  for (const row of rows) {
    const excludeReason = getUniverseExclusionReason(row, options);
    if (excludeReason) excluded.push({ ...row, excludeReason });
    else included.push(row);
  }
  return { included, excluded };
}

export function evaluateTradingStrategiesForUniverse(
  candidates: UniverseCandidate[],
  strategies: Pick<ITradingStrategy, "meta" | "evaluate">[] = TRADING_STRATEGIES,
  options: { maxPerStrategy?: number } = {}
): StrategyUniverseGroup[] {
  const maxPerStrategy = options.maxPerStrategy ?? 10;
  return strategies.map((strategy) => {
    const matches: StrategyUniverseMatch[] = [];
    for (const candidate of candidates) {
      const signal = strategy.evaluate(candidate.ohlcv, strategy.meta.defaultParams);
      if (signal.signal !== "BUY") continue;
      matches.push({
        stockCode: candidate.code,
        stockName: candidate.name,
        market: candidate.market,
        signal: signal.signal,
        strength: signal.strength,
        reason: signal.reason,
        priceAtScan: candidate.price,
        volume: candidate.volume,
        amount: candidate.amount,
      });
    }
    matches.sort((a, b) => b.strength - a.strength);
    return { strategyId: strategy.meta.id, strategyName: strategy.meta.name, matches: matches.slice(0, maxPerStrategy) };
  });
}

function rankCandidateToQuote(row: KisRankCandidate): UniverseQuote {
  return {
    code: row.code,
    name: row.name,
    market: row.market || "KRX",
    price: row.price,
    volume: row.volume,
    amount: row.amount,
  };
}

export async function buildWholeMarketUniverse(options: {
  client: Pick<KisApiClient, "getCurrentPrice" | "getOHLCV"> & {
    getCurrentPriceDetail?: (stockCode: string) => Promise<UniverseQuote>;
    getVolumeRankCandidates?: (options?: { minPrice?: number; maxPrice?: number; minVolume?: number; sort?: "volume" | "amount" | "turnover" | "change"; count?: number }) => Promise<KisRankCandidate[]>;
  };
  filters?: UniverseFilterOptions;
  maxQuoteScan?: number;
  maxOhlcvFetch?: number;
  maxPerStrategy?: number;
  strategyIds?: string[];
}): Promise<{ source: "rank-api" | "quote-scan"; scanned: number; filtered: number; excluded: number; filters: UniverseFilterOptions; groups: StrategyUniverseGroup[] }> {
  const filters = options.filters ?? DEFAULT_UNIVERSE_FILTERS;
  const maxQuoteScan = options.maxQuoteScan ?? 600;
  const quotes: UniverseQuote[] = [];
  let source: "rank-api" | "quote-scan" = "quote-scan";

  if (options.client.getVolumeRankCandidates) {
    try {
      const ranked = await options.client.getVolumeRankCandidates({
        minPrice: filters.minPrice,
        minVolume: filters.minVolume,
        sort: "amount",
        count: maxQuoteScan,
      });
      quotes.push(...ranked.map(rankCandidateToQuote));
      source = "rank-api";
    } catch {
      // fall back to direct quote scan if rank API is temporarily unavailable
    }
  }

  if (!quotes.length) {
    const stocks = (await loadKrxStocks()).map(normalizeUniverseStock).filter((stock) => stock.market !== "KONEX");
    const quoteTargets = stocks.slice(0, maxQuoteScan);
    for (const stock of quoteTargets) {
      try {
        if (options.client.getCurrentPriceDetail) {
          const detail = await options.client.getCurrentPriceDetail(stock.code);
          quotes.push({ ...stock, ...detail, code: stock.code, name: detail.name || stock.name, market: stock.market });
        } else {
          const price = await options.client.getCurrentPrice(stock.code);
          quotes.push({ ...stock, price: price.currentPrice, volume: price.volume, amount: price.currentPrice * price.volume });
        }
      } catch {
        // skip temporarily unavailable symbols; they are not actionable candidates
      }
    }
  }

  const filtered = applyUniverseExclusions(quotes, filters).included
    .sort((a, b) => b.amount - a.amount || b.volume - a.volume);
  const maxOhlcvFetch = options.maxOhlcvFetch ?? 120;
  const candidates: UniverseCandidate[] = [];
  for (const row of filtered.slice(0, maxOhlcvFetch)) {
    try {
      const ohlcv = await options.client.getOHLCV(row.code, "D");
      if (ohlcv.length >= 30) candidates.push({ ...row, ohlcv });
    } catch {
      // skip symbols with unavailable chart data
    }
  }

  const strategySet = options.strategyIds?.length
    ? TRADING_STRATEGIES.filter((strategy) => options.strategyIds!.includes(strategy.meta.id))
    : TRADING_STRATEGIES;

  return {
    source,
    scanned: quotes.length,
    filtered: filtered.length,
    excluded: quotes.length - filtered.length,
    filters,
    groups: evaluateTradingStrategiesForUniverse(candidates, strategySet, { maxPerStrategy: options.maxPerStrategy }),
  };
}
