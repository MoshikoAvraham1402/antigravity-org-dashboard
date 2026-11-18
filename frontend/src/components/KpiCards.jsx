import React, { useMemo } from 'react';
import {
  Users,
  Zap,
  Sparkles,
  DollarSign,
  Gauge,
  Scale,
  Brain,
  Receipt,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
} from 'lucide-react';
import MetricTooltip from './MetricTooltip';
import { formatCompactNumber, formatCurrency, formatFullNumber } from '../utils/formatters';

function MiniSparkline({ values = [], stroke = '#3b82f6', fillId = 'spark' }) {
  const pathData = useMemo(() => {
    const clean = values.map((v) => Number(v || 0));
    if (clean.length < 2) return null;
    const width = 98;
    const height = 30;
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const span = max - min || 1;

    const pts = clean.map((val, idx) => {
      const x = (idx / (clean.length - 1)) * (width - 4) + 2;
      const y = height - 4 - ((val - min) / span) * (height - 8);
      return [x, y];
    });

    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
    return { line, area, last: pts[pts.length - 1] };
  }, [values]);

  if (!pathData) return <div className="w-[98px] h-[30px] shrink-0" />;

  return (
    <svg viewBox="0 0 98 30" className="w-[98px] h-[30px] overflow-visible shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={pathData.area} fill={`url(#${fillId})`} />
      <path
        d={pathData.line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={pathData.last[0]} cy={pathData.last[1]} r="2.6" fill={stroke} />
    </svg>
  );
}

function DeltaPill({ value, invertGood = false }) {
  if (value === null || value === undefined) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-400 shrink-0">
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
    <span
      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border shrink-0 whitespace-nowrap ${cls}`}
    >
      {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {isUp ? `+${num}%` : `${num}%`}
    </span>
  );
}

export default function KpiCards({
  kpis,
  dailySeries = [],
  effortBreakdown = [],
  days,
  activeQuota = 'ALL',
  onToggleQuota,
  onJumpTab,
  loading,
}) {
  if (loading || !kpis) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800/90 rounded-[12px] p-4 h-[158px] animate-pulse flex flex-col justify-between"
            >
              <div className="h-3.5 w-32 bg-zinc-200 dark:bg-zinc-800 rounded" />
              <div className="h-8 w-36 bg-zinc-200 dark:bg-zinc-800 rounded" />
              <div className="h-3 w-full bg-zinc-200 dark:bg-zinc-800 rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800/90 rounded-[10px] p-3 h-[74px] animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  const dauSpark = dailySeries.map((d) => d.dau);
  const reqSpark = dailySeries.map((d) => d.requests);
  const costSpark = dailySeries.map((d) => d.estimated_cost_usd);

  const cacheHitPct = Math.min(100, Math.max(0, Number(kpis.cache_hit_rate_pct || 0)));
  const overagePct = Math.min(100, Math.max(0, Number(kpis.overage_share_pct || 0)));
  const regularPct = Math.max(0, +(100 - overagePct).toFixed(1));
  const longCtxPct = Math.min(100, Math.max(0, Number(kpis.long_context_pct || 0)));

  const highMaxTurns = effortBreakdown
    .filter((e) => e.key_id === 'Max Effort' || e.key_id === 'High Effort')
    .reduce((acc, e) => acc + Number(e.requests || 0), 0);
  const highMaxPct =
    kpis.total_requests > 0 ? Math.round((highMaxTurns / kpis.total_requests) * 1000) / 10 : 0;

  const heroCards = [
    {
      key: 'engineers',
      title: `Active Engineers · ${days}D`,
      value: formatFullNumber(kpis.active_users_period),
      unit: 'users',
      delta: kpis.active_users_delta_pct,
      icon: Users,
      accentTop: 'from-blue-500/80 via-blue-500/25 to-transparent',
      iconCls: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
      visual: <MiniSparkline values={dauSpark} stroke="#3b82f6" fillId="spark-dau" />,
      tooltip: {
        title: 'Active Engineers & Stickiness',
        description:
          'Distinct authenticated developer identities generating Antigravity inference turns within the selected window, compared against the prior window of equal length.',
        formula: 'Stickiness = Latest DAU ÷ Rolling 28d MAU × 100',
        benchmark: 'Healthy enterprise adoption sustains ≥45% DAU/MAU stickiness across engineering teams.',
      },
      row1Left: `DAU ${kpis.dau_latest} · 7d WAU ${kpis.wau_latest}`,
      row1Right: `${kpis.stickiness_pct}% stickiness`,
      row1RightCls: 'text-blue-600 dark:text-blue-400 font-semibold',
      row2Left: `${kpis.avg_daily_requests_per_user || 0} turns / user / day`,
      row2Right: `${kpis.active_projects || 1} GCP project${(kpis.active_projects || 1) === 1 ? '' : 's'}`,
    },
    {
      key: 'velocity',
      title: 'Autonomous Velocity',
      value: formatCompactNumber(kpis.total_requests),
      unit: 'turns',
      delta: kpis.requests_delta_pct,
      icon: Zap,
      accentTop: 'from-violet-500/80 via-violet-500/25 to-transparent',
      iconCls: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
      visual: <MiniSparkline values={reqSpark} stroke="#8b5cf6" fillId="spark-req" />,
      tooltip: {
        title: 'Autonomous Turn Velocity & Tool Execution',
        description:
          'Deduplicated model inference turns across IDE, Hub, and CLI surfaces, joined with ClientTelemetryLog tool execution counts per request.',
        formula: 'Tool-Assisted % = Turns with ≥1 Tool Call ÷ Total Turns',
        benchmark: '≥65% tool-assisted turns indicates deep agentic file editing & command execution vs. passive Q&A.',
      },
      row1Left: `${formatFullNumber(kpis.total_sessions)} trajectories`,
      row1Right: `P50 ${kpis.p50_session_turns} · P90 ${kpis.p90_session_turns} turns`,
      row1RightCls: 'text-violet-600 dark:text-violet-400 font-semibold',
      row2Left: `${formatCompactNumber(kpis.total_tool_calls)} tool calls`,
      row2Right: `${kpis.tool_assisted_pct}% tool-assisted`,
    },
    {
      key: 'cache',
      title: 'Cache & Token Efficiency',
      value: `${kpis.cache_hit_rate_pct}%`,
      unit: 'hit rate',
      badgeText: `${kpis.cost_avoidance_pct}% saved`,
      badgeCls:
        'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
      icon: Sparkles,
      accentTop: 'from-emerald-500/80 via-emerald-500/25 to-transparent',
      iconCls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
      bar: (
        <div className="w-full mt-2.5">
          <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${cacheHitPct}%` }}
            />
          </div>
        </div>
      ),
      tooltip: {
        title: 'Prompt Context Cache Efficiency',
        description:
          'Share of total input prompt tokens served from Antigravity context cache rather than re-billed at full uncached input rates.',
        formula: 'Hit Rate = Cached Tokens ÷ Total Prompt Tokens × 100',
        benchmark: 'Target ≥80% cache hit rate. Below 65% suggests frequent cold trajectories or mid-task model switching.',
      },
      row1Left: `${formatCompactNumber(kpis.total_tokens)} total tokens`,
      row1Right: `Avoided ${formatCurrency(kpis.cache_savings_usd, 0)}`,
      row1RightCls: 'text-emerald-600 dark:text-emerald-400 font-semibold',
      row2Left: `${formatCompactNumber(kpis.cached_tokens)} cached`,
      row2Right: `${formatCompactNumber(kpis.output_tokens)} out · ${formatCompactNumber(kpis.thinking_tokens)} think`,
    },
    {
      key: 'finops',
      title: 'Token Spend & Net Cost',
      value: formatCurrency(kpis.estimated_cost_usd),
      delta: kpis.cost_delta_pct,
      invertDelta: true,
      icon: DollarSign,
      accentTop: 'from-rose-500/80 via-amber-500/25 to-transparent',
      iconCls: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400',
      visual: <MiniSparkline values={costSpark} stroke="#f43f5e" fillId="spark-cost" />,
      tooltip: {
        title: 'Estimated Token Spend & Cloud Billing Net',
        description:
          'Token-level SKU valuation (uncached input, cached input, output, and reasoning tokens) alongside reconciled GCP Cloud Billing net invoice totals when linked.',
        formula: 'Spend = Σ (Token Bucket × Model Pricing Rate per 1M)',
        benchmark: 'Monitor Overage % to balance committed seat subscriptions against pay-as-you-go burst usage.',
      },
      row1Left: `${regularPct}% Included`,
      row1Right: `${overagePct}% Overage (${formatCurrency(kpis.overage_cost_usd, 0)})`,
      row1RightCls:
        overagePct > 30
          ? 'text-amber-600 dark:text-amber-400 font-semibold'
          : 'text-zinc-700 dark:text-zinc-300 font-semibold',
      row2Left: kpis.invoice_net_usd > 0 ? 'GCP Invoice Net' : 'Avg / Active Engineer',
      row2Right:
        kpis.invoice_net_usd > 0
          ? `${formatCurrency(kpis.invoice_net_usd)} (${formatCurrency(kpis.invoice_subscription_usd, 0)} seats)`
          : formatCurrency(kpis.avg_cost_per_active_user),
    },
  ];

  return (
    <section className="space-y-3" aria-label="Executive Key Performance Indicators">
      {/* Tier 1: 4 Spacious Executive Hero Cards (Zero Truncation) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {heroCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.key}
              className="relative bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-[12px] p-4 shadow-sm transition-all duration-200 flex flex-col justify-between"
            >
              <div className={`absolute inset-x-0 top-0 h-[2px] rounded-t-[12px] bg-gradient-to-r ${card.accentTop}`} />

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className={`p-1.5 rounded-[8px] shrink-0 ${card.iconCls}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                    {card.title}
                  </span>
                  <MetricTooltip {...card.tooltip} />
                </div>

                {card.badgeText ? (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border shrink-0 whitespace-nowrap ${card.badgeCls}`}
                  >
                    {card.badgeText}
                  </span>
                ) : (
                  <DeltaPill value={card.delta} invertGood={card.invertDelta} />
                )}
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-[26px] leading-none font-extrabold font-mono tabular-nums tracking-tight text-zinc-950 dark:text-zinc-50 whitespace-nowrap">
                    {card.value}
                  </span>
                  {card.unit && (
                    <span className="text-[11px] font-mono font-medium text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
                      {card.unit}
                    </span>
                  )}
                </div>
                {card.visual}
              </div>

              {card.bar}

              <div className="mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/70 space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                  <span className="text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{card.row1Left}</span>
                  <span className={`whitespace-nowrap ${card.row1RightCls || 'text-zinc-700 dark:text-zinc-300'}`}>
                    {card.row1Right}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[10.5px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                  <span className="whitespace-nowrap">{card.row2Left}</span>
                  <span className="whitespace-nowrap">{card.row2Right}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tier 2: Secondary Diagnostic Telemetry Strip with Quick Cross-Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {/* Tile 1: Context Window Pressure */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/85 dark:border-zinc-800/90 hover:border-amber-400/60 dark:hover:border-amber-500/40 rounded-[10px] px-3.5 py-2.5 shadow-sm transition-all flex flex-col justify-between group">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                Context Window (P95)
              </span>
              <MetricTooltip
                title="Context Window Pressure & >200K Tier"
                description="95th-percentile prompt token size across turns. Prompts exceeding 200,000 tokens enter long-context pricing tiers on flagship models."
                formula=">200K Share = Turns(prompt_tokens > 200K) ÷ Total Turns"
                benchmark="Keep >200K turns below 15% by encouraging /compact on long coding trajectories."
              />
            </div>
            <span
              className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold whitespace-nowrap ${
                longCtxPct > 20
                  ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
                  : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              {kpis.long_context_pct}% &gt;200K
            </span>
          </div>

          <button
            type="button"
            onClick={() => onJumpTab && onJumpTab('trajectories')}
            className="mt-1.5 w-full flex items-center justify-between gap-2 font-mono tabular-nums text-left focus:outline-none"
          >
            <span className="flex items-baseline gap-1.5">
              <span className="text-sm font-extrabold text-zinc-950 dark:text-zinc-50">
                {formatCompactNumber(kpis.p95_prompt_tokens)}
              </span>
              <span className="text-[10.5px] text-zinc-500 whitespace-nowrap">
                P50 {formatCompactNumber(kpis.p50_prompt_tokens)} · Max {formatCompactNumber(kpis.max_prompt_tokens)}
              </span>
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-amber-500 transition-colors shrink-0" />
          </button>
        </div>

        {/* Tile 2: Interactive Quota Mix Filter */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/85 dark:border-zinc-800/90 rounded-[10px] px-3.5 py-2.5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Scale className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                Quota Consumption Mix
              </span>
              <MetricTooltip
                title="Included Subscription vs. Overage Quota"
                description="Splits turns served under monthly per-seat subscription allowance (REGULAR_QUOTA) vs. pay-as-you-go overage (OVERAGE_QUOTA). Click either pill to filter."
                formula="Overage % = OVERAGE_QUOTA Turns ÷ Total Turns × 100"
                benchmark="Click Included or Overage below to isolate quota behavior across engineers & projects."
              />
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  onToggleQuota && onToggleQuota(activeQuota === 'REGULAR_QUOTA' ? 'ALL' : 'REGULAR_QUOTA')
                }
                className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold border transition-colors whitespace-nowrap ${
                  activeQuota === 'REGULAR_QUOTA'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
                }`}
              >
                {regularPct}% Incl
              </button>
              <button
                type="button"
                onClick={() =>
                  onToggleQuota && onToggleQuota(activeQuota === 'OVERAGE_QUOTA' ? 'ALL' : 'OVERAGE_QUOTA')
                }
                className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold border transition-colors whitespace-nowrap ${
                  activeQuota === 'OVERAGE_QUOTA'
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
                }`}
              >
                {overagePct}% Ovg
              </button>
            </div>
          </div>

          <div className="mt-2 space-y-1">
            <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden flex">
              <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${regularPct}%` }} />
              <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${overagePct}%` }} />
            </div>
          </div>
        </div>

        {/* Tile 3: Reasoning Effort & Thinking Intensity */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/85 dark:border-zinc-800/90 hover:border-violet-400/60 dark:hover:border-violet-500/40 rounded-[10px] px-3.5 py-2.5 shadow-sm transition-all flex flex-col justify-between group">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                Reasoning Effort Depth
              </span>
              <MetricTooltip
                title="High/Max Effort & Extended Thinking Share"
                description="Tracks deep multi-step reasoning effort tiers (experience metadata) and internal chain-of-thought token share across models."
                formula="Thinking Share = Reasoning Tokens ÷ Total Tokens × 100"
                benchmark="Reserve High/Max effort for complex architecture, debugging, and multi-file refactors."
              />
            </div>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20 whitespace-nowrap">
              {highMaxPct}% High/Max
            </span>
          </div>

          <button
            type="button"
            onClick={() => onJumpTab && onJumpTab('models')}
            className="mt-1.5 w-full flex items-center justify-between gap-2 font-mono tabular-nums text-left focus:outline-none"
          >
            <span className="flex items-baseline gap-1.5">
              <span className="text-sm font-extrabold text-zinc-950 dark:text-zinc-50">
                {formatCompactNumber(kpis.thinking_tokens)}
              </span>
              <span className="text-[10.5px] text-zinc-500 whitespace-nowrap">
                reasoning tok ({kpis.thinking_share_pct}% of volume)
              </span>
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-violet-500 transition-colors shrink-0" />
          </button>
        </div>

        {/* Tile 4: Per-Seat Unit Economics */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/85 dark:border-zinc-800/90 hover:border-emerald-400/60 dark:hover:border-emerald-500/40 rounded-[10px] px-3.5 py-2.5 shadow-sm transition-all flex flex-col justify-between group">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                Unit Economics · {days}D
              </span>
              <MetricTooltip
                align="right"
                title="Per-Engineer Unit Spend & Cache ROI"
                description="Average token inference spend per active engineer in the selected period, paired with uncached input spend avoided via prompt caching."
                formula="Unit Spend = Estimated Token Spend ÷ Active Engineers"
                benchmark="Compare per-engineer token value delivered against monthly seat license cost."
              />
            </div>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20 whitespace-nowrap">
              {kpis.avg_tools_per_turn} tools/turn
            </span>
          </div>

          <button
            type="button"
            onClick={() => onJumpTab && onJumpTab('finops')}
            className="mt-1.5 w-full flex items-center justify-between gap-2 font-mono tabular-nums text-left focus:outline-none"
          >
            <span className="flex items-baseline gap-1.5">
              <span className="text-sm font-extrabold text-zinc-950 dark:text-zinc-50">
                {formatCurrency(kpis.avg_cost_per_active_user)}
              </span>
              <span className="text-[10.5px] text-zinc-500 whitespace-nowrap">
                / user · <span className="text-emerald-600 dark:text-emerald-400">+{formatCurrency(kpis.cache_savings_usd, 0)} saved</span>
              </span>
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-emerald-500 transition-colors shrink-0" />
          </button>
        </div>
      </div>
    </section>
  );
}
