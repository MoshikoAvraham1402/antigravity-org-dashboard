import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Clock } from 'lucide-react';
import { escapeHtml, formatCompactNumber, formatCurrency, formatFullNumber } from '../utils/formatters';

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

export default function ActivityHeatmap({
  heatmap = [],
  timezone = 'UTC',
  darkMode,
  loading,
}) {
  const [metric, setMetric] = useState('requests'); // 'requests' | 'total_tokens'

  const { matrixData, maxVal, peakSlot } = useMemo(() => {
    const lookup = new Map();
    let best = null;
    for (const row of heatmap) {
      // BigQuery EXTRACT(DAYOFWEEK) returns 1=Sun .. 7=Sat
      const dIdx = Math.max(0, Math.min(6, Number(row.dow || 1) - 1));
      const hIdx = Math.max(0, Math.min(23, Number(row.hour_of_day || 0)));
      const val = Number(row[metric] || 0);
      lookup.set(`${dIdx}:${hIdx}`, row);
      if (!best || val > Number(best[metric] || 0)) {
        best = { ...row, dayLabel: DAYS_SHORT[dIdx], hourLabel: HOURS_LABELS[hIdx] };
      }
    }

    const pts = [];
    let hi = 1;
    // Display Sun at top (y=6) down to Sat at bottom (y=0) for natural reading order
    for (let dIdx = 0; dIdx < 7; dIdx += 1) {
      const yIdx = 6 - dIdx;
      for (let hIdx = 0; hIdx < 24; hIdx += 1) {
        const rec = lookup.get(`${dIdx}:${hIdx}`);
        const val = rec ? Number(rec[metric] || 0) : 0;
        if (val > hi) hi = val;
        pts.push({
          value: [hIdx, yIdx, val],
          raw: rec || { requests: 0, total_tokens: 0, active_users: 0, estimated_cost_usd: 0 },
          dayName: DAYS_SHORT[dIdx],
          hourLabel: HOURS_LABELS[hIdx],
        });
      }
    }

    return { matrixData: pts, maxVal: hi, peakSlot: best };
  }, [heatmap, metric]);

  const option = useMemo(() => {
    const axisColor = darkMode ? '#a1a1aa' : '#64748b';
    const emptyCell = darkMode ? '#141418' : '#f4f4f5';
    const colorStops = darkMode
      ? [emptyCell, '#172554', '#1d4ed8', '#3b82f6', '#38bdf8']
      : [emptyCell, '#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8'];

    return {
      tooltip: {
        position: 'top',
        backgroundColor: darkMode ? 'rgba(12, 12, 15, 0.96)' : 'rgba(255, 255, 255, 0.98)',
        borderColor: darkMode ? '#27272a' : '#e2e8f0',
        borderWidth: 1,
        textStyle: {
          color: darkMode ? '#fafafa' : '#0f172a',
          fontFamily: '"DM Sans", sans-serif',
          fontSize: 12,
        },
        formatter: (p) => {
          const d = p.data;
          if (!d) return '';
          return `
            <div style="font-weight:700;margin-bottom:4px">${escapeHtml(d.dayName)} · ${escapeHtml(d.hourLabel)}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.5">
              Turns: <b>${formatFullNumber(d.raw.requests)}</b><br/>
              Tokens: <b>${formatCompactNumber(d.raw.total_tokens)}</b><br/>
              Active Engineers: <b>${Number(d.raw.active_users || 0)}</b> · Est: <b>${formatCurrency(d.raw.estimated_cost_usd)}</b>
            </div>
          `;
        },
      },
      grid: { left: 42, right: 12, top: 10, bottom: 30 },
      xAxis: {
        type: 'category',
        data: HOURS_LABELS,
        splitArea: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: axisColor,
          fontSize: 10,
          fontFamily: '"JetBrains Mono", monospace',
          interval: 3,
          formatter: (v) => v.slice(0, 2) + 'h',
        },
      },
      yAxis: {
        type: 'category',
        data: [...DAYS_SHORT].reverse(),
        splitArea: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: axisColor,
          fontSize: 11,
          fontWeight: 600,
        },
      },
      visualMap: {
        min: 0,
        max: maxVal,
        show: false,
        inRange: {
          color: colorStops,
        },
      },
      series: [
        {
          name: 'Engineering Rhythm',
          type: 'heatmap',
          data: matrixData,
          itemStyle: {
            borderRadius: 3,
            borderWidth: 2,
            borderColor: darkMode ? '#0c0c0f' : '#ffffff',
          },
          emphasis: {
            itemStyle: {
              borderColor: darkMode ? '#fafafa' : '#09090b',
              borderWidth: 1.5,
            },
          },
        },
      ],
    };
  }, [matrixData, maxVal, darkMode]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800/90 rounded-[12px] p-5 h-[360px] animate-pulse" />
    );
  }

  return (
    <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-5 shadow-sm flex flex-col justify-between h-full">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            7×24 Engineering Activity Rhythm
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 mt-0.5">
            <Clock className="w-3 h-3 text-blue-500" />
            <span>Hourly intensity ({timezone})</span>
            {peakSlot && (
              <>
                <span>·</span>
                <span>
                  Peak:{' '}
                  <strong className="font-mono text-zinc-800 dark:text-zinc-200">
                    {peakSlot.dayLabel} {peakSlot.hourLabel}
                  </strong>
                </span>
              </>
            )}
          </p>
        </div>

        <div className="inline-flex bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-0.5 rounded-[7px]">
          <button
            type="button"
            onClick={() => setMetric('requests')}
            className={`px-2.5 py-1 rounded-[5px] text-[11px] font-semibold transition-colors ${
              metric === 'requests'
                ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            Turns
          </button>
          <button
            type="button"
            onClick={() => setMetric('total_tokens')}
            className={`px-2.5 py-1 rounded-[5px] text-[11px] font-semibold transition-colors ${
              metric === 'total_tokens'
                ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            Tokens
          </button>
        </div>
      </div>

      <ReactECharts option={option} style={{ height: '245px', width: '100%' }} notMerge />

      <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800/70 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
        <span>Hover any hour block for engineer concurrency &amp; spend</span>
        <div className="flex items-center gap-1.5 font-mono text-[10px]">
          <span>Low</span>
          <span className="w-2.5 h-2.5 rounded-[2px] bg-zinc-200 dark:bg-[#141418]" />
          <span className="w-2.5 h-2.5 rounded-[2px] bg-blue-200 dark:bg-[#172554]" />
          <span className="w-2.5 h-2.5 rounded-[2px] bg-blue-400 dark:bg-[#1d4ed8]" />
          <span className="w-2.5 h-2.5 rounded-[2px] bg-blue-600 dark:bg-[#38bdf8]" />
          <span>Peak</span>
        </div>
      </div>
    </div>
  );
}
