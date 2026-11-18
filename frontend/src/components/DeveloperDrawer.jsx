import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { X, Layers, Zap, Sparkles, Gauge } from 'lucide-react';
import {
  escapeHtml,
  formatCompactNumber,
  formatCurrency,
  formatFullNumber,
  formatReadableDate,
  formatShortDate,
  formatDurationMin,
} from '../utils/formatters';

export default function DeveloperDrawer({
  userSummary,
  drilldown,
  loading,
  darkMode,
  onClose,
}) {
  const dailyActivity = drilldown?.daily_activity || [];

  const sparklineOption = useMemo(() => {
    const axisColor = darkMode ? '#71717a' : '#94a3b8';
    return {
      color: ['#3b82f6'],
      grid: { left: 44, right: 12, top: 14, bottom: 22 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: darkMode ? 'rgba(12,12,15,0.96)' : 'rgba(255,255,255,0.98)',
        borderColor: darkMode ? '#27272a' : '#e2e8f0',
        textStyle: { color: darkMode ? '#fafafa' : '#0f172a', fontSize: 11 },
        formatter: (params) => {
          if (!params?.length) return '';
          const idx = params[0].dataIndex;
          const pt = dailyActivity[idx] || {};
          return `<div style="font-weight:700">${escapeHtml(formatReadableDate(pt.date))}</div>
            <div style="font-family:'JetBrains Mono',monospace;margin-top:3px">
              Tokens: ${formatCompactNumber(pt.total_tokens)}<br/>
              Turns: ${formatFullNumber(pt.requests)} · Tools: ${formatFullNumber(pt.tool_calls)}<br/>
              Spend: ${formatCurrency(pt.estimated_cost_usd)} · Saved: ${formatCurrency(pt.cache_savings_usd)}
            </div>`;
        },
      },
      xAxis: {
        type: 'category',
        data: dailyActivity.map((d) => formatShortDate(d.date)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: darkMode ? '#1e1e24' : '#f1f5f9' } },
        axisLabel: {
          color: axisColor,
          fontSize: 10,
          fontFamily: '"JetBrains Mono", monospace',
          formatter: (v) => formatCompactNumber(v),
        },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 14,
          itemStyle: { color: '#3b82f6', borderRadius: [3, 3, 0, 0] },
          data: dailyActivity.map((d) => d.total_tokens || 0),
        },
      ],
    };
  }, [dailyActivity, darkMode]);

  if (!userSummary) return null;

  return (
    <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] shadow-sm p-5 flex flex-col gap-4 h-fit">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-3.5">
        <div className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Live Engineer Telemetry Profile
          </span>
          <h3 className="text-sm font-bold font-mono text-zinc-950 dark:text-zinc-50 truncate mt-0.5">
            {userSummary.user_email}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
              {userSummary.primary_project}
            </span>
            {userSummary.latest_client_version && (
              <>
                <span>·</span>
                <span className="font-mono text-[11px]">v{userSummary.latest_client_version}</span>
              </>
            )}
            <span>·</span>
            <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
              {userSummary.overage_share_pct ?? 0}% Overage
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close details panel"
          onClick={onClose}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/80 dark:border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
            Cache Hit Rate
          </div>
          <div className="mt-1 font-mono tabular-nums text-base font-bold text-emerald-600 dark:text-emerald-400">
            {userSummary.cache_hit_rate_pct}%
          </div>
          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
            Saved {formatCurrency(userSummary.cache_savings_usd)}
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/80 dark:border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <Gauge className="w-3.5 h-3.5 text-amber-500" />
            Peak Context
          </div>
          <div className="mt-1 font-mono tabular-nums text-base font-bold text-zinc-950 dark:text-zinc-100">
            {formatCompactNumber(userSummary.peak_context_tokens)}
          </div>
          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
            {userSummary.long_context_turns || 0} turns &gt;200K
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/80 dark:border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <Zap className="w-3.5 h-3.5 text-blue-500" />
            Tool Executions
          </div>
          <div className="mt-1 font-mono tabular-nums text-base font-bold text-zinc-950 dark:text-zinc-100">
            {Number(userSummary.tool_calls || 0).toLocaleString()}
          </div>
          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
            {userSummary.avg_tools_per_turn || 0} avg/turn · {userSummary.sessions} sessions
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/80 dark:border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <Layers className="w-3.5 h-3.5 text-violet-500" />
            Reasoning Share
          </div>
          <div className="mt-1 font-mono tabular-nums text-base font-bold text-zinc-950 dark:text-zinc-100">
            {userSummary.thinking_ratio_pct}%
          </div>
          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
            {formatCompactNumber(userSummary.thinking_tokens)} thinking
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
          Daily Real Token Velocity
        </div>
        {loading ? (
          <div className="h-36 bg-zinc-100 dark:bg-zinc-900 rounded-lg animate-pulse" />
        ) : (
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-2 bg-zinc-50/50 dark:bg-zinc-950/40">
            <ReactECharts option={sparklineOption} style={{ height: '140px', width: '100%' }} notMerge />
          </div>
        )}
      </div>

      {!loading && drilldown?.model_split?.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
            Model Attribution
          </div>
          <div className="space-y-2">
            {drilldown.model_split.map((m) => {
              const pct = Math.min(
                100,
                Math.round((Number(m.total_tokens || 0) / Math.max(1, Number(userSummary.total_tokens || 1))) * 100)
              );
              return (
                <div key={m.name} className="text-xs">
                  <div className="flex justify-between mb-1">
                    <span className="text-zinc-700 dark:text-zinc-300 font-medium">{m.name}</span>
                    <span className="font-mono tabular-nums text-zinc-500">
                      {formatCompactNumber(m.total_tokens)} ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && drilldown?.effort_split?.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
            Reasoning Effort Mix
          </div>
          <div className="flex flex-wrap gap-1.5">
            {drilldown.effort_split.map((ef) => (
              <span
                key={ef.name}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300"
              >
                <strong>{ef.name.replace(' Effort', '')}:</strong> {ef.requests}t
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
          Recent Trajectories (Metadata Only)
        </div>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-zinc-100 dark:bg-zinc-900 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {(drilldown?.recent_sessions || []).map((sess) => (
              <div
                key={sess.session_id}
                className="p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 flex items-center justify-between gap-2 text-[11px]"
              >
                <div className="min-w-0">
                  <div className="font-mono text-zinc-800 dark:text-zinc-200 font-medium truncate">
                    {sess.session_id}
                  </div>
                  <div className="text-zinc-500 truncate">
                    {sess.model_display_name} · {formatDurationMin(sess.duration_min)} · Ctx {formatCompactNumber(sess.peak_context_tokens)}
                  </div>
                </div>
                <div className="text-right shrink-0 font-mono tabular-nums">
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatCompactNumber(sess.total_tokens)}
                  </div>
                  <div className="text-zinc-500">{sess.turns} turns</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
