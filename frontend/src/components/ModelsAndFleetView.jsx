import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Cpu, Brain, ShieldCheck, ArrowUpCircle, FolderGit2, Filter, Download } from 'lucide-react';
import MetricTooltip from './MetricTooltip';
import {
  escapeHtml,
  formatCompactNumber,
  formatCurrency,
  formatFullNumber,
  CHART_COLORS,
} from '../utils/formatters';
import { downloadCsv } from '../utils/csv';

export default function ModelsAndFleetView({
  modelBreakdown = [],
  effortBreakdown = [],
  quotaBreakdown = [],
  clientVersions = [],
  projectBreakdown = [],
  activeFilters = {},
  onCrossFilter,
  darkMode,
  loading,
}) {
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

  const topModelsReversed = useMemo(() => [...modelBreakdown].slice(0, 8).reverse(), [modelBreakdown]);

  const modelStackOption = useMemo(() => {
    const top = topModelsReversed;
    return {
      color: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6'],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: themeTokens.tooltipBg,
        borderColor: themeTokens.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: themeTokens.tooltipText, fontSize: 12 },
        formatter: (params) => {
          if (!params?.length) return '';
          const m = top[params[0].dataIndex] || {};
          return `
            <div style="font-weight:700;margin-bottom:5px">${escapeHtml(m.label)} (${escapeHtml(m.provider)})</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.55">
              Turns: <b>${formatFullNumber(m.requests)}</b> · Users: <b>${Number(m.active_users || 0)}</b><br/>
              Total Tokens: <b>${formatCompactNumber(m.total_tokens)}</b> (Cache <b>${Number(m.cache_hit_rate_pct || 0)}%</b>)<br/>
              Avg Context: <b>${formatCompactNumber(m.avg_prompt_tokens)}</b> · &gt;200K: <b>${Number(m.long_context_pct || 0)}%</b><br/>
              Spend: <b>${formatCurrency(m.estimated_cost_usd)}</b> · Saved: <b>${formatCurrency(m.cache_savings_usd)}</b>
            </div>
            <div style="margin-top:5px;font-size:10px;color:#3b82f6">Click bar to cross-filter by model</div>
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
      grid: { left: 155, right: 24, top: 34, bottom: 24 },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: themeTokens.gridBorder, type: 'dashed' } },
        axisLabel: {
          color: themeTokens.axisColor,
          fontSize: 11,
          fontFamily: '"JetBrains Mono", monospace',
          formatter: (v) => formatCompactNumber(v),
        },
      },
      yAxis: {
        type: 'category',
        data: top.map((m) => m.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: themeTokens.tooltipText, fontSize: 11, fontWeight: 600 },
      },
      series: [
        {
          name: 'Cached Context',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 18,
          cursor: 'pointer',
          data: top.map((m) => m.cached_tokens),
        },
        {
          name: 'Uncached Prompt',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 18,
          cursor: 'pointer',
          data: top.map((m) => m.uncached_prompt_tokens),
        },
        {
          name: 'Output',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 18,
          cursor: 'pointer',
          data: top.map((m) => m.output_tokens),
        },
        {
          name: 'Reasoning',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 18,
          cursor: 'pointer',
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          data: top.map((m) => m.thinking_tokens),
        },
      ],
    };
  }, [topModelsReversed, themeTokens]);

  const modelBarEvents = useMemo(
    () => ({
      click: (params) => {
        if (!onCrossFilter) return;
        const m = topModelsReversed[params?.dataIndex];
        if (m?.key_id) {
          onCrossFilter('model', m.key_id);
        }
      },
    }),
    [topModelsReversed, onCrossFilter]
  );

  const effortDonutOption = useMemo(() => {
    const colorMap = {
      'Max Effort': '#f43f5e',
      'High Effort': '#8b5cf6',
      'Medium Effort': '#3b82f6',
      'Lite Effort': '#10b981',
      Standard: '#71717a',
    };
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: themeTokens.tooltipBg,
        borderColor: themeTokens.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: themeTokens.tooltipText, fontSize: 12 },
        formatter: (p) => {
          const d = p.data?.raw || {};
          return `
            <div style="font-weight:700;margin-bottom:4px">${escapeHtml(p.name)}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.5">
              Turns: <b>${formatFullNumber(d.requests)}</b> (${Number(p.percent || 0)}%)<br/>
              Reasoning Tokens: <b>${formatCompactNumber(d.thinking_tokens)}</b><br/>
              Total Spend: <b>${formatCurrency(d.estimated_cost_usd)}</b>
            </div>
            <div style="margin-top:4px;font-size:10px;color:#8b5cf6">Click slice to cross-filter by effort</div>
          `;
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['54%', '80%'],
          center: ['50%', '50%'],
          cursor: 'pointer',
          itemStyle: {
            borderRadius: 6,
            borderColor: darkMode ? '#0c0c0f' : '#ffffff',
            borderWidth: 2,
          },
          label: { show: false },
          data: effortBreakdown.map((e, i) => ({
            name: e.label,
            value: Number(e.requests || 0),
            raw: e,
            itemStyle: { color: colorMap[e.label] || CHART_COLORS[i % CHART_COLORS.length] },
          })),
        },
      ],
    };
  }, [effortBreakdown, darkMode, themeTokens]);

  const effortDonutEvents = useMemo(
    () => ({
      click: (params) => {
        const keyId = params?.data?.raw?.key_id;
        if (onCrossFilter && keyId) {
          onCrossFilter('effort', keyId);
        }
      },
    }),
    [onCrossFilter]
  );

  if (loading) {
    return <div className="h-[520px] bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-[12px] animate-pulse" />;
  }

  const latestVersionKey = clientVersions.find((v) => v.key_id && v.key_id !== 'unknown')?.key_id;
  const totalVersionTurns = Math.max(
    1,
    clientVersions.reduce((acc, v) => acc + Number(v.requests || 0), 0)
  );
  const totalProjectTokens = Math.max(
    1,
    projectBreakdown.reduce((acc, p) => acc + Number(p.total_tokens || 0), 0)
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7 bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Cpu className="w-4 h-4 text-blue-500" />
            <h2 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
              Foundation Model Token Anatomy
            </h2>
            <MetricTooltip
              title="Model-Level Token Composition"
              description="Breaks down every foundation model's token volume into Cached Context, Uncached Prompt Input, Generated Output, and Extended Reasoning tokens."
              benchmark="Click any model bar to isolate that model across all KPIs, daily charts, and engineers."
            />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3 flex items-center gap-1.5">
            <Filter className="w-3 h-3 text-blue-500 shrink-0" />
            <span>Click any model bar to cross-filter · Cached reuse vs. fresh prompt, output, and reasoning tokens</span>
          </p>
          <ReactECharts
            option={modelStackOption}
            onEvents={modelBarEvents}
            style={{ height: '270px', width: '100%' }}
            notMerge
          />
        </div>

        <div className="xl:col-span-5 bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Brain className="w-4 h-4 text-violet-500" />
              <h2 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                Reasoning Effort &amp; Quota Tiers
              </h2>
              <MetricTooltip
                title="Reasoning Effort & Quota Attribution"
                description="Maps agent experience effort levels (Lite, Medium, High, Max) alongside Included Subscription vs. Pay-As-You-Go Overage quota consumption."
                benchmark="Click any effort tier or quota card below to cross-filter the dashboard."
              />
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Click any effort level or quota card to isolate reasoning &amp; billing behavior
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center my-2">
            <div className="sm:col-span-5">
              <ReactECharts
                option={effortDonutOption}
                onEvents={effortDonutEvents}
                style={{ height: '175px', width: '100%' }}
                notMerge
              />
            </div>
            <div className="sm:col-span-7 space-y-2">
              {effortBreakdown.map((e) => {
                const isSelected = activeFilters.effort === e.key_id;
                const badgeColor =
                  e.label === 'Max Effort'
                    ? 'bg-rose-500'
                    : e.label === 'High Effort'
                    ? 'bg-violet-500'
                    : e.label === 'Medium Effort'
                    ? 'bg-blue-500'
                    : 'bg-emerald-500';
                return (
                  <button
                    key={e.key_id}
                    type="button"
                    onClick={() => onCrossFilter && onCrossFilter('effort', e.key_id)}
                    className={`w-full flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                      isSelected
                        ? 'bg-violet-50 dark:bg-violet-950/40 border-violet-400 dark:border-violet-600 ring-1 ring-violet-500/30'
                        : 'bg-zinc-50 dark:bg-zinc-900/70 border-zinc-200/70 dark:border-zinc-800 hover:border-violet-300 dark:hover:border-violet-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${badgeColor}`} />
                      <span className="font-semibold text-zinc-800 dark:text-zinc-200">{e.label}</span>
                    </div>
                    <div className="font-mono tabular-nums text-[11px] text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                      {formatFullNumber(e.requests)} turns · {formatCurrency(e.estimated_cost_usd)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 grid grid-cols-2 gap-2.5">
            {quotaBreakdown.map((q) => {
              const isOverage = q.key_id === 'OVERAGE_QUOTA';
              const isSelected = activeFilters.quota === q.key_id;
              return (
                <button
                  key={q.key_id}
                  type="button"
                  onClick={() => onCrossFilter && onCrossFilter('quota', q.key_id)}
                  className={`text-left p-2.5 rounded-lg border transition-all ${
                    isSelected
                      ? isOverage
                        ? 'bg-amber-100/80 border-amber-500 ring-1 ring-amber-500/40 dark:bg-amber-950/50'
                        : 'bg-emerald-100/80 border-emerald-500 ring-1 ring-emerald-500/40 dark:bg-emerald-950/50'
                      : isOverage
                      ? 'bg-amber-50/60 border-amber-200/80 hover:border-amber-400 dark:bg-amber-950/20 dark:border-amber-900/50'
                      : 'bg-emerald-50/60 border-emerald-200/80 hover:border-emerald-400 dark:bg-emerald-950/20 dark:border-emerald-900/50'
                  }`}
                >
                  <div className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {q.label}
                  </div>
                  <div className="mt-0.5 font-mono font-bold text-sm text-zinc-950 dark:text-zinc-100">
                    {formatFullNumber(q.requests)} turns
                  </div>
                  <div className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400">
                    {formatCompactNumber(q.total_tokens)} tok · {formatCurrency(q.estimated_cost_usd)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Model Efficiency Matrix Table */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
              Model Efficiency, Context Window &amp; FinOps Matrix
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Click any model row to cross-filter · Hover <code className="font-mono">(?)</code> headers for metric formulas
            </p>
          </div>
          <button
            type="button"
            disabled={!modelBreakdown.length}
            onClick={() =>
              downloadCsv(
                'antigravity_model_efficiency.csv',
                [
                  'key_id',
                  'label',
                  'provider',
                  'requests',
                  'active_users',
                  'avg_prompt_tokens',
                  'long_context_pct',
                  'cache_hit_rate_pct',
                  'overage_share_pct',
                  'total_tokens',
                  'cache_savings_usd',
                  'estimated_cost_usd',
                ],
                modelBreakdown
              )
            }
            className="self-start sm:self-auto inline-flex items-center gap-1.5 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-3 py-1.5 text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-zinc-100/80 dark:bg-zinc-900/90 text-zinc-500 dark:text-zinc-400 text-[11px] font-semibold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="py-3 px-4">Model</th>
                <th className="py-3 px-3">Provider</th>
                <th className="py-3 px-3 text-right">Turns</th>
                <th className="py-3 px-3 text-right">Users</th>
                <th className="py-3 px-3 text-right">
                  <span className="inline-flex items-center justify-end gap-1">
                    Avg Prompt Ctx
                    <MetricTooltip
                      title="Average Prompt Context"
                      description="Mean total prompt tokens (cached + uncached) sent per turn to this model."
                      formula="SUM(prompt_tokens) ÷ COUNT(turns)"
                    />
                  </span>
                </th>
                <th className="py-3 px-3 text-right">
                  <span className="inline-flex items-center justify-end gap-1">
                    &gt;200K Tier
                    <MetricTooltip
                      title="Long-Context (>200K) Turn Share"
                      description="Percentage of turns exceeding 200,000 prompt tokens, where long-context SKU multipliers apply."
                      formula="COUNTIF(prompt_tokens > 200K) ÷ Turns × 100"
                      benchmark=">20% highlights models used on deep uncompacted trajectories."
                    />
                  </span>
                </th>
                <th className="py-3 px-3 text-right">
                  <span className="inline-flex items-center justify-end gap-1">
                    Cache Hit
                    <MetricTooltip
                      title="Model Prompt Cache Hit Rate"
                      description="Percentage of input prompt tokens served from context cache for this model."
                      formula="SUM(cached_tokens) ÷ SUM(prompt_tokens) × 100"
                      benchmark="≥80% indicates healthy multi-turn context reuse."
                    />
                  </span>
                </th>
                <th className="py-3 px-3 text-right">
                  <span className="inline-flex items-center justify-end gap-1">
                    Overage %
                    <MetricTooltip
                      title="Overage Quota Turn Share"
                      description="Percentage of turns on this model billed via OVERAGE_QUOTA beyond included subscription capacity."
                      formula="COUNTIF(quota = OVERAGE_QUOTA) ÷ Turns × 100"
                    />
                  </span>
                </th>
                <th className="py-3 px-3 text-right">Total Tokens</th>
                <th className="py-3 px-3 text-right">
                  <span className="inline-flex items-center justify-end gap-1">
                    Cache Saved
                    <MetricTooltip
                      align="right"
                      title="Prompt Cache Cost Avoided"
                      description="Dollar spend avoided by serving cached prompt tokens at discounted cache SKU rates instead of full list input rates."
                      formula="Cached Tokens × (List Input Rate − Cached Rate)"
                    />
                  </span>
                </th>
                <th className="py-3 px-4 text-right">Token Spend</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-zinc-100 dark:divide-zinc-800/80 font-mono tabular-nums">
              {modelBreakdown.map((m) => {
                const isSelected = activeFilters.model === m.key_id;
                return (
                  <tr
                    key={m.key_id}
                    onClick={() => onCrossFilter && onCrossFilter('model', m.key_id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50/90 dark:bg-blue-950/40'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                    }`}
                  >
                    <td className="py-3 px-4 font-sans font-semibold text-zinc-950 dark:text-zinc-100">
                      <div>{m.label}</div>
                      <div className="text-[10.5px] font-mono text-zinc-400 font-normal">{m.key_id}</div>
                    </td>
                    <td className="py-3 px-3 font-sans">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onCrossFilter && m.provider) onCrossFilter('provider', m.provider);
                        }}
                        className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
                      >
                        {m.provider}
                      </button>
                    </td>
                    <td className="py-3 px-3 text-right">{formatFullNumber(m.requests)}</td>
                    <td className="py-3 px-3 text-right">{m.active_users}</td>
                    <td className="py-3 px-3 text-right">{formatCompactNumber(m.avg_prompt_tokens)}</td>
                    <td className="py-3 px-3 text-right">
                      <span
                        className={
                          Number(m.long_context_pct) > 20
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : 'text-zinc-500'
                        }
                      >
                        {m.long_context_pct}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                      {m.cache_hit_rate_pct}%
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span
                        className={
                          Number(m.overage_share_pct) > 50
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : 'text-zinc-500'
                        }
                      >
                        {m.overage_share_pct}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-zinc-950 dark:text-zinc-100">
                      {formatCompactNumber(m.total_tokens)}
                    </td>
                    <td className="py-3 px-3 text-right text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(m.cache_savings_usd)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-zinc-950 dark:text-zinc-50">
                      {formatCurrency(m.estimated_cost_usd)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fleet Hygiene & GCP Project Attribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                Client Version Fleet Hygiene
                <MetricTooltip
                  title="Antigravity Client Version Hygiene"
                  description="Distribution of inference turns by client_version reported in Cloud Logging labels across IDE and CLI binaries."
                  benchmark="Aim for ≥85% of turns on the latest release to ensure optimal prompt caching and security patches."
                />
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Tracks Antigravity binary adoption so engineers benefit from latest security &amp; caching improvements
              </p>
            </div>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {clientVersions.map((v) => {
              const isLatest = v.key_id === latestVersionKey;
              const pct = Math.max(1, Math.round((Number(v.requests || 0) / totalVersionTurns) * 100));
              return (
                <div
                  key={v.key_id}
                  className="p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/50"
                >
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">{v.label}</span>
                      {isLatest ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                          Latest Release
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">
                          <ArrowUpCircle className="w-2.5 h-2.5" /> Older Build
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                      {formatFullNumber(v.requests)} turns ({pct}%) · {v.active_users} user{v.active_users === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isLatest ? 'bg-emerald-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-5 shadow-sm">
          <div className="mb-3">
            <h3 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-blue-500" />
              GCP Project Attribution Across Organization
              <MetricTooltip
                title="Multi-Project Attribution & Filter"
                description="Resolves Cloud Logging resource_container project numbers to human-readable GCP project IDs across your organization. Click any project card to filter the entire dashboard."
              />
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
              <Filter className="w-3 h-3 text-blue-500 shrink-0" />
              <span>Click any GCP project below to isolate team usage &amp; spend</span>
            </p>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {projectBreakdown.map((proj) => {
              const pct = Math.max(1, Math.round((Number(proj.total_tokens || 0) / totalProjectTokens) * 1000) / 10);
              const isSelected = activeFilters.project === proj.key_id;
              return (
                <button
                  key={proj.key_id}
                  type="button"
                  onClick={() => onCrossFilter && onCrossFilter('project', proj.key_id)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                    isSelected
                      ? 'bg-blue-50/90 dark:bg-blue-950/40 border-blue-500 ring-1 ring-blue-500/30'
                      : 'border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/50 hover:border-blue-400 dark:hover:border-blue-700'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">{proj.label}</span>
                    <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                      {formatCompactNumber(proj.total_tokens)} tok ({pct}%) · {formatCurrency(proj.estimated_cost_usd)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden mb-1">
                    <div
                      className="h-full bg-indigo-500 rounded-full"
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10.5px] font-mono text-zinc-500">
                    <span>
                      {formatFullNumber(proj.requests)} turns · {proj.active_users} engineer{proj.active_users === 1 ? '' : 's'}
                    </span>
                    <span>Cache {proj.cache_hit_rate_pct}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
