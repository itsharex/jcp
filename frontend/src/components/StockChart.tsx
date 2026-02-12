import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ZoomIn, ZoomOut, MoveHorizontal } from 'lucide-react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  Area
} from 'recharts';
import { KLineData, TimePeriod, Stock } from '../types';
import { useTheme } from '../contexts/ThemeContext';

interface StockChartProps {
  data: KLineData[];
  period: TimePeriod;
  onPeriodChange: (p: TimePeriod) => void;
  stock?: Stock;
}

// Custom shape for candlestick
const Candlestick = (props: any) => {
  const { x, y, width, height, low, high, open, close } = props;
  const isGrowing = close > open;
  const color = isGrowing ? '#ef4444' : '#22c55e';

  const unitHeight = height / (high - low);

  const bodyTop = y + (high - Math.max(open, close)) * unitHeight;
  const bodyBottom = y + (high - Math.min(open, close)) * unitHeight;
  const bodyLen = Math.max(2, bodyBottom - bodyTop);

  return (
    <g>
      <line x1={x + width / 2} y1={y} x2={x + width / 2} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={x} y={bodyTop} width={width} height={bodyLen} fill={color} stroke={color} />
    </g>
  );
};

export const StockChart: React.FC<StockChartProps> = ({ data, period, onPeriodChange, stock }) => {
  const { colors } = useTheme();
  const safeData = data || [];
  const [visibleCount, setVisibleCount] = useState(60);
  const [startIndex, setStartIndex] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverData, setHoverData] = useState<KLineData | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const lastX = useRef(0);
  const prevPeriod = useRef(period);

  const isIntraday = period === '1m';
  const preClose = stock?.preClose || 0;

  // 计算分时图的价格域（以昨收为中心对称）
  const intradayDomain = useMemo(() => {
    if (!isIntraday || safeData.length === 0 || preClose <= 0) return { min: 0, max: 0, range: 0 };

    const prices = safeData.flatMap(d => [d.high, d.low, d.close]);
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);

    // 计算相对昨收的最大偏离
    const maxDiff = Math.max(Math.abs(maxPrice - preClose), Math.abs(minPrice - preClose));
    // 增加10%的边距
    const range = maxDiff * 1.1;
    // 确保至少有0.5%的范围
    const minRange = preClose * 0.005;
    const finalRange = Math.max(range, minRange);

    return {
      min: preClose - finalRange,
      max: preClose + finalRange,
      range: finalRange
    };
  }, [isIntraday, safeData, preClose]);

  // 格式化涨跌幅
  const formatChangePercent = useCallback((price: number) => {
    if (preClose <= 0) return '0.00%';
    const percent = ((price - preClose) / preClose) * 100;
    const sign = percent >= 0 ? '+' : '';
    return `${sign}${percent.toFixed(2)}%`;
  }, [preClose]);

  // 格式化涨跌额
  const formatChange = useCallback((price: number) => {
    if (preClose <= 0) return '0.00';
    const change = price - preClose;
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}`;
  }, [preClose]);

  useEffect(() => {
    if (prevPeriod.current !== period) {
      prevPeriod.current = period;
      setVisibleCount(60);
      setStartIndex(0);
      return;
    }
    if (safeData.length > 0) {
      const newStart = Math.max(0, safeData.length - visibleCount);
      setStartIndex(newStart);
    }
  }, [safeData, period, visibleCount]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (isIntraday) return; // 分时图不支持缩放
    e.preventDefault();
    const delta = e.deltaY > 0 ? 10 : -10;
    setVisibleCount(prev => {
      const newCount = Math.max(20, Math.min(safeData.length, prev + delta));
      const newStart = Math.max(0, safeData.length - newCount);
      setStartIndex(newStart);
      return newCount;
    });
  }, [safeData.length, isIntraday]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isIntraday) return;
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    lastX.current = e.clientX;
  }, [isIntraday]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - lastX.current;
    const sensitivity = Math.max(1, Math.floor(visibleCount / 30));
    if (Math.abs(deltaX) > 10) {
      const move = deltaX > 0 ? -sensitivity : sensitivity;
      setStartIndex(prev => Math.max(0, Math.min(safeData.length - visibleCount, prev + move)));
      lastX.current = e.clientX;
    }
  }, [isDragging, safeData.length, visibleCount]);

  useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.body.classList.add('grabbing');
    } else {
      document.body.classList.remove('grabbing');
    }
    return () => document.body.classList.remove('grabbing');
  }, [isDragging]);

  if (safeData.length === 0) {
    return (
      <div className="h-full w-full fin-panel flex items-center justify-center">
        <span className={`text-sm animate-pulse ${colors.isDark ? 'text-slate-500' : 'text-slate-400'}`}>加载市场数据中...</span>
      </div>
    );
  }

  const visibleData = isIntraday ? safeData : safeData.slice(startIndex, startIndex + visibleCount);
  const lastVisible = visibleData[visibleData.length - 1];
  const displayData = hoverData || lastVisible;

  const chartData = visibleData.map(d => ({
    ...d,
    range: [d.low, d.high] as [number, number],
  }));

  // 计算当日统计数据
  const todayHigh = Math.max(...safeData.map(d => d.high));
  const todayLow = Math.min(...safeData.map(d => d.low));
  const totalVolume = safeData.reduce((sum, d) => sum + d.volume, 0);
  const currentPrice = stock?.price || lastVisible?.close || 0;
  const currentAvg = lastVisible?.avg || 0;

  const periods: { id: TimePeriod; label: string }[] = [
    { id: '1m', label: '分时' },
    { id: '1d', label: '日K' },
    { id: '1w', label: '周K' },
    { id: '1mo', label: '月K' },
  ];

  // 获取价格颜色
  const getPriceColor = (price: number) => {
    if (preClose <= 0) return colors.isDark ? 'text-slate-100' : 'text-slate-700';
    if (price > preClose) return 'text-red-500';
    if (price < preClose) return 'text-green-500';
    return colors.isDark ? 'text-slate-100' : 'text-slate-700';
  };

  // 主题相关颜色
  const gridColor = colors.isDark ? '#1e293b' : '#e2e8f0';
  const axisLineColor = colors.isDark ? '#334155' : '#cbd5e1';
  const tickColor = colors.isDark ? '#94a3b8' : '#64748b';
  const tooltipBg = colors.isDark ? '#0f172a' : '#ffffff';
  const tooltipBorder = colors.isDark ? '#1e293b' : '#e2e8f0';

  return (
    <div className="h-full w-full fin-panel flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b fin-divider fin-panel-strong z-10">
        <div className="flex gap-1">
          {periods.map((p) => (
            <button
              key={p.id}
              onClick={() => onPeriodChange(p.id)}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                period === p.id
                  ? (colors.isDark ? 'bg-slate-800/80' : 'bg-slate-200/80') + ' text-accent-2 font-bold'
                  : (colors.isDark ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/40')
              }`}
            >
              {p.label}
            </button>
          ))}
          {!isIntraday && (
            <div className={`flex items-center gap-2 ml-3 pl-3 border-l ${colors.isDark ? 'border-slate-700' : 'border-slate-300'}`}>
              <div className={`flex items-center gap-1 text-xs ${colors.isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                <ZoomIn size={12} />
                <ZoomOut size={12} />
                <span>滚轮</span>
              </div>
              <div className={`flex items-center gap-1 text-xs ${colors.isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                <MoveHorizontal size={12} />
                <span>拖拽</span>
              </div>
            </div>
          )}
        </div>

        {/* 数据信息栏 */}
        <div className={`text-xs font-mono flex gap-3 ${colors.isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          {isIntraday ? (
            <>
              <span>时间: <span className={colors.isDark ? 'text-slate-300' : 'text-slate-600'}>{displayData?.time || '--'}</span></span>
              <span>价格: <span className={getPriceColor(displayData?.close || 0)}>{displayData?.close?.toFixed(2) || '--'}</span></span>
              <span>均价: <span className="text-yellow-500">{displayData?.avg?.toFixed(2) || '--'}</span></span>
              <span>涨跌: <span className={getPriceColor(currentPrice)}>{formatChange(displayData?.close || preClose)}</span></span>
              <span>幅度: <span className={getPriceColor(currentPrice)}>{formatChangePercent(displayData?.close || preClose)}</span></span>
            </>
          ) : (
            <>
              <span>收: <span className="text-accent-2">{displayData?.close?.toFixed(2)}</span></span>
              <span>开: {displayData?.open?.toFixed(2)}</span>
              <span>高: <span className="text-red-400">{displayData?.high?.toFixed(2)}</span></span>
              <span>低: <span className="text-green-400">{displayData?.low?.toFixed(2)}</span></span>
              {displayData?.ma5 && (
                <>
                  <span>MA5: <span className="text-yellow-500">{displayData?.ma5?.toFixed(2)}</span></span>
                  <span>MA10: <span className="text-purple-500">{displayData?.ma10?.toFixed(2)}</span></span>
                  <span>MA20: <span className="text-orange-500">{displayData?.ma20?.toFixed(2)}</span></span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* 分时图专用信息栏 */}
      {isIntraday && (
        <div className={`flex items-center justify-between px-3 py-1.5 border-b fin-divider text-xs ${colors.isDark ? 'bg-slate-900/30' : 'bg-slate-100/50'}`}>
          <div className="flex gap-4">
            <span className={colors.isDark ? 'text-slate-500' : 'text-slate-400'}>最高: <span className="text-red-500">{todayHigh.toFixed(2)}</span></span>
            <span className={colors.isDark ? 'text-slate-500' : 'text-slate-400'}>最低: <span className="text-green-500">{todayLow.toFixed(2)}</span></span>
            <span className={colors.isDark ? 'text-slate-500' : 'text-slate-400'}>昨收: <span className={colors.isDark ? 'text-slate-300' : 'text-slate-600'}>{preClose.toFixed(2)}</span></span>
          </div>
          <div className="flex gap-4">
            <span className={colors.isDark ? 'text-slate-500' : 'text-slate-400'}>均价: <span className="text-yellow-500">{currentAvg.toFixed(2)}</span></span>
            <span className={colors.isDark ? 'text-slate-500' : 'text-slate-400'}>总量: <span className={colors.isDark ? 'text-slate-300' : 'text-slate-600'}>{(totalVolume / 100).toFixed(0)}手</span></span>
          </div>
        </div>
      )}

      {/* Chart Area */}
      <div
        ref={chartRef}
        className={`flex-1 min-h-0 relative transition-all duration-200 ${
          !isIntraday
            ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') + ' ' + (isHovering ? (colors.isDark ? 'ring-1 ring-slate-600/50 ring-inset bg-slate-800/20' : 'ring-1 ring-slate-300/50 ring-inset bg-slate-100/20') : '')
            : ''
        }`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => { setIsHovering(false); setHoverData(null); }}
      >
        {!isIntraday && isHovering && (
          <div className={`absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-3 py-1.5 rounded-full text-xs backdrop-blur-sm ${colors.isDark ? 'bg-slate-900/90 border border-slate-700/50 text-slate-400' : 'bg-white/90 border border-slate-300/50 text-slate-500'}`}>
            <span className="flex items-center gap-1">
              <ZoomIn size={12} className={colors.isDark ? 'text-slate-500' : 'text-slate-400'} />
              <ZoomOut size={12} className={colors.isDark ? 'text-slate-500' : 'text-slate-400'} />
              滚轮缩放
            </span>
            <span className={`w-px h-3 ${colors.isDark ? 'bg-slate-700' : 'bg-slate-300'}`} />
            <span className="flex items-center gap-1">
              <MoveHorizontal size={12} className={colors.isDark ? 'text-slate-500' : 'text-slate-400'} />
              拖拽滑动
            </span>
          </div>
        )}

        <ResponsiveContainer width="100%" height="100%">
          {isIntraday ? (
            <ComposedChart
              data={chartData}
              margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
              onMouseMove={(e: any) => {
                if (e?.activePayload?.[0]?.payload) {
                  setHoverData(e.activePayload[0].payload);
                }
              }}
              onMouseLeave={() => setHoverData(null)}
            >
              <defs>
                <linearGradient id="priceGradientUp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="priceGradientDown" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />

              {/* 昨收基准线 */}
              {preClose > 0 && (
                <ReferenceLine
                  yAxisId="price"
                  y={preClose}
                  stroke={colors.isDark ? '#64748b' : '#94a3b8'}
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  label={{
                    value: `昨收 ${preClose.toFixed(2)}`,
                    position: 'insideTopRight',
                    fill: colors.isDark ? '#64748b' : '#64748b',
                    fontSize: 10
                  }}
                />
              )}

              <XAxis
                dataKey="time"
                tick={{ fill: tickColor, fontSize: 10 }}
                axisLine={{ stroke: axisLineColor }}
                tickLine={false}
                minTickGap={50}
                interval="preserveStartEnd"
                tickFormatter={(value) => {
                  // 只显示整点时间
                  if (value.endsWith(':00')) return value;
                  if (value === '09:30' || value === '11:30' || value === '13:00' || value === '15:00') return value;
                  return '';
                }}
              />

              {/* 左侧价格轴 */}
              <YAxis
                yAxisId="price"
                domain={[intradayDomain.min, intradayDomain.max]}
                orientation="left"
                tick={{ fill: tickColor, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => val.toFixed(2)}
                tickCount={7}
                width={50}
              />

              {/* 右侧涨跌幅轴 */}
              <YAxis
                yAxisId="percent"
                domain={[intradayDomain.min, intradayDomain.max]}
                orientation="right"
                tick={({ x, y, payload }) => {
                  const percent = preClose > 0 ? ((payload.value - preClose) / preClose) * 100 : 0;
                  const color = percent > 0 ? '#ef4444' : percent < 0 ? '#22c55e' : tickColor;
                  const sign = percent > 0 ? '+' : '';
                  return (
                    <text x={x} y={y} fill={color} fontSize={10} textAnchor="start" dominantBaseline="middle">
                      {`${sign}${percent.toFixed(2)}%`}
                    </text>
                  );
                }}
                axisLine={false}
                tickLine={false}
                tickCount={7}
                width={50}
              />

              <Tooltip
                active={!isDragging}
                content={() => null} // 使用顶部信息栏显示
              />

              {/* 价格区域填充 */}
              <Area
                yAxisId="price"
                type="linear"
                dataKey="close"
                stroke="none"
                fill={currentPrice >= preClose ? "url(#priceGradientUp)" : "url(#priceGradientDown)"}
                isAnimationActive={false}
                baseLine={preClose}
              />

              {/* 价格线 */}
              <Line
                yAxisId="price"
                type="linear"
                dataKey="close"
                stroke="#38bdf8"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                name="价格"
              />

              {/* 均价线 */}
              <Line
                yAxisId="price"
                type="linear"
                dataKey="avg"
                stroke="#facc15"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
                name="均价"
              />
            </ComposedChart>
          ) : (
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: tickColor, fontSize: 10 }}
                axisLine={{ stroke: axisLineColor }}
                tickLine={false}
                minTickGap={30}
              />
              <YAxis
                domain={['auto', 'auto']}
                orientation="right"
                tick={{ fill: tickColor, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => val.toFixed(1)}
              />
              <Tooltip
                active={!isDragging}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const d = payload[0]?.payload;
                  if (!d) return null;
                  return (
                    <div style={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, padding: '8px 12px', borderRadius: '4px' }}>
                      <div style={{ color: tickColor, marginBottom: '4px' }}>{d.time}</div>
                      <div style={{ color: colors.isDark ? '#e2e8f0' : '#334155' }}>开: {d.open?.toFixed(2)}</div>
                      <div style={{ color: '#ef4444' }}>高: {d.high?.toFixed(2)}</div>
                      <div style={{ color: '#22c55e' }}>低: {d.low?.toFixed(2)}</div>
                      <div style={{ color: '#38bdf8' }}>收: {d.close?.toFixed(2)}</div>
                      {d.ma5 && <div style={{ color: '#facc15' }}>MA5: {d.ma5?.toFixed(2)}</div>}
                      {d.ma10 && <div style={{ color: '#a855f7' }}>MA10: {d.ma10?.toFixed(2)}</div>}
                      {d.ma20 && <div style={{ color: '#f97316' }}>MA20: {d.ma20?.toFixed(2)}</div>}
                    </div>
                  );
                }}
              />
              <Bar dataKey="range" shape={<Candlestick />} isAnimationActive={false}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.close > entry.open ? '#ef4444' : '#22c55e'} />
                ))}
              </Bar>
              <Line type="linear" dataKey="ma5" stroke="#facc15" strokeWidth={1} dot={false} isAnimationActive={false} name="MA5" />
              <Line type="linear" dataKey="ma10" stroke="#a855f7" strokeWidth={1} dot={false} isAnimationActive={false} name="MA10" />
              <Line type="linear" dataKey="ma20" stroke="#f97316" strokeWidth={1} dot={false} isAnimationActive={false} name="MA20" />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Volume Chart */}
      <div className={`${isIntraday ? 'h-20' : 'h-16'} border-t fin-divider`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 5, right: 0, left: 0, bottom: 0 }}
            onMouseMove={(e: any) => {
              if (e?.activePayload?.[0]?.payload) {
                setHoverData(e.activePayload[0].payload);
              }
            }}
            onMouseLeave={() => setHoverData(null)}
          >
            {isIntraday && (
              <XAxis
                dataKey="time"
                tick={{ fill: tickColor, fontSize: 9 }}
                axisLine={{ stroke: axisLineColor }}
                tickLine={false}
                minTickGap={50}
                interval="preserveStartEnd"
                tickFormatter={(value) => {
                  if (value === '09:30' || value === '11:30' || value === '13:00' || value === '15:00') return value;
                  if (value.endsWith(':00')) return value;
                  return '';
                }}
              />
            )}
            {/* 左侧占位轴，与价格图对齐 */}
            {isIntraday && (
              <YAxis
                yAxisId="left"
                orientation="left"
                tick={{ fill: 'transparent', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={50}
              />
            )}
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: colors.isDark ? '#64748b' : '#94a3b8', fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(val) => {
                if (val >= 10000) return (val / 10000).toFixed(0) + '万';
                return val.toString();
              }}
              width={50}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0]?.payload;
                if (!d) return null;
                const vol = d.volume || 0;
                const volStr = vol >= 100000000
                  ? (vol / 100000000).toFixed(2) + '亿'
                  : vol >= 10000
                    ? (vol / 10000).toFixed(2) + '万'
                    : vol.toString();
                return (
                  <div style={{
                    backgroundColor: tooltipBg,
                    border: `1px solid ${tooltipBorder}`,
                    padding: '6px 10px',
                    borderRadius: '4px',
                    fontSize: '11px'
                  }}>
                    <div style={{ color: tickColor, marginBottom: '2px' }}>{d.time}</div>
                    <div style={{ color: '#38bdf8' }}>成交量: {volStr}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="volume" yAxisId="right" isAnimationActive={false}>
              {chartData.map((entry, index) => {
                // 分时图：价格高于均价为红，低于均价为绿
                // K线图：收盘高于开盘为红，低于开盘为绿
                let isUp: boolean;
                if (isIntraday) {
                  isUp = entry.close >= (entry.avg || entry.close);
                } else {
                  isUp = entry.close >= entry.open;
                }
                return (
                  <Cell
                    key={`vol-${index}`}
                    fill={isUp ? '#ef4444' : '#22c55e'}
                    opacity={0.6}
                  />
                );
              })}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
