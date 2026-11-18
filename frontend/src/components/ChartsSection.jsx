import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Filter } from 'lucide-react';
import ActivityHeatmap from './ActivityHeatmap';
import MetricTooltip from './MetricTooltip';
import {
  escapeHtml,
  formatCompactNumber,
  formatCurrency,
  formatFullNumber,
  formatShortDate,
  formatReadableDate,
} from '../utils/formatters';

export default function ChartsSection({
  dailySeries = [],
  modelBreakdown = [],
  effortBreakdown = [],
  surfaceBreakdown = [],
  projectBreakdown = [],
  heatmap = [],
  timezone = 'UTC',
  activeFilters = {},
  onCrossFilter,
  darkMode,
  loading,
}) {
  const [streamMode, setStreamMode] = useState('tokens'); // 'tokens' | 'finops' | 'quota'
  const [dimTab, setDimTab] = useState('model'); // 'model' | 'project' | 'effort' | 'surface'

  const themeTokens = useMemo(
    () => ({
      axisColor: darkMode ? '#a1a1aa' : '#64748b',
      gridBorder: darkMode ? '#1f1f26' : '#f1f5f9',
      tooltipBg: darkMode ? 'rgba(12, 12, 15, 0.96)' : 'rgba(255, 255, 255, 0.98)',
      tooltipBorder: darkMode ? '#27272a' : '#e2e8f0',
      tooltipText: darkMode ? '#fafafa' : '#0f172a',
    }),
    [darkMode]
  );

  const dates = useMemo(() => dailySeries.map((d) => formatShortDate(d.date)), [dailySeries]);

  const adoptionVelocityOption = useMemo(
    () => ({
      color: ['#3b82f6', '#10b981', '#8b5cf6'],
      tooltip: {
        trigger: 'axis',
        backgroundColor: themeTokens.tooltipBg,
        borderColor: themeTokens.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: themeTokens.tooltipText, fontFamily: '"DM Sans", sans-serif', fontSize: 12 },
        formatter: (params) => {
          if (!params?.length) return '';
          const idx = params[0].dataIndex;
          const pt = dailySeries[idx] || {};
          return `
            <div style="font-weight:700;margin-bottom:6px">${escapeHtml(formatReadableDate(pt.date))}</div>
            <div style="display:flex;flex-direction:column;gap:3px;font-family:'JetBrains Mono',monospace;font-size:11px">
              <span><span style="color:#3b82f6">●</span> DAU: <b>${Number(pt.dau || 0)}</b> · 7d WAU: <b>${Number(pt.wau_7d || 0)}</b> (${Number(pt.stickiness_pct || 0)}%)</span>
              <span><span style="color:#8b5cf6">●</span> Agent Turns: <b>${formatFullNumber(pt.requests)}</b> (${Number(pt.sessions || 0)} trajectories)</span>
              <span><span style="color:#10b981">●</span> Tool Calls: <b>${formatFullNumber(pt.tool_calls)}</b> · Est: <b>${formatCurrency(pt.estimated_cost_usd)}</b></span>
            </div>
          `;
        },
      },
      legend: {
        top: 0,
        left: 0,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: themeTokens.axisColor, fontSize: 11 },
      },
      grid: { left: 40, right: 48, top: 48, bottom: 26 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: themeTokens.gridBorder } },
        axisTick: { show: false },
        axisLabel: { color: themeTokens.axisColor, fontSize: 11 },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Users',
          minInterval: 1,
          nameTextStyle: { color: themeTokens.axisColor, fontSize: 10 },
          splitLine: { lineStyle: { color: themeTokens.gridBorder, type: 'dashed' } },
          axisLabel: { color: themeTokens.axisColor, fontSize: 11, fontFamily: '"JetBrains Mono", monospace' },
        },
        {
          type: 'value',
          name: 'Turns',
          nameTextStyle: { color: themeTokens.axisColor, fontSize: 10 },
          splitLine: { show: false },
          axisLabel: {
            color: themeTokens.axisColor,
            fontSize: 11,
            fontFamily: '"JetBrains Mono", monospace',
            formatter: (v) => formatCompactNumber(v),
          },
        },
      ],
      series: [
        {
          name: 'Daily Active (DAU)',
          type: 'bar',
          yAxisIndex: 0,
          barMaxWidth: 16,
          itemStyle: { borderRadius: [4, 4, 0, 0], color: '#3b82f6' },
          data: dailySeries.map((d) => d.dau),
        },
        {
          name: '7d Rolling WAU',
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#10b981' },
          data: dailySeries.map((d) => d.wau_7d),
        },
        {
          name: 'Agent Turns',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2.5, color: '#8b5cf6' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(139, 92, 246, 0.24)' },
                { offset: 1, color: 'rgba(139, 92, 246, 0.01)' },
              ],
            },
          },
          data: dailySeries.map((d) => d.requests),
        },
      ],
    }),
    [dailySeries, dates, themeTokens]
  );

  const streamChartOption = useMemo(() => {
    if (streamMode === 'finops') {
      return {
        color: ['#f43f5e', '#10b981'],
        tooltip: {
          trigger: 'axis',
          backgroundColor: themeTokens.tooltipBg,
          borderColor: themeTokens.tooltipBorder,
          borderWidth: 1,
          textStyle: { color: themeTokens.tooltipText, fontSize: 12 },
          formatter: (params) => {
            if (!params?.length) return '';
            const pt = dailySeries[params[0].dataIndex] || {};
            return `
              <div style="font-weight:700;margin-bottom:5px">${escapeHtml(formatReadableDate(pt.date))}</div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.6">
                <span style="color:#f43f5e">●</span> Actual Token Spend: <b>${formatCurrency(pt.estimated_cost_usd)}</b><br/>
                <span style="color:#10b981">●</span> Avoided via Prompt Cache: <b>${formatCurrency(pt.cache_savings_usd)}</b><br/>
                Cache Hit Rate: <b>${Number(pt.cache_hit_rate_pct || 0)}%</b>
              </div>
            `;
          },
        },
        legend: {
          top: 0,
          right: 0,
          icon: 'roundRect',
          itemWidth: 10,
          itemHeight: 8,
          textStyle: { color: themeTokens.axisColor, fontSize: 11 },
        },
        grid: { left: 54, right: 16, top: 36, bottom: 26 },
        xAxis: {
          type: 'category',
          data: dates,
          axisLine: { lineStyle: { color: themeTokens.gridBorder } },
          axisTick: { show: false },
          axisLabel: { color: themeTokens.axisColor, fontSize: 11 },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: themeTokens.gridBorder, type: 'dashed' } },
          axisLabel: {
            color: themeTokens.axisColor,
            fontSize: 11,
            fontFamily: '"JetBrains Mono", monospace',
            formatter: (v) => `$${formatCompactNumber(v)}`,
          },
        },
        series: [
          {
            name: 'Actual Token Spend ($)',
            type: 'bar',
            barMaxWidth: 14,
            itemStyle: { color: '#f43f5e', borderRadius: [3, 3, 0, 0] },
            data: dailySeries.map((d) => d.estimated_cost_usd),
          },
          {
            name: 'Cache Savings Avoided ($)',
            type: 'bar',
            barMaxWidth: 14,
            itemStyle: { color: '#10b981', borderRadius: [3, 3, 0, 0] },
            data: dailySeries.map((d) => d.cache_savings_usd),
          },
        ],
      };
    }

    if (streamMode === 'quota') {
      return {
        color: ['#10b981', '#f59e0b'],
        tooltip: {
          trigger: 'axis',
          backgroundColor: themeTokens.tooltipBg,
          borderColor: themeTokens.tooltipBorder,
          borderWidth: 1,
          textStyle: { color: themeTokens.tooltipText, fontSize: 12 },
          formatter: (params) => {
            if (!params?.length) return '';
            const pt = dailySeries[params[0].dataIndex] || {};
            const tot = Math.max(1, Number(pt.requests || 0));
            const ovPct = Math.round((Number(pt.overage_requests || 0) / tot) * 100);
            return `
              <div style="font-weight:700;margin-bottom:5px">${escapeHtml(formatReadableDate(pt.date))}</div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.6">
                <span style="color:#10b981">●</span> Included Subscription Turns: <b>${formatFullNumber(pt.regular_requests)}</b><br/>
                <span style="color:#f59e0b">●</span> Overage Pay-As-You-Go Turns: <b>${formatFullNumber(pt.overage_requests)}</b> (${ovPct}%)<br/>
                Turns &gt;200K Context: <b>${formatFullNumber(pt.long_context_turns)}</b>
              </div>
              <div style="margin-top:5px;font-size:10px;color:#3b82f6">Click bar series to filter by quota tier</div>
            `;
          },
        },
        legend: {
          top: 0,
          right: 0,
          icon: 'roundRect',
          itemWidth: 10,
          itemHeight: 8,
          textStyle: { color: themeTokens.axisColor, fontSize: 11 },
        },
        grid: { left: 48, right: 16, top: 36, bottom: 26 },
        xAxis: {
          type: 'category',
          data: dates,
          axisLine: { lineStyle: { color: themeTokens.gridBorder } },
          axisTick: { show: false },
          axisLabel: { color: themeTokens.axisColor, fontSize: 11 },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: themeTokens.gridBorder, type: 'dashed' } },
          axisLabel: {
            color: themeTokens.axisColor,
            fontSize: 11,
            fontFamily: '"JetBrains Mono", monospace',
            formatter: (v) => formatCompactNumber(v),
          },
        },
        series: [
          {
            name: 'Included Subscription',
            type: 'bar',
            stack: 'quota',
            barMaxWidth: 18,
            cursor: 'pointer',
            itemStyle: { color: '#10b981' },
            data: dailySeries.map((d) => d.regular_requests),
          },
          {
            name: 'Overage (Pay-As-You-Go)',
            type: 'bar',
            stack: 'quota',
            barMaxWidth: 18,
            cursor: 'pointer',
            itemStyle: { color: '#f59e0b', borderRadius: [3, 3, 0, 0] },
            data: dailySeries.map((d) => d.overage_requests),
          },
        ],
      };
    }

    return {
      color: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6'],
      tooltip: {
        trigger: 'axis',
        backgroundColor: themeTokens.tooltipBg,
        borderColor: themeTokens.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: themeTokens.tooltipText, fontSize: 12 },
        formatter: (params) => {
          if (!params?.length) return '';
          const idx = params[0].dataIndex;
          const pt = dailySeries[idx] || {};
          const lines = params
            .map(
              (s) =>
                `<div style="display:flex;justify-content:space-between;gap:16px">
                  <span>${s.marker} ${escapeHtml(s.seriesName)}</span>
                  <span style="font-family:'JetBrains Mono',monospace;font-weight:600">${formatCompactNumber(s.value)}</span>
                </div>`
            )
            .join('');
          return `
            <div style="font-weight:700;margin-bottom:6px">${escapeHtml(formatReadableDate(pt.date))}</div>
            ${lines}
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid ${themeTokens.tooltipBorder};font-family:'JetBrains Mono',monospace;font-size:11px">
              Total: <b>${formatCompactNumber(pt.total_tokens)}</b> · Cache Hit: <b>${Number(pt.cache_hit_rate_pct || 0)}%</b>
            </div>
          `;
        },
      },
      legend: {
        top: 0,
        right: 0,
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 8,
        textStyle: { color: themeTokens.axisColor, fontSize: 11 },
      },
      grid: { left: 52, right: 16, top: 36, bottom: 26 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: themeTokens.gridBorder } },
        axisTick: { show: false },
        axisLabel: { color: themeTokens.axisColor, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: themeTokens.gridBorder, type: 'dashed' } },
        axisLabel: {
          color: themeTokens.axisColor,
          fontSize: 11,
          fontFamily: '"JetBrains Mono", monospace',
          formatter: (v) => formatCompactNumber(v),
        },
      },
      series: [
        {
          name: 'Cached Context',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 20,
          data: dailySeries.map((d) => d.cached_tokens),
        },
        {
          name: 'Uncached Prompt',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 20,
          data: dailySeries.map((d) => d.uncached_prompt_tokens),
        },
        {
          name: 'Output',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 20,
          data: dailySeries.map((d) => d.output_tokens),
        },
        {
          name: 'Reasoning',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 20,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
          data: dailySeries.map((d) => d.thinking_tokens),
        },
      ],
    };
  }, [streamMode, dailySeries, dates, themeTokens]);

  const streamEvents = useMemo(
    () => ({
      click: (params) => {
        if (streamMode !== 'quota' || !onCrossFilter) return;
        if (params?.seriesName === 'Overage (Pay-As-You-Go)') {
          onCrossFilter('quota', 'OVERAGE_QUOTA');
        } else if (params?.seriesName === 'Included Subscription') {
          onCrossFilter('quota', 'REGULAR_QUOTA');
        }
      },
    }),
    [streamMode, onCrossFilter]
  );

  const activeDimRows = useMemo(() => {
    if (dimTab === 'project') return projectBreakdown;
    if (dimTab === 'effort') return effortBreakdown;
    if (dimTab === 'surface') return surfaceBreakdown;
    return modelBreakdown;
  }, [dimTab, modelBreakdown, projectBreakdown, effortBreakdown, surfaceBreakdown]);

  const dimTotal = useMemo(
    () =>
      Math.max(
        1,
        activeDimRows.reduce(
          (acc, r) => acc + Number(dimTab === 'effort' ? r.requests || 0 : r.total_tokens || 0),
          0
        )
      ),
    [activeDimRows, dimTab]
  );

  const currentDimFilterValue = activeFilters[dimTab] || 'ALL';

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-7 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-[12px] p-5 h-[360px] animate-pulse" />
          <div className="xl:col-span-5 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-[12px] p-5 h-[360px] animate-pulse" />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-8 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-[12px] p-5 h-[350px] animate-pulse" />
          <div className="xl:col-span-4 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-[12px] p-5 h-[350px] animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7 bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-5 shadow-sm">
          <div className="mb-3">
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                Adoption Cadence &amp; Autonomous Turn Velocity
              </h2>
              <MetricTooltip
                title="Adoption Cadence & Turn Throughput"
                description="Overlays Daily Active Users (bars) and rolling 7-day WAU (dashed emerald line) on the left axis against autonomous agent turn volume (purple area) on the right axis."
                formula="Stickiness = DAU ÷ 28d MAU · Velocity = Deduplicated turns / day"
                benchmark="Parallel growth in WAU and turns per user indicates compounding engineering adoption."
              />
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Daily Active Users (DAU), rolling 7-day WAU, and real inference turn throughput across the organization
            </p>
          </div>
          <ReactECharts option={adoptionVelocityOption} style={{ height: '280px', width: '100%' }} notMerge />
        </div>

        <div className="xl:col-span-5">
          <ActivityHeatmap heatmap={heatmap} timezone={timezone} darkMode={darkMode} loading={loading} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8 bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3">
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                  {streamMode === 'tokens'
                    ? 'Daily Token Anatomy Stream'
                    : streamMode === 'finops'
                    ? 'Daily Token Spend vs. Avoided Prompt Cache Cost ($)'
                    : 'Daily Quota Consumption — Included vs. Overage Turns'}
                </h2>
                <MetricTooltip
                  title="Multi-Lens Token & FinOps Stream"
                  description="Switch lenses to inspect token composition (Cached, Uncached, Output, Reasoning), daily cost vs. prompt cache savings, or Included vs. Overage quota split."
                  formula="Total Tokens = Cached + Uncached Input + Output + Reasoning"
                  benchmark="In Quota Mix mode, click Included or Overage bars to cross-filter the entire dashboard."
                />
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {streamMode === 'tokens'
                  ? 'Cached context reuse vs. fresh prompt, code/text output, and extended reasoning tokens'
                  : streamMode === 'finops'
                  ? 'Direct comparison of actual estimated token cost against savings delivered by prompt context caching'
                  : 'Subscription quota consumption vs. pay-as-you-go overage turns per day (click series to filter)'}
              </p>
            </div>

            <div className="inline-flex bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-0.5 rounded-[8px] self-start shrink-0">
              {[
                { id: 'tokens', label: 'Token Anatomy' },
                { id: 'finops', label: 'Spend vs. Saved ($)' },
                { id: 'quota', label: 'Quota Mix' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setStreamMode(m.id)}
                  className={`px-2.5 py-1 rounded-[6px] text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    streamMode === m.id
                      ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <ReactECharts
            option={streamChartOption}
            onEvents={streamEvents}
            style={{ height: '275px', width: '100%' }}
            notMerge
          />
        </div>

        <div className="xl:col-span-4 bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                    Telemetry Share
                  </h2>
                  <MetricTooltip
                    title="Interactive Dimensional Cross-Filter"
                    description="Proportional breakdown of telemetry across Models, GCP Projects, Reasoning Effort, and Surfaces. Click any row to cross-filter the entire dashboard."
                    benchmark="Click an active row again (or use the filter chip bar) to clear the filter."
                  />
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1 mt-0.5">
                  <Filter className="w-3 h-3 text-blue-500" />
                  <span>Click any bar to cross-filter dashboard</span>
                </p>
              </div>

              <div className="inline-flex bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-0.5 rounded-[7px]">
                {[
                  { id: 'model', label: 'Models' },
                  { id: 'project', label: 'Projects' },
                  { id: 'effort', label: 'Effort' },
                  { id: 'surface', label: 'Surfaces' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setDimTab(t.id)}
                    className={`px-2 py-1 rounded-[5px] text-[11px] font-semibold transition-colors ${
                      dimTab === t.id
                        ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 mt-2">
              {activeDimRows.slice(0, 6).map((row, idx) => {
                const metricNum = Number(dimTab === 'effort' ? row.requests || 0 : row.total_tokens || 0);
                const sharePct = Math.min(100, Math.round((metricNum / dimTotal) * 1000) / 10);
                const filterVal = row.key_id || row.label;
                const isSelected = currentDimFilterValue !== 'ALL' && currentDimFilterValue === filterVal;
                const barPalette = [
                  'bg-blue-500',
                  'bg-emerald-500',
                  'bg-violet-500',
                  'bg-amber-500',
                  'bg-cyan-500',
                  'bg-pink-500',
                ];

                return (
                  <button
                    key={filterVal}
                    type="button"
                    onClick={() => onCrossFilter && onCrossFilter(dimTab, filterVal)}
                    className={`w-full text-left p-2 rounded-[8px] border transition-all space-y-1 ${
                      isSelected
                        ? 'bg-blue-50/90 dark:bg-blue-950/35 border-blue-400 dark:border-blue-600 ring-1 ring-blue-500/30'
                        : 'border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${barPalette[idx % barPalette.length]}`} />
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {row.label}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-[11px] text-zinc-600 dark:text-zinc-300 shrink-0 whitespace-nowrap">
                        {dimTab === 'effort'
                          ? `${formatFullNumber(row.requests)} turns`
                          : formatCompactNumber(row.total_tokens)}{' '}
                        <span className="text-zinc-400">({sharePct}%)</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800/90 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barPalette[idx % barPalette.length]}`}
                        style={{ width: `${Math.max(3, sharePct)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10.5px] font-mono text-zinc-500">
                      <span>
                        Cache {row.cache_hit_rate_pct}% · Avg ctx {formatCompactNumber(row.avg_prompt_tokens)}
                      </span>
                      <span>{formatCurrency(row.estimated_cost_usd)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/70 flex items-center justify-between text-[11px] text-zinc-500">
            <span>100% Real Cloud Logging attribution</span>
            <span className="font-mono">{activeDimRows.length} active items</span>
          </div>
        </div>
      </div>
    </section>
  );
}
