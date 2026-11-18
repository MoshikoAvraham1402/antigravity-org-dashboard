import React, { useMemo } from 'react';
import {
  Users,
  Zap,
  Cpu,
  Sparkles,
  Gauge,
  DollarSign,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { formatCompactNumber, formatCurrency, formatFullNumber } from '../utils/formatters';

function MiniSparkline({ values = [], stroke = '#3b82f6', fillId = 'spark' }) {
  const pathData = useMemo(() => {
    const clean = values.map((v) => Number(v || 0));
    if (clean.length < 2) return null;
    const width = 112;
    const height = 26;
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const span = max - min || 1;

    const pts = clean.map((val, idx) => {
      const x = (idx / (clean.length - 1)) * width;
      const y = height - 3 - ((val - min) / span) * (height - 6);
      return [x, y];
    });

    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area, last: pts[pts.length - 1] };
  }, [values]);

  if (!pathData) return <div className="h-[26px]" />;

  return (
    <svg viewBox="0 0 112 26" className="w-28 h-[26px] overflow-visible shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={pathData.area} fill={`url(#${fillId})`} />
      <path d={pathData.line} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pathData.last[0]} cy={pathData.last[1]} r="2.5" fill={stroke} />
    </svg>
  );
}

function DeltaPill({ value, invertGood = false }) {
  if (value === null || value === undefined) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-400">
        Baseline
      </span>
    );
  }
  const num = Number(value);
  const isUp = num >= 0;
  const good = invertGood ? !isUp : isUp;
  const cls = good
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
    : 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20';

  return (
    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${cls}`}>
      {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {isUp ? `+${num}%` : `${num}%`}
    </span>
  );
}

export default function KpiCards({ kpis, dailySeries = [], days, loading }) {
  if (loading || !kpis) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3.5">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div
            key={idx}
            className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800/90 rounded-[12px] p-4 h-[148px] animate-pulse flex flex-col justify-between"
          >
            <div className="h-3.5 w-24 bg-zinc-200 dark:bg-zinc-800 rounded" />
            <div className="h-7 w-28 bg-zinc-200 dark:bg-zinc-800 rounded" />
            <div className="h-3 w-36 bg-zinc-200 dark:bg-zinc-800 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const dauSpark = dailySeries.map((d) => d.dau);
  const reqSpark = dailySeries.map((d) => d.requests);
  const tokSpark = dailySeries.map((d) => d.total_tokens);

  const cacheHitPct = Math.min(100, Math.max(0, Number(kpis.cache_hit_rate_pct || 0)));
  const overagePct = Math.min(100, Math.max(0, Number(kpis.overage_share_pct || 0)));
  const regularPct = Math.max(0, +(100 - overagePct).toFixed(1));
  const longCtxPct = Math.min(100, Math.max(0, Number(kpis.long_context_pct || 0)));

  const cards = [
    {
      key: 'engineers',
      title: `Active Engineers (${days}D)`,
      value: formatFullNumber(kpis.active_users_period),
      delta: kpis.active_users_delta_pct,
      icon: Users,
      accentTop: 'from-blue-500/70 via-blue-500/20 to-transparent',
      iconCls: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
      visual: <MiniSparkline values={dauSpark} stroke="#3b82f6" fillId="spark-dau" />,
      footerPrimary: `DAU ${kpis.dau_latest} · WAU ${kpis.wau_latest} · ${kpis.stickiness_pct}% stickiness`,
      footerSecondary: `${kpis.active_projects || 1} active GCP project${(kpis.active_projects || 1) === 1 ? '' : 's'}`,
    },
    {
      key: 'velocity',
      title: 'Autonomous Velocity',
      value: formatCompactNumber(kpis.total_requests),
      unit: 'turns',
      delta: kpis.requests_delta_pct,
      icon: Zap,
      accentTop: 'from-violet-500/70 via-violet-500/20 to-transparent',
      iconCls: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
      visual: <MiniSparkline values={reqSpark} stroke="#8b5cf6" fillId="spark-req" />,
      footerPrimary: `${formatFullNumber(kpis.total_sessions)} trajectories · P50 ${kpis.p50_session_turns} / P90 ${kpis.p90_session_turns} turns`,
      footerSecondary: `${formatFullNumber(kpis.total_tool_calls)} tool executions (${kpis.tool_assisted_pct}% tool-assisted)`,
    },
    {
      key: 'tokens',
      title: 'Total Token Volume',
      value: formatCompactNumber(kpis.total_tokens),
      delta: kpis.tokens_delta_pct,
      icon: Cpu,
      accentTop: 'from-cyan-500/70 via-cyan-500/20 to-transparent',
      iconCls: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-400',
      visual: <MiniSparkline values={tokSpark} stroke="#06b6d4" fillId="spark-tok" />,
      footerPrimary: `${formatCompactNumber(kpis.cached_tokens)} cached · ${formatCompactNumber(kpis.output_tokens)} output`,
      footerSecondary: `${formatCompactNumber(kpis.thinking_tokens)} reasoning tokens (${kpis.thinking_share_pct}%)`,
    },
    {
      key: 'cache',
      title: 'Prompt Cache Efficiency',
      value: `${kpis.cache_hit_rate_pct}%`,
      badgeText: `${kpis.cost_avoidance_pct}% saved`,
      badgeCls:
        'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
      icon: Sparkles,
      accentTop: 'from-emerald-500/70 via-emerald-500/20 to-transparent',
      iconCls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
      bar: (
        <div className="w-full mt-2">
          <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${cacheHitPct}%` }}
            />
          </div>
        </div>
      ),
      footerPrimary: `Avoided ${formatCurrency(kpis.cache_savings_usd)} in uncached input spend`,
      footerSecondary: `${formatCompactNumber(kpis.uncached_prompt_tokens)} uncached prompt tokens billed`,
    },
    {
      key: 'context',
      title: 'Context Window Pressure',
      value: formatCompactNumber(kpis.p95_prompt_tokens),
      unit: 'P95',
      badgeText: `${kpis.long_context_pct}% >200K`,
      badgeCls:
        longCtxPct > 25
          ? 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
          : 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
      icon: Gauge,
      accentTop: 'from-amber-500/70 via-amber-500/20 to-transparent',
      iconCls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
      bar: (
        <div className="w-full mt-2">
          <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden flex">
            <div
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${Math.max(4, 100 - longCtxPct)}%` }}
            />
            <div
              className="h-full bg-amber-500 transition-all duration-500"
              style={{ width: `${longCtxPct}%` }}
            />
          </div>
        </div>
      ),
      footerPrimary: `Median P50 ${formatCompactNumber(kpis.p50_prompt_tokens)} · Peak ${formatCompactNumber(kpis.max_prompt_tokens)}`,
      footerSecondary: `${formatFullNumber(kpis.long_context_turns)} turns in >200K long-context SKU tier`,
    },
    {
      key: 'finops',
      title: 'Token Spend & Quota Mix',
      value: formatCurrency(kpis.estimated_cost_usd),
      delta: kpis.cost_delta_pct,
      invertDelta: true,
      icon: DollarSign,
      accentTop: 'from-rose-500/70 via-amber-500/20 to-transparent',
      iconCls: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400',
      bar: (
        <div className="w-full mt-2">
          <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              title={`Included Quota: ${regularPct}%`}
              style={{ width: `${regularPct}%` }}
            />
            <div
              className="h-full bg-amber-500 transition-all duration-500"
              title={`Overage Quota: ${overagePct}%`}
              style={{ width: `${overagePct}%` }}
            />
          </div>
        </div>
      ),
      footerPrimary: `${overagePct}% Overage (${formatCurrency(kpis.overage_cost_usd)}) · ${regularPct}% Included`,
      footerSecondary:
        kpis.invoice_net_usd > 0
          ? `GCP Invoice Net: ${formatCurrency(kpis.invoice_net_usd)} (${formatCurrency(kpis.invoice_subscription_usd)} seats)`
          : `${formatCurrency(kpis.avg_cost_per_active_user)} avg / active engineer`,
    },
  ];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3.5">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.key}
            className="relative overflow-hidden bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-[12px] p-4 shadow-sm transition-all duration-200 flex flex-col justify-between group"
          >
            <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${card.accentTop}`} />

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`p-1.5 rounded-[8px] shrink-0 ${card.iconCls}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 truncate">
                  {card.title}
                </span>
              </div>

              {card.badgeText ? (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border shrink-0 ${card.badgeCls}`}
                >
                  {card.badgeText}
                </span>
              ) : (
                <DeltaPill value={card.delta} invertGood={card.invertDelta} />
              )}
            </div>

            <div className="mt-2.5 flex items-end justify-between gap-2">
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span className="text-2xl font-extrabold font-mono tabular-nums tracking-tight text-zinc-950 dark:text-zinc-50">
                  {card.value}
                </span>
                {card.unit && (
                  <span className="text-[11px] font-mono font-medium text-zinc-400 dark:text-zinc-500">
                    {card.unit}
                  </span>
                )}
              </div>
              {card.visual}
            </div>

            {card.bar}

            <div className="mt-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/70 space-y-0.5">
              <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 truncate font-mono tabular-nums">
                {card.footerPrimary}
              </div>
              <div className="text-[10.5px] text-zinc-500 dark:text-zinc-500 truncate">
                {card.footerSecondary}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
