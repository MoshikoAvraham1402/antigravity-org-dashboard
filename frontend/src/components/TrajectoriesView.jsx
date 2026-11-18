import React from 'react';
import { GitBranch, Gauge, Wrench, Clock } from 'lucide-react';
import MetricTooltip from './MetricTooltip';
import {
  formatCompactNumber,
  formatCurrency,
  formatFullNumber,
  formatDurationMin,
  formatTimestamp,
} from '../utils/formatters';

export default function TrajectoriesView({
  kpis,
  trajectories = [],
  onSelectUser,
  loading,
}) {
  if (loading || !kpis) {
    return <div className="h-[420px] bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-[12px] animate-pulse" />;
  }

  return (
    <div className="space-y-5">
      {/* Quantiles & Agentic Depth Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <GitBranch className="w-4 h-4 text-violet-500 shrink-0" />
            <span>Autonomous Session Depth Quantiles</span>
            <MetricTooltip
              title="Trajectory Depth Quantiles"
              description="Measures how many sequential model inference turns Antigravity executes per unique trajectory_id session."
              formula="APPROX_QUANTILES(turns_per_trajectory, 100)"
              benchmark="Deep P90 (>40 turns) reflects complex multi-file feature implementation & autonomous testing."
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 font-mono tabular-nums">
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/70 dark:border-zinc-800">
              <div className="text-[10px] text-zinc-500">Median (P50)</div>
              <div className="text-lg font-extrabold text-zinc-950 dark:text-zinc-50">
                {kpis.p50_session_turns}
              </div>
              <div className="text-[10px] text-zinc-400">turns</div>
            </div>
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/70 dark:border-zinc-800">
              <div className="text-[10px] text-zinc-500">Deep (P90)</div>
              <div className="text-lg font-extrabold text-violet-600 dark:text-violet-400">
                {kpis.p90_session_turns}
              </div>
              <div className="text-[10px] text-zinc-400">turns</div>
            </div>
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/70 dark:border-zinc-800">
              <div className="text-[10px] text-zinc-500">Peak Session</div>
              <div className="text-lg font-extrabold text-blue-600 dark:text-blue-400">
                {formatCompactNumber(kpis.max_session_turns)}
              </div>
              <div className="text-[10px] text-zinc-400">turns</div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <Gauge className="w-4 h-4 text-amber-500 shrink-0" />
            <span>Prompt Context Window Distribution</span>
            <MetricTooltip
              title="Prompt Context Window Quantiles"
              description="Distribution of input prompt token counts per turn across median (P50), 95th-percentile tail (P95), and >200K long-context turns."
              benchmark="High P95 (>180K) indicates heavy repository context; use /compact to trim stale context."
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 font-mono tabular-nums">
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/70 dark:border-zinc-800">
              <div className="text-[10px] text-zinc-500">Median (P50)</div>
              <div className="text-lg font-extrabold text-zinc-950 dark:text-zinc-50">
                {formatCompactNumber(kpis.p50_prompt_tokens)}
              </div>
              <div className="text-[10px] text-zinc-400">tokens</div>
            </div>
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/70 dark:border-zinc-800">
              <div className="text-[10px] text-zinc-500">Tail (P95)</div>
              <div className="text-lg font-extrabold text-amber-600 dark:text-amber-400">
                {formatCompactNumber(kpis.p95_prompt_tokens)}
              </div>
              <div className="text-[10px] text-zinc-400">tokens</div>
            </div>
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/70 dark:border-zinc-800">
              <div className="text-[10px] text-zinc-500">&gt;200K Tier</div>
              <div className="text-lg font-extrabold text-rose-600 dark:text-rose-400">
                {kpis.long_context_pct}%
              </div>
              <div className="text-[10px] text-zinc-400">{formatCompactNumber(kpis.long_context_turns)} turns</div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <Wrench className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Agentic Tool &amp; Action Density</span>
            <MetricTooltip
              align="right"
              title="Agentic Tool Execution Density"
              description="Derived from ClientTelemetryLog InferenceResolved events, measuring file reads/edits, terminal commands, and MCP tool invocations per turn."
              formula="Tool Turns % = COUNTIF(tool_calls > 0) ÷ Total Turns"
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 font-mono tabular-nums">
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/70 dark:border-zinc-800">
              <div className="text-[10px] text-zinc-500">Total Calls</div>
              <div className="text-lg font-extrabold text-zinc-950 dark:text-zinc-50">
                {formatCompactNumber(kpis.total_tool_calls)}
              </div>
              <div className="text-[10px] text-zinc-400">executions</div>
            </div>
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/70 dark:border-zinc-800">
              <div className="text-[10px] text-zinc-500">Tool Turns</div>
              <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                {kpis.tool_assisted_pct}%
              </div>
              <div className="text-[10px] text-zinc-400">of turns</div>
            </div>
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/70 dark:border-zinc-800">
              <div className="text-[10px] text-zinc-500">Avg / Turn</div>
              <div className="text-lg font-extrabold text-blue-600 dark:text-blue-400">
                {kpis.avg_tools_per_turn}
              </div>
              <div className="text-[10px] text-zinc-400">tools/turn</div>
            </div>
          </div>
        </div>
      </div>

      {/* Top Autonomous Trajectories Explorer */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Top Autonomous Agent Trajectories (Metadata Only)
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Highest-volume real coding &amp; research trajectories across the organization — click any row to inspect the engineer’s full profile
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-zinc-100/80 dark:bg-zinc-900/90 text-zinc-500 dark:text-zinc-400 text-[11px] font-semibold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="py-3 px-4">Trajectory ID &amp; Engineer</th>
                <th className="py-3 px-3">Surface &amp; Primary Model</th>
                <th className="py-3 px-3 text-right">Span</th>
                <th className="py-3 px-3 text-right">Turns</th>
                <th className="py-3 px-3 text-right">Tool Calls</th>
                <th className="py-3 px-3 text-right">Peak Context</th>
                <th className="py-3 px-3 text-right">Total Tokens</th>
                <th className="py-3 px-3 text-right">Cache Hit</th>
                <th className="py-3 px-4 text-right">Est. Cost</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {trajectories.map((t) => {
                const isLongCtx = Number(t.peak_context_tokens || 0) > 200_000;
                return (
                  <tr
                    key={t.trajectory_id}
                    onClick={() => onSelectUser && onSelectUser(t.user_email)}
                    className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/60 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-mono text-[11.5px] font-bold text-zinc-900 dark:text-zinc-100 truncate max-w-[230px]">
                        {t.trajectory_id}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 mt-0.5">
                        <span className="truncate max-w-[170px]">{t.user_email}</span>
                        <span>·</span>
                        <span className="font-mono text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.2 rounded">
                          {t.project_id}
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      <div className="font-semibold text-zinc-800 dark:text-zinc-200">
                        {t.primary_model}
                      </div>
                      <div className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                        <span>{t.surface}</span>
                        <span>·</span>
                        <span className="font-mono text-[10.5px] text-violet-600 dark:text-violet-400">
                          {t.primary_effort}
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3 text-zinc-400" />
                        {formatDurationMin(t.duration_min)}
                      </div>
                      <div className="text-[10px] text-zinc-400">{formatTimestamp(t.last_event_ts)}</div>
                    </td>

                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
                      {formatFullNumber(t.turns)}
                    </td>

                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {formatFullNumber(t.tool_calls)}
                    </td>

                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      <span
                        className={
                          isLongCtx
                            ? 'px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20 font-semibold'
                            : 'text-zinc-700 dark:text-zinc-300'
                        }
                      >
                        {formatCompactNumber(t.peak_context_tokens)}
                      </span>
                    </td>

                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-zinc-950 dark:text-zinc-100">
                      {formatCompactNumber(t.total_tokens)}
                    </td>

                    <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">
                      {t.cache_hit_rate_pct}%
                    </td>

                    <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-zinc-950 dark:text-zinc-50">
                      {formatCurrency(t.estimated_cost_usd)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
