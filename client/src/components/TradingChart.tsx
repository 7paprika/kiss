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
import { BarChart2, TrendingUp, Activity } from "lucide-react";

type Period = "D" | "W" | "M";
type Indicator = "ma" | "bb" | "volume";

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

export default function TradingChart({ stockCode, stockName }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const volChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maSeriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const bbSeriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  const [period, setPeriod] = useState<Period>("D");
  const [indicators, setIndicators] = useState<Set<Indicator>>(new Set<Indicator>(["ma", "volume"]));
  const [crosshairData, setCrosshairData] = useState<{
    time?: string; open?: number; high?: number; low?: number; close?: number; volume?: number;
  }>({});

  const { data: ohlcv, isLoading } = trpc.kis.getOHLCV.useQuery(
    { stockCode, period },
    { enabled: !!stockCode, staleTime: 60_000 }
  );

  const toggleIndicator = useCallback((ind: Indicator) => {
    setIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(ind)) next.delete(ind); else next.add(ind);
      return next;
    });
  }, []);

  // Initialize charts
  useEffect(() => {
    if (!chartContainerRef.current || !volumeContainerRef.current) return;

    const chartOptions = {
      layout: {
        background: { type: ColorType.Solid, color: "oklch(0.16 0.01 240)" },
        textColor: "oklch(0.55 0.01 240)",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "oklch(0.22 0.01 240)" },
        horzLines: { color: "oklch(0.22 0.01 240)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "oklch(0.25 0.01 240)",
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: {
        borderColor: "oklch(0.25 0.01 240)",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    };

    // Main chart
    const chart = createChart(chartContainerRef.current, {
      ...chartOptions,
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

    // Crosshair handler
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) return;
      const data = param.seriesData.get(candleSeries) as CandlestickData | undefined;
      if (data) {
        setCrosshairData({
          time: String(param.time),
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
        });
      }
    });

    // Volume chart
    const volChart = createChart(volumeContainerRef.current, {
      ...chartOptions,
      width: volumeContainerRef.current.clientWidth,
      height: volumeContainerRef.current.clientHeight,
      rightPriceScale: {
        ...chartOptions.rightPriceScale,
        scaleMargins: { top: 0.1, bottom: 0.0 },
        mode: PriceScaleMode.Logarithmic,
      },
      timeScale: { ...chartOptions.timeScale, visible: false },
    });
    volChartRef.current = volChart;

    const volSeries = volChart.addSeries(HistogramSeries, {
      color: "oklch(0.62 0.18 200 / 0.6)",
      priceFormat: { type: "volume" },
    });
    volSeriesRef.current = volSeries;

    // Sync time scales
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) volChart.timeScale().setVisibleLogicalRange(range);
    });
    volChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) chart.timeScale().setVisibleLogicalRange(range);
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight });
      }
      if (volumeContainerRef.current) {
        volChart.applyOptions({ width: volumeContainerRef.current.clientWidth, height: volumeContainerRef.current.clientHeight });
      }
    });
    if (chartContainerRef.current) ro.observe(chartContainerRef.current);
    if (volumeContainerRef.current) ro.observe(volumeContainerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      volChart.remove();
      chartRef.current = null;
      volChartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      maSeriesRefs.current.clear();
      bbSeriesRefs.current.clear();
    };
  }, []);

  // Update data when ohlcv changes
  useEffect(() => {
    if (!ohlcv || !candleSeriesRef.current || !volSeriesRef.current || !chartRef.current) return;

    const candleData: CandlestickData[] = ohlcv.map((d) => ({
      time: `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}` as Time,
      open: d.open, high: d.high, low: d.low, close: d.close,
    }));

    const volData: HistogramData[] = ohlcv.map((d, i) => ({
      time: `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}` as Time,
      value: d.volume,
      color: d.close >= (i > 0 ? ohlcv[i - 1].close : d.close)
        ? "oklch(0.62 0.18 145 / 0.6)"
        : "oklch(0.58 0.22 25 / 0.6)",
    }));

    candleSeriesRef.current.setData(candleData);
    volSeriesRef.current.setData(volData);

    // Remove existing MA/BB series
    maSeriesRefs.current.forEach((s) => chartRef.current?.removeSeries(s));
    maSeriesRefs.current.clear();
    bbSeriesRefs.current.forEach((s) => chartRef.current?.removeSeries(s));
    bbSeriesRefs.current.clear();

    const closes = ohlcv.map((d) => d.close);
    const times = ohlcv.map((d) => `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}` as Time);

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
        const maData: LineData[] = times
          .map((t, i) => ({ time: t, value: maValues[i] }))
          .filter((d): d is LineData => d.value !== null);
        const series = chartRef.current.addSeries(LineSeries, {
          color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        });
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
        { key: "bb-upper", data: upperData, style: "dashed" as const },
        { key: "bb-middle", data: middleData, style: "dotted" as const },
        { key: "bb-lower", data: lowerData, style: "dashed" as const },
      ].forEach(({ key, data, style }) => {
        const s = chartRef.current!.addSeries(LineSeries, {
          color: bbColor, lineWidth: 1, lineStyle: style === "dashed" ? 1 : 2,
          priceLineVisible: false, lastValueVisible: false,
        });
        s.setData(data);
        bbSeriesRefs.current.set(key, s);
      });
    }

    chartRef.current.timeScale().fitContent();
  }, [ohlcv, indicators]);

  const last = ohlcv?.[ohlcv.length - 1];
  const prev = ohlcv?.[ohlcv.length - 2];
  const displayData = crosshairData.close ? crosshairData : last ? {
    time: last.date, open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume,
  } : {};

  const isUp = displayData.close && prev ? displayData.close >= prev.close : true;

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
                <span className="text-muted-foreground">
                  V:{(displayData.volume / 1000).toFixed(0)}K
                </span>
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
          <div className="flex gap-0.5">
            <button
              onClick={() => toggleIndicator("ma")}
              className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1 ${
                indicators.has("ma") ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" : "text-muted-foreground hover:text-foreground"
              }`}
              title="이동평균선"
            >
              <TrendingUp size={10} />MA
            </button>
            <button
              onClick={() => toggleIndicator("bb")}
              className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1 ${
                indicators.has("bb") ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "text-muted-foreground hover:text-foreground"
              }`}
              title="볼린저밴드"
            >
              <Activity size={10} />BB
            </button>
            <button
              onClick={() => toggleIndicator("volume")}
              className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1 ${
                indicators.has("volume") ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
              }`}
              title="거래량"
            >
              <BarChart2 size={10} />VOL
            </button>
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
            const closes = ohlcv?.map(d => d.close) || [];
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
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <div className="text-muted-foreground text-xs">차트 로딩 중...</div>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>

      {/* Volume Chart */}
      {indicators.has("volume") && (
        <div className="h-20 border-t border-border">
          <div ref={volumeContainerRef} className="w-full h-full" />
        </div>
      )}
    </div>
  );
}
