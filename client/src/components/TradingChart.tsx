import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
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
  type Time,
} from "lightweight-charts";
import { trpc } from "@/lib/trpc";
import { useRealtimeQuote } from "@/hooks/useRealtime";
import { BarChart2, TrendingUp, Activity, Waves, GitBranch } from "lucide-react";

type Period = "D" | "W" | "M";
type Indicator = "ma" | "bb" | "volume" | "macd" | "stoch";

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
  bg: "oklch(0.16 0.01 240)",
  text: "oklch(0.55 0.01 240)",
  grid: "oklch(0.22 0.01 240)",
  border: "oklch(0.25 0.01 240)",
};

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

  const [period, setPeriod] = useState<Period>("D");
  const [indicators, setIndicators] = useState<Set<Indicator>>(new Set<Indicator>(["ma", "volume"]));
  const [crosshairData, setCrosshairData] = useState<{
    time?: string; open?: number; high?: number; low?: number; close?: number; volume?: number;
  }>({});

  const { data: ohlcv, isLoading } = trpc.kis.getOHLCV.useQuery(
    { stockCode, period },
    { enabled: !!stockCode, staleTime: 60_000 }
  );

  // Realtime tick: subscribe to live price via Socket.IO
  const { quote: realtimeQuote } = useRealtimeQuote(stockCode);

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
    setCrosshairData(prev => ({ ...prev, close: price, high: Math.max(high || price, price), low: Math.min(low || price, price) }));
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
    if (!chartContainerRef.current || !volumeContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      ...baseChartOptions,
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "oklch(0.62 0.18 145)",
      downColor: "oklch(0.58 0.22 25)",
      borderUpColor: "oklch(0.62 0.18 145)",
      borderDownColor: "oklch(0.58 0.22 25)",
      wickUpColor: "oklch(0.62 0.18 145)",
      wickDownColor: "oklch(0.58 0.22 25)",
    });
    candleSeriesRef.current = candleSeries;

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) return;
      const data = param.seriesData.get(candleSeries) as CandlestickData | undefined;
      if (data) {
        setCrosshairData({ time: String(param.time), open: data.open, high: data.high, low: data.low, close: data.close });
      }
    });

    const volChart = createChart(volumeContainerRef.current, {
      ...baseChartOptions,
      width: volumeContainerRef.current.clientWidth,
      height: volumeContainerRef.current.clientHeight,
      rightPriceScale: { ...baseChartOptions.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.0 }, mode: PriceScaleMode.Logarithmic },
      timeScale: { ...baseChartOptions.timeScale, visible: false },
    });
    volChartRef.current = volChart;

    const volSeries = volChart.addSeries(HistogramSeries, {
      color: "oklch(0.62 0.18 200 / 0.6)",
      priceFormat: { type: "volume" },
    });
    volSeriesRef.current = volSeries;

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
      maSeriesRefs.current.clear(); bbSeriesRefs.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize MACD chart
  useEffect(() => {
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
  }, [indicators.has("macd")]);

  // Initialize Stochastic chart
  useEffect(() => {
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
  }, [indicators.has("stoch")]);

  // Update data
  useEffect(() => {
    if (!ohlcv || !candleSeriesRef.current || !volSeriesRef.current || !chartRef.current) return;

    const times = ohlcv.map((d) => `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}` as Time);
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
      color: d.close >= (i > 0 ? ohlcv[i - 1].close : d.close) ? "oklch(0.62 0.18 145 / 0.6)" : "oklch(0.58 0.22 25 / 0.6)",
    }));
    volSeriesRef.current.setData(volData);

    // Remove old MA/BB series
    maSeriesRefs.current.forEach((s) => chartRef.current?.removeSeries(s));
    maSeriesRefs.current.clear();
    bbSeriesRefs.current.forEach((s) => chartRef.current?.removeSeries(s));
    bbSeriesRefs.current.clear();

    // Moving Averages
    if (indicators.has("ma")) {
      const maConfigs = [
        { period: 5, color: "oklch(0.75 0.18 60)" },
        { period: 20, color: "oklch(0.62 0.18 200)" },
        { period: 60, color: "oklch(0.72 0.18 300)" },
        { period: 120, color: "oklch(0.65 0.18 30)" },
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
      const bbColor = "oklch(0.72 0.12 240 / 0.7)";
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
        color: (macdValues[i].histogram ?? 0) >= 0 ? "oklch(0.62 0.18 145 / 0.7)" : "oklch(0.58 0.22 25 / 0.7)",
      })).filter((_, i) => macdValues[i].histogram !== null);

      const macdLineSeries = macdChartRef.current.addSeries(LineSeries, { color: "oklch(0.62 0.18 200)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      macdLineSeries.setData(macdLine);
      macdSeriesRefs.current.set("macd", macdLineSeries);

      const signalSeries = macdChartRef.current.addSeries(LineSeries, { color: "oklch(0.75 0.18 30)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
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

      const kSeries = stochChartRef.current.addSeries(LineSeries, { color: "oklch(0.72 0.18 300)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      kSeries.setData(kData);
      stochSeriesRefs.current.set("k", kSeries);

      const dSeries = stochChartRef.current.addSeries(LineSeries, { color: "oklch(0.75 0.18 60)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      dSeries.setData(dData);
      stochSeriesRefs.current.set("d", dSeries);

      stochChartRef.current.timeScale().fitContent();
    }

    chartRef.current.timeScale().fitContent();
  }, [ohlcv, indicators]);

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
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-3">
          <div>
            <span className="font-semibold text-sm">{stockName}</span>
            <span className="text-muted-foreground text-xs ml-2">{stockCode}</span>
          </div>
          {displayData.close && (
            <div className="flex items-center gap-3 font-mono text-xs">
              <span className={`text-base font-bold ${isUp ? "text-bull" : "text-bear"}`}>
                {displayData.close.toLocaleString()}
              </span>
              <span className="text-muted-foreground">
                O:{displayData.open?.toLocaleString()} H:{displayData.high?.toLocaleString()} L:{displayData.low?.toLocaleString()}
              </span>
              {displayData.volume && (
                <span className="text-muted-foreground">V:{(displayData.volume / 1000).toFixed(0)}K</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex gap-0.5 bg-secondary rounded p-0.5">
            {(["D", "W", "M"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "D" ? "일" : p === "W" ? "주" : "월"}
              </button>
            ))}
          </div>

          {/* Indicator toggles */}
          <div className="flex gap-0.5 flex-wrap">
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
                className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1 ${
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
            { period: 5, color: "oklch(0.75 0.18 60)" },
            { period: 20, color: "oklch(0.62 0.18 200)" },
            { period: 60, color: "oklch(0.72 0.18 300)" },
            { period: 120, color: "oklch(0.65 0.18 30)" },
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

      {/* Main Chart */}
      <div className="flex-1 relative min-h-0">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <div className="text-muted-foreground text-xs">차트 로딩 중...</div>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>

      {/* Volume Chart */}
      {indicators.has("volume") && (
        <div className="h-16 border-t border-border">
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
                <span style={{ color: "oklch(0.62 0.18 200)" }}>MACD: {lastMacd.macd?.toFixed(2) ?? "--"}</span>
                <span style={{ color: "oklch(0.75 0.18 30)" }}>Signal: {lastMacd.signal?.toFixed(2) ?? "--"}</span>
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
                <span style={{ color: "oklch(0.72 0.18 300)" }}>%K: {lastStoch.k?.toFixed(1) ?? "--"}</span>
                <span style={{ color: "oklch(0.75 0.18 60)" }}>%D: {lastStoch.d?.toFixed(1) ?? "--"}</span>
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
