import React, { useState, useMemo } from 'react';
import {
  Search,
  Download,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
} from 'lucide-react';
import FilterDropdown from './FilterDropdown';
import MetricTooltip from './MetricTooltip';
import {
  formatCompactNumber,
  formatCurrency,
  formatReadableDate,
} from '../utils/formatters';

const PAGE_SIZE = 10;

const SORT_OPTIONS = [
  { value: 'total_tokens', label: 'Total Tokens' },
  { value: 'requests', label: 'Agent Turns' },
  { value: 'estimated_cost_usd', label: 'Token Spend ($)' },
  { value: 'cache_savings_usd', label: 'Cache Saved ($)' },
  { value: 'peak_context_tokens', label: 'Peak Context' },
  { value: 'cache_hit_rate_pct', label: 'Cache Hit %' },
  { value: 'active_days', label: 'Active Days' },
];

export default function DeveloperTable({
  users = [],
  selectedUserEmail,
  onSelectUser,
  onCrossFilter,
  loading = false,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('total_tokens');
  const [page, setPage] = useState(1);

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = users.filter((u) => {
      if (!q) return true;
      return (
        u.user_email?.toLowerCase().includes(q) ||
        u.top_provider?.toLowerCase().includes(q) ||
        u.primary_project?.toLowerCase().includes(q) ||
        u.primary_surface?.toLowerCase().includes(q) ||
        u.favorite_model?.toLowerCase().includes(q) ||
        u.top_effort?.toLowerCase().includes(q)
      );
    });

    return [...filtered].sort((a, b) => Number(b[sortBy] || 0) - Number(a[sortBy] || 0));
  }, [users, searchQuery, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredAndSorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const maxShare = useMemo(
    () => Math.max(1, ...users.map((u) => Number(u.token_share_pct || 0))),
    [users]
  );

  const handleExportCsv = () => {
    if (!filteredAndSorted.length) return;
    const headers = [
      'user_email',
      'primary_project',
      'primary_surface',
      'latest_client_version',
      'favorite_model',
      'top_provider',
      'top_effort',
      'active_days',
      'requests',
      'sessions',
      'tool_calls',
      'avg_tools_per_turn',
      'peak_context_tokens',
      'overage_share_pct',
      'total_tokens',
      'cache_hit_rate_pct',
      'cache_savings_usd',
      'estimated_cost_usd',
      'last_active_ts',
    ];
    const sanitizeCsvCell = (val) => {
      let str = String(val ?? '');
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      return `"${str.replace(/"/g, '""')}"`;
    };
    const csvLines = [
      headers.join(','),
      ...filteredAndSorted.map((row) =>
        headers.map((h) => sanitizeCsvCell(row[h])).join(',')
      ),
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'antigravity_real_org_usage.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] shadow-sm flex flex-col">
      <div className="relative z-20 p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Active Engineers — Attribution, Context &amp; Quota Leaderboard
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Click any engineer row to inspect daily token velocity, reasoning effort split, and autonomous trajectories
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="user-search"
              name="user-search"
              type="text"
              maxLength={80}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search engineer, model, project..."
              className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] pl-8 pr-3 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-zinc-950 dark:text-zinc-100 transition-all"
            />
          </div>

          <FilterDropdown
            label="Sort"
            value={sortBy}
            options={SORT_OPTIONS}
            includeAllOption={false}
            onChange={(val) => {
              setSortBy(val === 'ALL' ? 'total_tokens' : val);
              setPage(1);
            }}
          />

          <button
            type="button"
            disabled={loading || !filteredAndSorted.length}
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-3 py-1.5 text-xs font-semibold transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-zinc-100/90 dark:bg-zinc-900/95 z-10 text-zinc-500 dark:text-zinc-400 text-[11px] font-semibold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="py-3 px-4">Engineer Identity</th>
              <th className="py-3 px-3">Surface, Model &amp; Effort</th>
              <th className="py-3 px-3 text-right">Turns</th>
              <th className="py-3 px-3 text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  Peak Ctx
                  <MetricTooltip
                    title="Peak Prompt Context"
                    description="Largest single-turn prompt token context reached by this engineer. Highlighted in amber when exceeding the 200K long-context tier."
                    formula="MAX(prompt_tokens) in window"
                  />
                </span>
              </th>
              <th className="py-3 px-3 text-right">Total Tokens</th>
              <th className="py-3 px-3 w-32">
                <span className="inline-flex items-center gap-1">
                  Org Share
                  <MetricTooltip
                    title="Organization Token Share"
                    description="Proportion of total filtered organization token volume generated by this engineer."
                    formula="Engineer Tokens ÷ Filtered Org Tokens × 100"
                  />
                </span>
              </th>
              <th className="py-3 px-3 text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  Overage
                  <MetricTooltip
                    title="Overage Quota Turn %"
                    description="Percentage of this engineer's turns executed under OVERAGE_QUOTA (pay-as-you-go beyond seat allowance)."
                  />
                </span>
              </th>
              <th className="py-3 px-3 text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  Cache Hit
                  <MetricTooltip
                    title="Prompt Cache Hit Rate"
                    description="Share of input prompt tokens served from Antigravity context cache across this engineer's sessions."
                    benchmark="≥80% reflects efficient continuous trajectories."
                  />
                </span>
              </th>
              <th className="py-3 px-3 text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  Attr. Cost
                  <MetricTooltip
                    align="right"
                    title="Attributed Token Spend & Savings"
                    description="Estimated SKU token spend attributed to this engineer's usage, alongside prompt cache cost avoided."
                  />
                </span>
              </th>
              <th className="py-3 px-4 text-right">Last Active</th>
            </tr>
          </thead>

          <tbody className="text-xs divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {loading ? (
              Array.from({ length: 3 }).map((_, idx) => (
                <tr key={idx} className="animate-pulse">
                  <td colSpan={10} className="py-4 px-4">
                    <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-full" />
                  </td>
                </tr>
              ))
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-10 text-center text-zinc-500 dark:text-zinc-400">
                  No real telemetry events match the selected filter window.
                </td>
              </tr>
            ) : (
              pageRows.map((user) => {
                const isSelected = selectedUserEmail === user.user_email;
                const sharePct = Number(user.token_share_pct || 0);
                const barWidth = Math.min(100, Math.max(6, Math.round((sharePct / maxShare) * 100)));
                const barColor =
                  sharePct >= 45
                    ? 'bg-blue-500'
                    : sharePct >= 20
                    ? 'bg-violet-500'
                    : 'bg-emerald-500';
                const initials = (user.user_email || 'AG').slice(0, 2).toUpperCase();
                const isLongCtx = Number(user.peak_context_tokens || 0) > 200_000;

                return (
                  <tr
                    key={user.user_email}
                    onClick={() => onSelectUser(isSelected ? null : user.user_email)}
                    className={`cursor-pointer transition-colors duration-150 ${
                      isSelected
                        ? 'bg-blue-50/90 dark:bg-blue-950/40 hover:bg-blue-100/80 dark:hover:bg-blue-900/40'
                        : 'text-zinc-900 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900/60'
                    }`}
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white font-mono text-[10.5px] font-bold flex items-center justify-center shrink-0 shadow-sm">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-zinc-950 dark:text-zinc-100 truncate max-w-[210px]">
                            {user.user_email}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[10.5px] text-zinc-500 dark:text-zinc-400">
                            <button
                              type="button"
                              title="Click to filter by this GCP project"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onCrossFilter && user.primary_project) {
                                  onCrossFilter('project', user.primary_project);
                                }
                              }}
                              className="font-mono bg-zinc-100 hover:bg-blue-100 dark:bg-zinc-800 dark:hover:bg-blue-950/60 hover:text-blue-600 dark:hover:text-blue-400 rounded px-1.5 py-0.2 transition-colors"
                            >
                              {user.primary_project}
                            </button>
                            <span>·</span>
                            <span className="font-mono">{user.active_days}d active</span>
                            {user.latest_client_version && (
                              <>
                                <span>·</span>
                                <span className="font-mono">v{user.latest_client_version}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-3">
                      <div className="font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                        <span>{user.favorite_model}</span>
                        {user.top_effort && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400">
                            {user.top_effort.replace(' Effort', '')}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {user.primary_surface} · {user.top_provider}
                      </div>
                    </td>

                    <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                      <div className="font-medium">{Number(user.requests || 0).toLocaleString()}</div>
                      <div className="text-[10px] text-zinc-400">{user.avg_tools_per_turn || 0} tools/t</div>
                    </td>

                    <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                      <span
                        className={
                          isLongCtx
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : 'text-zinc-600 dark:text-zinc-300'
                        }
                      >
                        {formatCompactNumber(user.peak_context_tokens)}
                      </span>
                    </td>

                    <td className="py-3.5 px-3 text-right font-mono tabular-nums font-bold text-zinc-950 dark:text-zinc-100">
                      {formatCompactNumber(user.total_tokens)}
                    </td>

                    <td className="py-3.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${barColor} rounded-full transition-all duration-300`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <span className="font-mono tabular-nums text-[11px] text-zinc-500 dark:text-zinc-400 w-10 text-right">
                          {sharePct}%
                        </span>
                      </div>
                    </td>

                    <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                      <span
                        className={
                          Number(user.overage_share_pct) > 50
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : 'text-zinc-500 dark:text-zinc-400'
                        }
                      >
                        {user.overage_share_pct ?? 0}%
                      </span>
                    </td>

                    <td className="py-3.5 px-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">
                      {user.cache_hit_rate_pct}%
                    </td>

                    <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                      <div className="font-bold text-zinc-950 dark:text-zinc-50">
                        {formatCurrency(user.estimated_cost_usd)}
                      </div>
                      <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(user.cache_savings_usd, 0)} saved
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-right text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                      {formatReadableDate(user.last_active_ts)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          Showing{' '}
          <strong className="font-mono text-zinc-800 dark:text-zinc-200">
            {filteredAndSorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}
          </strong>
          –
          <strong className="font-mono text-zinc-800 dark:text-zinc-200">
            {Math.min(safePage * PAGE_SIZE, filteredAndSorted.length)}
          </strong>{' '}
          of{' '}
          <strong className="font-mono text-zinc-800 dark:text-zinc-200">
            {filteredAndSorted.length}
          </strong>{' '}
          active engineers
        </span>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="First page"
            disabled={safePage <= 1}
            onClick={() => setPage(1)}
            className="p-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Previous page"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="p-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {safePage} / {totalPages}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="p-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Last page"
            disabled={safePage >= totalPages}
            onClick={() => setPage(totalPages)}
            className="p-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
