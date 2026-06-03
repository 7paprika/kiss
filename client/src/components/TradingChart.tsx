import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  createSeriesMarkers,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  PriceScaleMode,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type SeriesMarker,
  type ISeriesMarkersPluginApi,
  type Time,
} from "lightweight-charts";
import { trpc } from "@/lib/trpc";
import { useRealtimeQuote } from "@/hooks/useRealtime";
import { BarChart2, TrendingUp, Activity, Waves, GitBranch } from "lucide-react";

type Period = "1" | "5" | "15" | "30" | "60" | "D" | "W" | "M";
type Indicator = "ma" | "bb" | "volume" | "macd" | "stoch";

const periodOptions: Array<{ value: Period; label: string }> = [
  { value: "1", label: "1분" },
  { value: "5", label: "5분" },
  { value: "15", label: "15분" },
  { value: "30", label: "30분" },
  { value: "60", label: "60분" },
  { value: "D", label: "일" },
  { value: "W", label: "주" },
  { value: "M", label: "월" },
];

interface Props {
  stockCode: string;
  stockName: string;
}

// ─── Technical Indicator Calculations ────────────────────────────────────────

function calcSMA(data: number[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    return data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

function calcEMAArr(data: number[], period: number): number[] {
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

function calcBB(closes: number[], period = 20, mult = 2) {
  const sma = calcSMA(closes, period);
  return closes.map((_, i) => {
    if (sma[i] === null) return { upper: null, middle: null, lower: null };
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i]!;
    const sd = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    return { upper: mean + mult * sd, middle: mean, lower: mean - mult * sd };
  });
}

function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMAArr(closes, fast);
  const emaSlow = calcEMAArr(closes, slow);
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = calcEMAArr(macdLine, signal);
  return closes.map((_, i) => ({
    macd: isNaN(macdLine[i]) ? null : macdLine[i],
    signal: isNaN(signalLine[i]) ? null : signalLine[i],
    histogram: (isNaN(macdLine[i]) || isNaN(signalLine[i])) ? null : macdLine[i] - signalLine[i],
  }));
}

function calcStochastic(highs: number[], lows: number[], closes: number[], k = 14, d = 3) {
  const rawK: (number | null)[] = closes.map((_, i) => {
    if (i < k - 1) return null;
    const highSlice = highs.slice(i - k + 1, i + 1);
    const lowSlice = lows.slice(i - k + 1, i + 1);
    const hh = Math.max(...highSlice);
    const ll = Math.min(...lowSlice);
    return hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
  });
  // Smooth %K with 3-period SMA
  const smoothK: (number | null)[] = rawK.map((_, i) => {
    if (i < k + 1) return null;
    const slice = rawK.slice(i - 2, i + 1).filter((v): v is number => v !== null);
    return slice.length === 3 ? slice.reduce((a, b) => a + b, 0) / 3 : null;
  });
  // %D = 3-period SMA of %K
  const smoothD: (number | null)[] = smoothK.map((_, i) => {
    if (i < k + 3) return null;
    const slice = smoothK.slice(i - 2, i + 1).filter((v): v is number => v !== null);
    return slice.length === 3 ? slice.reduce((a, b) => a + b, 0) / 3 : null;
  });
  return closes.map((_, i) => ({ k: smoothK[i], d: smoothD[i] }));
}

const CHART_THEME = {
  bg: "#18191d",
  text: "#85878d",
  grid: "#2a2b30",
  border: "#313238",
};

function formatVolume(value?: number) {
  if (!value) return "--";
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}만`;
  return value.toLocaleString("ko-KR");
}

function formatAmount(value?: number) {
  if (!value) return "--";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(0)}만`;
  return value.toLocaleString("ko-KR");
}

function formatProgramTime(time?: string) {
  if (!time || time.length < 6) return "--";
  return `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
}

function toChartTime(date: string): Time {
  if (date.length >= 12) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(8, 10)}:${date.slice(10, 12)}:00` as Time;
  }
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` as Time;
}

function signalColor(signal: "BUY" | "SELL") {
  return signal === "BUY" ? "#22c55e" : "#ef4444";
}

type StrategySignalOverlay = {
  strategyId: string;
  strategyName: string;
  date: string;
  signal: "BUY" | "SELL";
  strength: number;
};

function buildStrategyMarkers(signals: StrategySignalOverlay[]): SeriesMarker<Time>[] {
  return signals.map((signal) => ({
    id: `${signal.strategyId}-${signal.date}-${signal.signal}`,
    time: toChartTime(signal.date),
    position: signal.signal === "BUY" ? "belowBar" : "aboveBar",
    shape: signal.signal === "BUY" ? "arrowUp" : "arrowDown",
    color: signalColor(signal.signal),
    text: `${signal.signal === "BUY" ? "매수" : "청산"} ${signal.strategyName}`,
    size: Math.max(1, Math.min(1.8, 0.8 + signal.strength)),
  }));
}

export default function TradingChart({ stockCode, stockName }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  const stochContainerRef = useRef<HTMLDivElement>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const volChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const stochChartRef = useRef<IChartApi | null>(null);

  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maSeriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const bbSeriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const macdSeriesRefs = useRef<Map<string, ISeriesApi<"Line" | "Histogram">>>(new Map());
  const stochSeriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const strategyMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const patternSeriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  const [period, setPeriod] = useState<Period>("D");
  const [indicators, setIndicators] = useState<Set<Indicator>>(new Set<Indicator>(["ma", "volume"]));
  const [selectedChartStrategyId, setSelectedChartStrategyId] = useState<string>("bollinger_trading");
  const [showProgramTrading, setShowProgramTrading] = useState(true);
  const [showStrategySignals, setShowStrategySignals] = useState(true);
  const [crosshairData, setCrosshairData] = useState<{
    time?: string; open?: number; high?: number; low?: number; close?: number; volume?: number;
  }>({});

  const { data: kisSettings } = trpc.kis.getSettings.useQuery(undefined, {
    staleTime: 60_000,
  });
  const { data: allStrategyMeta = [] } = trpc.strategy.getAllMeta.useQuery();
  const tradingStrategyOptions = allStrategyMeta.filter((meta) => meta.type === "trading");
  const selectedChartStrategyName = tradingStrategyOptions.find((meta) => meta.id === selectedChartStrategyId)?.name ?? selectedChartStrategyId;
  const isKisActive = Boolean(kisSettings?.isActive);

  const { data: ohlcv, isLoading, error: ohlcvError } = trpc.kis.getOHLCV.useQuery(
    { stockCode, period },
    { enabled: !!stockCode && Boolean(kisSettings?.isActive), staleTime: 60_000, retry: false }
  );

  const { data: programTrade, isLoading: isProgramTradeLoading, error: programTradeError } = trpc.kis.getProgramTradeByStock.useQuery(
    { stockCode },
    { enabled: isKisActive && !!stockCode && showProgramTrading, staleTime: 30_000, retry: false }
  );

  const { data: strategyAnnotations } = trpc.backtest.getSignalAnnotations.useQuery(
    { stockCode, period, strategyIds: [selectedChartStrategyId] },
    { enabled: isKisActive && !!stockCode && !!selectedChartStrategyId && showStrategySignals, staleTime: 60_000, retry: false }
  );

  // Realtime tick: subscribe to live price via Socket.IO
  const { quote: realtimeQuote } = useRealtimeQuote(kisSettings?.isActive ? stockCode : null);

  // Update the last candle bar when a realtime tick arrives
  useEffect(() => {
    if (!realtimeQuote || !candleSeriesRef.current || period !== "D") return;
    const today = new Date();
    const timeStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const price = realtimeQuote.currentPrice || 0;
    if (!price) return;
    const open = realtimeQuote.open || price;
    const high = realtimeQuote.high || price;
    const low = realtimeQuote.low || price;
    const volume = realtimeQuote.volume || 0;
    candleSeriesRef.current.update({
      time: timeStr as Time,
      open: open || price,
      high: Math.max(high || price, price),
      low: Math.min(low || price, price),
      close: price,
    });
    if (volSeriesRef.current && volume) {
      volSeriesRef.current.update({
        time: timeStr as Time,
        value: volume,
        color: price >= (open || price) ? "rgba(38,166,154,0.6)" : "rgba(239,83,80,0.6)",
      });
    }
    // Update crosshair display
    setCrosshairData(prev => ({
      ...prev,
      open: open || price,
      close: price,
      high: Math.max(high || price, price),
      low: Math.min(low || price, price),
      volume: volume || prev.volume,
    }));
  }, [realtimeQuote, period]);

  const toggleIndicator = useCallback((ind: Indicator) => {
    setIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(ind)) next.delete(ind); else next.add(ind);
      return next;
    });
  }, []);

  const baseChartOptions = {
    layout: {
      background: { type: ColorType.Solid, color: CHART_THEME.bg },
      textColor: CHART_THEME.text,
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: CHART_THEME.grid },
      horzLines: { color: CHART_THEME.grid },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: {
      borderColor: CHART_THEME.border,
      scaleMargins: { top: 0.05, bottom: 0.05 },
    },
    timeScale: {
      borderColor: CHART_THEME.border,
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: true,
    handleScale: true,
  };

  // Initialize main + volume chart
  useEffect(() => {
    if (!isKisActive) return;
    if (!chartContainerRef.current || !volumeContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      ...baseChartOptions,
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a65a",
      downColor: "#ef5350",
      borderUpColor: "#26a65a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a65a",
      wickDownColor: "#ef5350",
    });
    candleSeriesRef.current = candleSeries;

    const volChart = createChart(volumeContainerRef.current, {
      ...baseChartOptions,
      width: volumeContainerRef.current.clientWidth,
      height: volumeContainerRef.current.clientHeight,
      rightPriceScale: { ...baseChartOptions.rightPriceScale, scaleMargins: { top: 0.12, bottom: 0.02 }, mode: PriceScaleMode.Normal },
      timeScale: { ...baseChartOptions.timeScale, visible: false },
    });
    volChartRef.current = volChart;

    const volSeries = volChart.addSeries(HistogramSeries, {
      color: "rgba(33, 150, 243, 0.6)",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: true,
    });
    volSeriesRef.current = volSeries;
    volChart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) return;
      const data = param.seriesData.get(candleSeries) as CandlestickData | undefined;
      const volume = param.seriesData.get(volSeries) as HistogramData | undefined;
      if (data) {
        setCrosshairData({
          time: String(param.time),
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: volume?.value,
        });
      }
    });

    // Sync timescales
    const syncCharts = [volChart];
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) syncCharts.forEach(c => c.timeScale().setVisibleLogicalRange(range));
    });

    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight });
      if (volumeContainerRef.current) volChart.applyOptions({ width: volumeContainerRef.current.clientWidth, height: volumeContainerRef.current.clientHeight });
    });
    if (chartContainerRef.current) ro.observe(chartContainerRef.current);
    if (volumeContainerRef.current) ro.observe(volumeContainerRef.current);

    return () => {
      ro.disconnect();
      chart.remove(); volChart.remove();
      chartRef.current = null; volChartRef.current = null;
      candleSeriesRef.current = null; volSeriesRef.current = null;
      strategyMarkersRef.current = null;
      maSeriesRefs.current.clear(); bbSeriesRefs.current.clear(); patternSeriesRefs.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKisActive]);

  // Initialize MACD chart
  useEffect(() => {
    if (!isKisActive) return;
    if (!macdContainerRef.current || !indicators.has("macd")) return;
    if (macdChartRef.current) return; // already initialized

    const macdChart = createChart(macdContainerRef.current, {
      ...baseChartOptions,
      width: macdContainerRef.current.clientWidth,
      height: macdContainerRef.current.clientHeight,
      rightPriceScale: { ...baseChartOptions.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { ...baseChartOptions.timeScale, visible: false },
    });
    macdChartRef.current = macdChart;

    // Sync with main chart
    chartRef.current?.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) macdChart.timeScale().setVisibleLogicalRange(range);
    });

    const ro = new ResizeObserver(() => {
      if (macdContainerRef.current) macdChart.applyOptions({ width: macdContainerRef.current.clientWidth, height: macdContainerRef.current.clientHeight });
    });
    if (macdContainerRef.current) ro.observe(macdContainerRef.current);

    return () => {
      ro.disconnect();
      macdChart.remove();
      macdChartRef.current = null;
      macdSeriesRefs.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKisActive, indicators.has("macd")]);

  // Initialize Stochastic chart
  useEffect(() => {
    if (!isKisActive) return;
    if (!stochContainerRef.current || !indicators.has("stoch")) return;
    if (stochChartRef.current) return;

    const stochChart = createChart(stochContainerRef.current, {
      ...baseChartOptions,
      width: stochContainerRef.current.clientWidth,
      height: stochContainerRef.current.clientHeight,
      rightPriceScale: { ...baseChartOptions.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { ...baseChartOptions.timeScale, visible: false },
    });
    stochChartRef.current = stochChart;

    chartRef.current?.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) stochChart.timeScale().setVisibleLogicalRange(range);
    });

    const ro = new ResizeObserver(() => {
      if (stochContainerRef.current) stochChart.applyOptions({ width: stochContainerRef.current.clientWidth, height: stochContainerRef.current.clientHeight });
    });
    if (stochContainerRef.current) ro.observe(stochContainerRef.current);

    return () => {
      ro.disconnect();
      stochChart.remove();
      stochChartRef.current = null;
      stochSeriesRefs.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKisActive, indicators.has("stoch")]);

  // Update data
  useEffect(() => {
    if (!isKisActive) return;
    if (!ohlcv || !candleSeriesRef.current || !volSeriesRef.current || !chartRef.current) return;

    const times = ohlcv.map((d) => toChartTime(d.date));
    const closes = ohlcv.map((d) => d.close);
    const highs = ohlcv.map((d) => d.high);
    const lows = ohlcv.map((d) => d.low);

    // Candle data
    const candleData: CandlestickData[] = ohlcv.map((d, i) => ({
      time: times[i], open: d.open, high: d.high, low: d.low, close: d.close,
    }));
    candleSeriesRef.current.setData(candleData);

    // Volume data
    const volData: HistogramData[] = ohlcv.map((d, i) => ({
      time: times[i],
      value: d.volume,
      color: d.close >= (i > 0 ? ohlcv[i - 1].close : d.close) ? "rgba(38, 166, 90, 0.6)" : "rgba(239, 83, 80, 0.6)",
    }));
    volSeriesRef.current.setData(volData);
    volChartRef.current?.timeScale().fitContent();

    // Remove old MA/BB series
    maSeriesRefs.current.forEach((s) => chartRef.current?.removeSeries(s));
    maSeriesRefs.current.clear();
    bbSeriesRefs.current.forEach((s) => chartRef.current?.removeSeries(s));
    bbSeriesRefs.current.clear();

    // Moving Averages
    if (indicators.has("ma")) {
      const maConfigs = [
        { period: 5, color: "#f5c542" },
        { period: 20, color: "#2196f3" },
        { period: 60, color: "#b46cff" },
        { period: 120, color: "#f97316" },
      ];
      for (const { period: p, color } of maConfigs) {
        if (ohlcv.length < p) continue;
        const maValues = calcSMA(closes, p);
        const maData: LineData[] = times.map((t, i) => ({ time: t, value: maValues[i] })).filter((d): d is LineData => d.value !== null);
        const series = chartRef.current.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        series.setData(maData);
        maSeriesRefs.current.set(`ma${p}`, series);
      }
    }

    // Bollinger Bands
    if (indicators.has("bb")) {
      const bbValues = calcBB(closes);
      const bbColor = "rgba(125, 142, 168, 0.7)";
      const upperData: LineData[] = times.map((t, i) => ({ time: t, value: bbValues[i].upper })).filter((d): d is LineData => d.value !== null);
      const middleData: LineData[] = times.map((t, i) => ({ time: t, value: bbValues[i].middle })).filter((d): d is LineData => d.value !== null);
      const lowerData: LineData[] = times.map((t, i) => ({ time: t, value: bbValues[i].lower })).filter((d): d is LineData => d.value !== null);
      [
        { key: "bb-upper", data: upperData, style: 1 },
        { key: "bb-middle", data: middleData, style: 2 },
        { key: "bb-lower", data: lowerData, style: 1 },
      ].forEach(({ key, data, style }) => {
        const s = chartRef.current!.addSeries(LineSeries, { color: bbColor, lineWidth: 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false });
        s.setData(data);
        bbSeriesRefs.current.set(key, s);
      });
    }

    // MACD
    if (indicators.has("macd") && macdChartRef.current) {
      macdSeriesRefs.current.forEach((s) => macdChartRef.current?.removeSeries(s as ISeriesApi<"Line">));
      macdSeriesRefs.current.clear();

      const macdValues = calcMACD(closes);

      const macdLine: LineData[] = times.map((t, i) => ({ time: t, value: macdValues[i].macd })).filter((d): d is LineData => d.value !== null);
      const signalLine: LineData[] = times.map((t, i) => ({ time: t, value: macdValues[i].signal })).filter((d): d is LineData => d.value !== null);
      const histData: HistogramData[] = times.map((t, i) => ({
        time: t,
        value: macdValues[i].histogram ?? 0,
        color: (macdValues[i].histogram ?? 0) >= 0 ? "rgba(38, 166, 90, 0.7)" : "rgba(239, 83, 80, 0.7)",
      })).filter((_, i) => macdValues[i].histogram !== null);

      const macdLineSeries = macdChartRef.current.addSeries(LineSeries, { color: "#2196f3", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      macdLineSeries.setData(macdLine);
      macdSeriesRefs.current.set("macd", macdLineSeries);

      const signalSeries = macdChartRef.current.addSeries(LineSeries, { color: "#ff8a3d", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      signalSeries.setData(signalLine);
      macdSeriesRefs.current.set("signal", signalSeries);

      const histSeries = macdChartRef.current.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
      histSeries.setData(histData);
      macdSeriesRefs.current.set("hist", histSeries as unknown as ISeriesApi<"Line">);

      macdChartRef.current.timeScale().fitContent();
    }

    // Stochastic
    if (indicators.has("stoch") && stochChartRef.current) {
      stochSeriesRefs.current.forEach((s) => stochChartRef.current?.removeSeries(s));
      stochSeriesRefs.current.clear();

      const stochValues = calcStochastic(highs, lows, closes);

      const kData: LineData[] = times.map((t, i) => ({ time: t, value: stochValues[i].k })).filter((d): d is LineData => d.value !== null);
      const dData: LineData[] = times.map((t, i) => ({ time: t, value: stochValues[i].d })).filter((d): d is LineData => d.value !== null);

      const kSeries = stochChartRef.current.addSeries(LineSeries, { color: "#b46cff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      kSeries.setData(kData);
      stochSeriesRefs.current.set("k", kSeries);

      const dSeries = stochChartRef.current.addSeries(LineSeries, { color: "#f5c542", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      dSeries.setData(dData);
      stochSeriesRefs.current.set("d", dSeries);

      stochChartRef.current.timeScale().fitContent();
    }

    chartRef.current.timeScale().fitContent();
  }, [isKisActive, ohlcv, indicators]);

  useEffect(() => {
    if (!isKisActive || !chartRef.current || !candleSeriesRef.current) return;

    if (!showStrategySignals) {
      strategyMarkersRef.current?.setMarkers([]);
      patternSeriesRefs.current.forEach((series) => chartRef.current?.removeSeries(series));
      patternSeriesRefs.current.clear();
      return;
    }

    if (!strategyMarkersRef.current) {
      strategyMarkersRef.current = createSeriesMarkers(candleSeriesRef.current, []);
    }
    strategyMarkersRef.current.setMarkers(buildStrategyMarkers(strategyAnnotations?.signals ?? []));

    patternSeriesRefs.current.forEach((series) => chartRef.current?.removeSeries(series));
    patternSeriesRefs.current.clear();

    strategyAnnotations?.patterns.forEach((pattern, patternIndex) => {
      const segments = pattern.kind === "channel" && pattern.points.length >= 4
        ? [pattern.points.slice(0, 2), pattern.points.slice(2, 4)]
        : [pattern.points];

      segments.forEach((points, segmentIndex) => {
        const data: LineData[] = points.map((p) => ({ time: toChartTime(p.date), value: p.value }));
        const series = chartRef.current!.addSeries(LineSeries, {
          color: pattern.color,
          lineWidth: pattern.kind === "zigzag" ? 2 : 1,
          lineStyle: pattern.kind === "channel" || pattern.kind === "triangle" ? 2 : 0,
          priceLineVisible: false,
          lastValueVisible: false,
          title: pattern.label,
        });
        series.setData(data);
        patternSeriesRefs.current.set(`${pattern.strategyId}-${patternIndex}-${segmentIndex}`, series);
      });
    });
  }, [isKisActive, strategyAnnotations, showStrategySignals]);

  const last = ohlcv?.[ohlcv.length - 1];
  const prev = ohlcv?.[ohlcv.length - 2];
  const displayData = crosshairData.close ? crosshairData : last ? {
    time: last.date, open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume,
  } : {};
  const isUp = displayData.close && prev ? displayData.close >= prev.close : true;

  // Compute last MACD/Stoch values for legend
  const closes = ohlcv?.map(d => d.close) ?? [];
  const highs = ohlcv?.map(d => d.high) ?? [];
  const lows = ohlcv?.map(d => d.low) ?? [];
  const macdVals = closes.length > 26 ? calcMACD(closes) : null;
  const lastMacd = macdVals?.[macdVals.length - 1];
  const stochVals = closes.length > 17 ? calcStochastic(highs, lows, closes) : null;
  const lastStoch = stochVals?.[stochVals.length - 1];

  return (
    <div className="flex flex-col h-full">
      {/* Chart Header */}
      <div className="flex flex-col gap-2 px-3 py-2 border-b border-border md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <div className="min-w-0">
            <span className="font-semibold text-sm">{stockName}</span>
            <span className="text-muted-foreground text-xs ml-2">{stockCode}</span>
          </div>
          {displayData.close && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
              <span className={`text-base font-bold ${isUp ? "text-bull" : "text-bear"}`}>
                {displayData.close.toLocaleString()}
              </span>
              <span className="text-muted-foreground">
                O:{displayData.open?.toLocaleString()} H:{displayData.high?.toLocaleString()} L:{displayData.low?.toLocaleString()}
              </span>
              {displayData.volume && (
                <span className="text-muted-foreground">거래량:{formatVolume(displayData.volume)}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
          {/* Period selector */}
          <div className="flex flex-wrap gap-0.5 bg-secondary rounded p-0.5">
            {periodOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setPeriod(option.value)}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  period === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Data overlay switches */}
          <div className="grid w-full grid-cols-2 gap-1 rounded bg-secondary/60 p-1 sm:w-auto md:flex md:items-center">
            {[
              {
                label: "프로그램",
                checked: showProgramTrading,
                onChange: () => setShowProgramTrading((value) => !value),
                ariaLabel: "프로그램 매매 내역 표시 전환",
              },
              {
                label: "신호",
                checked: showStrategySignals,
                onChange: () => setShowStrategySignals((value) => !value),
                ariaLabel: "전략 신호 표시 전환",
              },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                role="switch"
                aria-checked={item.checked}
                aria-label={item.ariaLabel}
                onClick={item.onChange}
                className="inline-flex min-h-[32px] min-w-0 items-center justify-center gap-1 rounded px-2 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground md:min-h-[24px] md:text-[10px]"
                title={item.ariaLabel}
              >
                <span className="whitespace-nowrap">{item.label}</span>
                <span className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full border transition-colors md:h-[16px] md:w-[28px] ${
                  item.checked ? "border-primary/50 bg-primary/30" : "border-border bg-card"
                }`}>
                  <span className={`inline-block h-[16px] w-[16px] rounded-full bg-foreground transition-transform md:h-[12px] md:w-[12px] ${
                    item.checked ? "translate-x-[16px] md:translate-x-[14px]" : "translate-x-[2px] bg-muted-foreground"
                  }`} />
                </span>
              </button>
            ))}
          </div>

          {/* Strategy overlay selector */}
          <label className="flex min-w-0 flex-1 items-center gap-1 text-[10px] text-muted-foreground sm:flex-none">
            <span>차트 전략</span>
            <select
              value={selectedChartStrategyId}
              onChange={(event) => setSelectedChartStrategyId(event.target.value)}
              disabled={!showStrategySignals}
              className="h-7 min-w-0 max-w-[150px] flex-1 rounded border border-border bg-secondary px-2 text-xs text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:h-6 sm:flex-none"
              aria-label="차트에 표시할 전략 선택"
            >
              {tradingStrategyOptions.map((meta) => (
                <option key={meta.id} value={meta.id}>{meta.name}</option>
              ))}
            </select>
          </label>

          {/* Indicator toggles */}
          <div className="flex flex-wrap gap-0.5">
            {[
              { key: "ma" as Indicator, label: "MA", icon: <TrendingUp size={10} />, activeClass: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30", title: "이동평균선" },
              { key: "bb" as Indicator, label: "BB", icon: <Activity size={10} />, activeClass: "bg-blue-500/20 text-blue-400 border border-blue-500/30", title: "볼린저밴드" },
              { key: "volume" as Indicator, label: "VOL", icon: <BarChart2 size={10} />, activeClass: "bg-primary/20 text-primary border border-primary/30", title: "거래량" },
              { key: "macd" as Indicator, label: "MACD", icon: <GitBranch size={10} />, activeClass: "bg-green-500/20 text-green-400 border border-green-500/30", title: "MACD" },
              { key: "stoch" as Indicator, label: "STOCH", icon: <Waves size={10} />, activeClass: "bg-purple-500/20 text-purple-400 border border-purple-500/30", title: "스토캐스틱" },
            ].map(({ key, label, icon, activeClass, title }) => (
              <button
                key={key}
                onClick={() => toggleIndicator(key)}
                className={`inline-flex min-h-[28px] items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
                  indicators.has(key) ? activeClass : "text-muted-foreground hover:text-foreground"
                }`}
                title={title}
              >
                {icon}{label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MA Legend */}
      {indicators.has("ma") && (
        <div className="flex items-center gap-3 px-3 py-1 text-[10px] border-b border-border/50">
          {[
            { period: 5, color: "#f5c542" },
            { period: 20, color: "#2196f3" },
            { period: 60, color: "#b46cff" },
            { period: 120, color: "#f97316" },
          ].map(({ period: p, color }) => {
            const ma = calcSMA(closes, p);
            const lastMa = ma[ma.length - 1];
            return (
              <span key={p} style={{ color }}>
                MA{p}: {lastMa ? lastMa.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "--"}
              </span>
            );
          })}
        </div>
      )}

      {showStrategySignals && isKisActive && strategyAnnotations && (
        <div className="strategy-signal-legend flex items-center gap-3 px-3 py-1 text-[10px] border-b border-border/50 bg-card/40">
          <span className="font-semibold text-foreground">매매신호</span>
          <span className="text-muted-foreground">{selectedChartStrategyName}</span>
          <span className="text-bull">▲ 매수 {strategyAnnotations.signals.filter((signal) => signal.signal === "BUY").length}</span>
          <span className="text-bear">▼ 청산 {strategyAnnotations.signals.filter((signal) => signal.signal === "SELL").length}</span>
          <span className="text-muted-foreground">패턴선 {strategyAnnotations.patterns.length}</span>
          {strategyAnnotations.signals.length === 0 && <span className="text-muted-foreground">현재 구간 신호 없음</span>}
        </div>
      )}

      {/* Program Trading Card */}
      {showProgramTrading && isKisActive && (
        <div className="border-b border-border/50 bg-secondary/20 px-3 py-2">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <Activity size={13} className="text-blue-400" />
              <span className="text-xs font-semibold">프로그램 매매</span>
              <span className="text-[10px] text-muted-foreground">{formatProgramTime(programTrade?.time)}</span>
            </div>
            {isProgramTradeLoading && <span className="text-[10px] text-muted-foreground">조회 중...</span>}
            {programTradeError && <span className="text-[10px] text-red-400">조회 실패</span>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <div className="rounded bg-card/60 border border-border/40 px-2 py-1.5">
              <div className="text-muted-foreground text-[10px]">프로그램 매수</div>
              <div className="font-mono text-bull">{formatVolume(programTrade?.buyVolume)}</div>
              <div className="font-mono text-[10px] text-muted-foreground">{formatAmount(programTrade?.buyAmount)}</div>
            </div>
            <div className="rounded bg-card/60 border border-border/40 px-2 py-1.5">
              <div className="text-muted-foreground text-[10px]">프로그램 매도</div>
              <div className="font-mono text-bear">{formatVolume(programTrade?.sellVolume)}</div>
              <div className="font-mono text-[10px] text-muted-foreground">{formatAmount(programTrade?.sellAmount)}</div>
            </div>
            <div className="rounded bg-card/60 border border-border/40 px-2 py-1.5">
              <div className="text-muted-foreground text-[10px]">프로그램 순매수</div>
              <div className={`font-mono ${programTrade && programTrade.netBuyVolume >= 0 ? "text-bull" : "text-bear"}`}>
                {formatVolume(programTrade?.netBuyVolume)}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">{formatAmount(programTrade?.netBuyAmount)}</div>
            </div>
            <div className="rounded bg-card/60 border border-border/40 px-2 py-1.5">
              <div className="text-muted-foreground text-[10px]">순매수 증감</div>
              <div className={`font-mono ${programTrade && programTrade.netBuyVolumeChange >= 0 ? "text-bull" : "text-bear"}`}>
                {formatVolume(programTrade?.netBuyVolumeChange)}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">{formatAmount(programTrade?.netBuyAmountChange)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Main Chart */}
      <div className="flex-1 relative min-h-0">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <div className="text-muted-foreground text-xs">차트 로딩 중...</div>
          </div>
        )}
        {!isKisActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/80 z-10 text-center px-6">
            <BarChart2 size={36} className="text-muted-foreground opacity-30 mb-3" />
            <div className="text-sm font-medium">KIS API를 연결하면 차트가 표시됩니다</div>
            <div className="text-xs text-muted-foreground mt-1">API 설정에서 계좌를 연결한 뒤 다시 종목을 선택하세요.</div>
          </div>
        )}
        {isKisActive && ohlcvError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/80 z-10 text-center px-6">
            <BarChart2 size={36} className="text-muted-foreground opacity-30 mb-3" />
            <div className="text-sm font-medium">차트 데이터를 불러오지 못했습니다</div>
            <div className="text-xs text-muted-foreground mt-1">{ohlcvError.message}</div>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>

      {/* Volume Chart */}
      {indicators.has("volume") && (
        <div className="relative h-24 md:h-16 border-t border-border">
          <div className="absolute right-3 mt-1 z-[1] text-[10px] text-muted-foreground pointer-events-none">
            거래량 {formatVolume(displayData.volume)}
          </div>
          <div ref={volumeContainerRef} className="w-full h-full" />
        </div>
      )}

      {/* MACD Chart */}
      {indicators.has("macd") && (
        <div className="h-20 border-t border-border">
          <div className="flex items-center gap-3 px-3 pt-1 text-[10px] text-muted-foreground">
            <span className="text-green-400 font-semibold">MACD</span>
            {lastMacd && (
              <>
                <span style={{ color: "#2196f3" }}>MACD: {lastMacd.macd?.toFixed(2) ?? "--"}</span>
                <span style={{ color: "#ff8a3d" }}>Signal: {lastMacd.signal?.toFixed(2) ?? "--"}</span>
                <span className={lastMacd.histogram !== null && lastMacd.histogram >= 0 ? "text-bull" : "text-bear"}>
                  Hist: {lastMacd.histogram?.toFixed(2) ?? "--"}
                </span>
              </>
            )}
          </div>
          <div ref={macdContainerRef} className="w-full" style={{ height: "calc(100% - 20px)" }} />
        </div>
      )}

      {/* Stochastic Chart */}
      {indicators.has("stoch") && (
        <div className="h-20 border-t border-border">
          <div className="flex items-center gap-3 px-3 pt-1 text-[10px] text-muted-foreground">
            <span className="text-purple-400 font-semibold">STOCH</span>
            {lastStoch && (
              <>
                <span style={{ color: "#b46cff" }}>%K: {lastStoch.k?.toFixed(1) ?? "--"}</span>
                <span style={{ color: "#f5c542" }}>%D: {lastStoch.d?.toFixed(1) ?? "--"}</span>
                {lastStoch.k !== null && (
                  <span className={lastStoch.k > 80 ? "text-bear" : lastStoch.k < 20 ? "text-bull" : "text-muted-foreground"}>
                    {lastStoch.k > 80 ? "과매수" : lastStoch.k < 20 ? "과매도" : "중립"}
                  </span>
                )}
              </>
            )}
          </div>
          <div ref={stochContainerRef} className="w-full" style={{ height: "calc(100% - 20px)" }} />
        </div>
      )}
    </div>
  );
}
