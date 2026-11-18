import React from 'react';
import { Sparkles, AlertTriangle, GitBranch, ArrowUpRight } from 'lucide-react';
import { formatCompactNumber, formatCurrency, formatFullNumber } from '../utils/formatters';

export default function InsightsBanner({
  kpis,
  clientVersions = [],
  effortBreakdown = [],
  onJumpTab,
  loading,
}) {
  if (loading || !kpis) return null;

  const latestVersionObj = clientVersions.find((v) => v.key_id && v.key_id !== 'unknown');
  const latestVersionTag = latestVersionObj?.label || 'N/A';
  const totalVersionTurns = clientVersions.reduce((acc, r) => acc + Number(r.requests || 0), 0) || 1;
  const latestVersionShare = latestVersionObj
    ? Math.round((Number(latestVersionObj.requests || 0) / totalVersionTurns) * 100)
    : 0;

  const highMaxTurns = effortBreakdown
    .filter((e) => e.key_id === 'Max Effort' || e.key_id === 'High Effort')
    .reduce((acc, e) => acc + Number(e.requests || 0), 0);
  const highMaxPct = kpis.total_requests > 0 ? Math.round((highMaxTurns / kpis.total_requests) * 100) : 0;

  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <div className="bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-900/50 rounded-[10px] px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
            <span className="font-bold text-zinc-950 dark:text-zinc-100">Prompt Caching ROI:</span>{' '}
            Context reuse hit{' '}
            <strong className="font-mono text-emerald-700 dark:text-emerald-400">
              {kpis.cache_hit_rate_pct}%
            </strong>
            , avoiding{' '}
            <strong className="font-mono text-emerald-700 dark:text-emerald-400">
              {formatCurrency(kpis.cache_savings_usd)}
            </strong>{' '}
            ({kpis.cost_avoidance_pct}% of hypothetical uncached spend).
          </div>
        </div>
        {onJumpTab && (
          <button
            type="button"
            onClick={() => onJumpTab('finops')}
            className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline mt-0.5"
          >
            Ledger <ArrowUpRight className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/50 rounded-[10px] px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
            <AlertTriangle className="w-3.5 h-3.5" />
          </div>
          <div className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
            <span className="font-bold text-zinc-950 dark:text-zinc-100">Quota &amp; &gt;200K Context:</span>{' '}
            <strong className="font-mono text-amber-700 dark:text-amber-400">
              {kpis.overage_share_pct}%
            </strong>{' '}
            of turns ran on Overage Quota ({formatCurrency(kpis.overage_cost_usd)}), and{' '}
            <strong className="font-mono text-amber-700 dark:text-amber-400">
              {kpis.long_context_pct}%
            </strong>{' '}
            exceeded the 200K long-context threshold.
          </div>
        </div>
        {onJumpTab && (
          <button
            type="button"
            onClick={() => onJumpTab('models')}
            className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline mt-0.5"
          >
            Models <ArrowUpRight className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200/80 dark:border-blue-900/50 rounded-[10px] px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
            <GitBranch className="w-3.5 h-3.5" />
          </div>
          <div className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
            <span className="font-bold text-zinc-950 dark:text-zinc-100">Agent Depth &amp; Fleet:</span>{' '}
            <strong className="font-mono text-blue-700 dark:text-blue-400">{highMaxPct}%</strong> High/Max reasoning effort · Peak trajectory{' '}
            <strong className="font-mono text-blue-700 dark:text-blue-400">
              {formatFullNumber(kpis.max_session_turns)}
            </strong>{' '}
            turns · <strong className="font-mono">{latestVersionShare}%</strong> on {latestVersionTag}.
          </div>
        </div>
        {onJumpTab && (
          <button
            type="button"
            onClick={() => onJumpTab('trajectories')}
            className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline mt-0.5"
          >
            Explore <ArrowUpRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </section>
  );
}
