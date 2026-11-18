import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Cpu, Brain, ShieldCheck, ArrowUpCircle, FolderGit2 } from 'lucide-react';
import {
  formatCompactNumber,
  formatCurrency,
  formatFullNumber,
  CHART_COLORS,
} from '../utils/formatters';

export default function ModelsAndFleetView({
  modelBreakdown = [],
  effortBreakdown = [],
  quotaBreakdown = [],
  clientVersions = [],
  projectBreakdown = [],
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

  const modelStackOption = useMemo(() => {
    const top = [...modelBreakdown].slice(0, 8).reverse();
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
            <div style="font-weight:700;margin-bottom:5px">${m.label} (${m.provider})</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.55">
              Turns: <b>${formatFullNumber(m.requests)}</b> · Users: <b>${m.active_users}</b><br/>
              Total Tokens: <b>${formatCompactNumber(m.total_tokens)}</b> (Cache <b>${m.cache_hit_rate_pct}%</b>)<br/>
              Avg Context: <b>${formatCompactNumber(m.avg_prompt_tokens)}</b> · &gt;200K: <b>${m.long_context_pct}%</b><br/>
              Spend: <b>${formatCurrency(m.estimated_cost_usd)}</b> · Saved: <b>${formatCurrency(m.cache_savings_usd)}</b>
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
      grid: { left: 150, right: 24, top: 34, bottom: 24 },
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
          data: top.map((m) => m.cached_tokens),
        },
        {
          name: 'Uncached Prompt',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 18,
          data: top.map((m) => m.uncached_prompt_tokens),
        },
        {
          name: 'Output',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 18,
          data: top.map((m) => m.output_tokens),
        },
        {
          name: 'Reasoning',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 18,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          data: top.map((m) => m.thinking_tokens),
        },
      ],
    };
  }, [modelBreakdown, themeTokens]);

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
            <div style="font-weight:700;margin-bottom:4px">${p.name}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.5">
              Turns: <b>${formatFullNumber(d.requests)}</b> (${p.percent}%)<br/>
              Reasoning Tokens: <b>${formatCompactNumber(d.thinking_tokens)}</b><br/>
              Total Spend: <b>${formatCurrency(d.estimated_cost_usd)}</b>
            </div>
          `;
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['54%', '80%'],
          center: ['50%', '50%'],
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
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
            Comparison of cached context reuse, fresh prompt input, output generation, and reasoning tokens across active models
          </p>
          <ReactECharts option={modelStackOption} style={{ height: '270px', width: '100%' }} notMerge />
        </div>

        <div className="xl:col-span-5 bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Brain className="w-4 h-4 text-violet-500" />
              <h2 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                Reasoning Effort &amp; Quota Tiers
              </h2>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Agent reasoning effort levels (<code className="font-mono">experience</code> telemetry) and subscription vs. overage split
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center my-2">
            <div className="sm:col-span-5">
              <ReactECharts option={effortDonutOption} style={{ height: '175px', width: '100%' }} notMerge />
            </div>
            <div className="sm:col-span-7 space-y-2">
              {effortBreakdown.map((e) => {
                const badgeColor =
                  e.label === 'Max Effort'
                    ? 'bg-rose-500'
                    : e.label === 'High Effort'
                    ? 'bg-violet-500'
                    : e.label === 'Medium Effort'
                    ? 'bg-blue-500'
                    : 'bg-emerald-500';
                return (
                  <div
                    key={e.key_id}
                    className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/70 border border-zinc-200/70 dark:border-zinc-800"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${badgeColor}`} />
                      <span className="font-semibold text-zinc-800 dark:text-zinc-200">{e.label}</span>
                    </div>
                    <div className="font-mono tabular-nums text-[11px] text-zinc-600 dark:text-zinc-300">
                      {formatFullNumber(e.requests)} turns · {formatCurrency(e.estimated_cost_usd)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 grid grid-cols-2 gap-2.5">
            {quotaBreakdown.map((q) => {
              const isOverage = q.key_id === 'OVERAGE_QUOTA';
              return (
                <div
                  key={q.key_id}
                  className={`p-2.5 rounded-lg border ${
                    isOverage
                      ? 'bg-amber-50/60 border-amber-200/80 dark:bg-amber-950/20 dark:border-amber-900/50'
                      : 'bg-emerald-50/60 border-emerald-200/80 dark:bg-emerald-950/20 dark:border-emerald-900/50'
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
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Model Efficiency Matrix Table */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Model Efficiency, Context Window &amp; FinOps Matrix
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Granular performance &amp; unit-economics per foundation model across your GCP organization
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-zinc-100/80 dark:bg-zinc-900/90 text-zinc-500 dark:text-zinc-400 text-[11px] font-semibold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="py-3 px-4">Model</th>
                <th className="py-3 px-3">Provider</th>
                <th className="py-3 px-3 text-right">Turns</th>
                <th className="py-3 px-3 text-right">Users</th>
                <th className="py-3 px-3 text-right">Avg Prompt Ctx</th>
                <th className="py-3 px-3 text-right">&gt;200K Tier</th>
                <th className="py-3 px-3 text-right">Cache Hit</th>
                <th className="py-3 px-3 text-right">Overage %</th>
                <th className="py-3 px-3 text-right">Total Tokens</th>
                <th className="py-3 px-3 text-right">Cache Saved</th>
                <th className="py-3 px-4 text-right">Token Spend</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-zinc-100 dark:divide-zinc-800/80 font-mono tabular-nums">
              {modelBreakdown.map((m) => (
                <tr key={m.key_id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                  <td className="py-3 px-4 font-sans font-semibold text-zinc-950 dark:text-zinc-100">
                    <div>{m.label}</div>
                    <div className="text-[10.5px] font-mono text-zinc-400 font-normal">{m.key_id}</div>
                  </td>
                  <td className="py-3 px-3 font-sans">
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                      {m.provider}
                    </span>
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
              ))}
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
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Real telemetry routed from child GCP projects via Organization Cloud Logging sink
            </p>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {projectBreakdown.map((proj) => {
              const pct = Math.max(1, Math.round((Number(proj.total_tokens || 0) / totalProjectTokens) * 1000) / 10);
              return (
                <div
                  key={proj.key_id}
                  className="p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/50"
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
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
