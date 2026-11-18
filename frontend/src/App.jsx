import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import {
  Activity,
  Sun,
  Moon,
  RefreshCw,
  Radio,
  AlertCircle,
  Shield,
  CheckCircle2,
  Clock,
  Lock,
  LayoutDashboard,
  Cpu,
  Receipt,
  GitBranch,
  RotateCcw,
  Filter,
  X,
} from 'lucide-react';
import FilterDropdown from './components/FilterDropdown';
import KpiCards from './components/KpiCards';
import InsightsBanner from './components/InsightsBanner';
import ChartsSection from './components/ChartsSection';
import ModelsAndFleetView from './components/ModelsAndFleetView';
import FinOpsBillingView from './components/FinOpsBillingView';
import TrajectoriesView from './components/TrajectoriesView';
import DeveloperTable from './components/DeveloperTable';
import DeveloperDrawer from './components/DeveloperDrawer';
import SinkSetupModal from './components/SinkSetupModal';
import EmptyOnboardingBanner from './components/EmptyOnboardingBanner';
import { formatReadableDate, formatTimestamp, formatClockTime } from './utils/formatters';

const apiClient = axios.create({
  headers: {
    'X-Requested-With': 'AntigravityDashboard',
  },
});

const DATE_RANGES = [
  { value: 7, label: '7D' },
  { value: 14, label: '14D' },
  { value: 30, label: '30D' },
  { value: 90, label: '90D' },
];

const WORKSPACE_TABS = [
  { id: 'overview', label: 'Executive Overview', icon: LayoutDashboard },
  { id: 'models', label: 'Models, Effort & Fleet', icon: Cpu },
  { id: 'finops', label: 'FinOps & Cloud Billing', icon: Receipt },
  { id: 'trajectories', label: 'Engineers & Trajectories', icon: GitBranch },
];

export default function App() {
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('ag_dashboard_theme');
      return saved ? saved === 'dark' : true;
    } catch {
      return true;
    }
  });
  const [activeTab, setActiveTab] = useState('overview');

  const [days, setDays] = useState(30);
  const [project, setProject] = useState('ALL');
  const [surface, setSurface] = useState('ALL');
  const [model, setModel] = useState('ALL');
  const [provider, setProvider] = useState('ALL');
  const [quota, setQuota] = useState('ALL');
  const [effort, setEffort] = useState('ALL');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncToast, setSyncToast] = useState(null);
  const [error, setError] = useState(null);

  const [selectedUserEmail, setSelectedUserEmail] = useState(null);
  const [userDrilldown, setUserDrilldown] = useState(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  const [sinkModalOpen, setSinkModalOpen] = useState(false);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('ag_dashboard_theme', darkMode ? 'dark' : 'light');
    } catch {
      // ignore storage failure
    }
  }, [darkMode]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/api/dashboard', {
        params: {
          days,
          project,
          surface,
          model,
          provider,
          quota,
          effort,
        },
      });
      setData(res.data);
      setLastSyncedAt(res.data?.meta?.generated_at || new Date().toISOString());
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) {
        setError('Rate limit reached. Please wait a few seconds before retrying.');
      } else if (status === 401 || status === 403) {
        setError('Access denied. Please verify your session or security headers.');
      } else {
        const detail = err?.response?.data?.detail || 'Failed to load dashboard telemetry.';
        setError(detail);
      }
    } finally {
      setLoading(false);
    }
  }, [days, project, surface, model, provider, quota, effort]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const handleSyncData = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await apiClient.post('/api/sync', null, {
        params: {
          days,
          project,
          surface,
          model,
          provider,
          quota,
          effort,
        },
      });
      const syncedPayload = res.data?.dashboard;
      if (syncedPayload) {
        setData(syncedPayload);
      }
      const syncedIso = res.data?.synced_at || new Date().toISOString();
      setLastSyncedAt(syncedIso);

      if (selectedUserEmail) {
        setDrilldownLoading(true);
        apiClient
          .get(`/api/users/${encodeURIComponent(selectedUserEmail)}`, {
            params: { days },
          })
          .then((uRes) => setUserDrilldown(uRes.data))
          .catch(() => {})
          .finally(() => setDrilldownLoading(false));
      }

      const deltaCount = Number(res.data?.delta_logs_ingested || 0);
      const msg =
        deltaCount > 0
          ? `Synced +${deltaCount} new Cloud Logging event${deltaCount === 1 ? '' : 's'}`
          : 'Synced latest live BigQuery & Cloud Logging data';
      setSyncToast(msg);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setSyncToast(null), 4500);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) {
        setError('Sync cooldown active. Please wait a few seconds before syncing again.');
      } else {
        const detail = err?.response?.data?.detail || 'Failed to sync latest telemetry.';
        setError(detail);
      }
    } finally {
      setSyncing(false);
    }
  }, [days, project, surface, model, provider, quota, effort, selectedUserEmail]);

  useEffect(() => {
    if (!selectedUserEmail) {
      setUserDrilldown(null);
      return;
    }
    let cancelled = false;
    setDrilldownLoading(true);
    apiClient
      .get(`/api/users/${encodeURIComponent(selectedUserEmail)}`, {
        params: { days },
      })
      .then((res) => {
        if (!cancelled) setUserDrilldown(res.data);
      })
      .catch(() => {
        if (!cancelled) setUserDrilldown(null);
      })
      .finally(() => {
        if (!cancelled) setDrilldownLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedUserEmail, days]);

  const selectedUserSummary = useMemo(
    () => data?.users?.find((u) => u.user_email === selectedUserEmail) || null,
    [data, selectedUserEmail]
  );

  const meta = data?.meta;
  const sinkStatus = meta?.sink_status || {};
  const hasLiveSinkRows = Number(sinkStatus.live_resp_rows || 0) > 0;
  const hasAnyRows = hasLiveSinkRows || Number(sinkStatus.hist_rows || 0) > 0 || Number(data?.kpis?.total_requests || 0) > 0;

  const sinkBadgeCls = hasLiveSinkRows
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
    : hasAnyRows
    ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/60 hover:bg-blue-100 dark:hover:bg-blue-900/40'
    : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-900/40';
  const sinkBadgeLabel = hasLiveSinkRows
    ? 'Live Sink Active'
    : hasAnyRows
    ? 'Telemetry Connected'
    : 'Setup Needed · 0 Events';

  const activeFilters = useMemo(
    () => ({ project, surface, model, provider, quota, effort }),
    [project, surface, model, provider, quota, effort]
  );

  const handleCrossFilter = useCallback((dim, val) => {
    if (!val) return;
    if (dim === 'project') setProject((prev) => (prev === val ? 'ALL' : val));
    else if (dim === 'surface') setSurface((prev) => (prev === val ? 'ALL' : val));
    else if (dim === 'model') setModel((prev) => (prev === val ? 'ALL' : val));
    else if (dim === 'provider') setProvider((prev) => (prev === val ? 'ALL' : val));
    else if (dim === 'quota') setQuota((prev) => (prev === val ? 'ALL' : val));
    else if (dim === 'effort') setEffort((prev) => (prev === val ? 'ALL' : val));
  }, []);

  const hasActiveFilters =
    project !== 'ALL' ||
    surface !== 'ALL' ||
    model !== 'ALL' ||
    provider !== 'ALL' ||
    quota !== 'ALL' ||
    effort !== 'ALL';

  const resetAllFilters = useCallback(() => {
    setProject('ALL');
    setSurface('ALL');
    setModel('ALL');
    setProvider('ALL');
    setQuota('ALL');
    setEffort('ALL');
  }, []);

  const activeFilterChips = useMemo(() => {
    const chips = [];
    if (project !== 'ALL') {
      chips.push({ key: 'project', dimLabel: 'Project', display: project, onClear: () => setProject('ALL') });
    }
    if (surface !== 'ALL') {
      chips.push({ key: 'surface', dimLabel: 'Surface', display: surface, onClear: () => setSurface('ALL') });
    }
    if (model !== 'ALL') {
      const mLabel =
        (meta?.available_models || []).find((m) => (typeof m === 'string' ? m === model : m.value === model))?.label ||
        model;
      chips.push({ key: 'model', dimLabel: 'Model', display: mLabel, onClear: () => setModel('ALL') });
    }
    if (provider !== 'ALL') {
      chips.push({ key: 'provider', dimLabel: 'Provider', display: provider, onClear: () => setProvider('ALL') });
    }
    if (quota !== 'ALL') {
      const qLabel =
        (meta?.available_quotas || []).find((q) => q.value === quota)?.label || quota;
      chips.push({ key: 'quota', dimLabel: 'Quota', display: qLabel, onClear: () => setQuota('ALL') });
    }
    if (effort !== 'ALL') {
      chips.push({ key: 'effort', dimLabel: 'Effort', display: effort, onClear: () => setEffort('ALL') });
    }
    return chips;
  }, [project, surface, model, provider, quota, effort, meta]);

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 transition-colors duration-200">
      {/* Sticky Executive Command Bar */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-white/85 dark:bg-[#09090b]/85 border-b border-zinc-200/90 dark:border-zinc-800/90">
        <div className="max-w-[1640px] mx-auto px-4 sm:px-6 py-3.5 flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm shrink-0">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50">
                  Antigravity Organization Intelligence
                </h1>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-zinc-200/70 dark:bg-zinc-800/90 text-zinc-700 dark:text-zinc-300">
                  {meta?.org_id ? `org/${meta.org_id}` : `project/${meta?.project_id || 'gcp'}`}
                </span>
                <button
                  type="button"
                  onClick={() => setSinkModalOpen(true)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${sinkBadgeCls}`}
                >
                  <Radio className={`w-3 h-3 ${hasAnyRows ? 'animate-pulse' : ''}`} />
                  {sinkBadgeLabel}
                </button>
                {meta?.viewer_email && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-zinc-100 text-zinc-700 border border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800">
                    <Lock className="w-3 h-3 text-emerald-500 shrink-0" />
                    IAP · {meta.viewer_email}
                  </span>
                )}
                {syncToast && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/60">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                    {syncToast}
                  </span>
                )}
              </div>

              <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400 mt-0.5 flex flex-wrap items-center gap-2">
                {meta?.org_domain ? (
                  <span>
                    Domain <strong className="font-mono text-zinc-700 dark:text-zinc-300">{meta.org_domain}</strong>
                  </span>
                ) : (
                  <span>
                    Project <strong className="font-mono text-zinc-700 dark:text-zinc-300">{meta?.project_id || 'gcp'}</strong>
                  </span>
                )}
                {meta?.date_from && meta?.date_to && (
                  <>
                    <span>·</span>
                    <span>
                      Window: <strong className="font-medium text-zinc-700 dark:text-zinc-300">{formatReadableDate(meta.date_from)}</strong> –{' '}
                      <strong className="font-medium text-zinc-700 dark:text-zinc-300">{formatReadableDate(meta.date_to)}</strong>
                    </span>
                  </>
                )}
                {meta?.latest_event_ts && (
                  <>
                    <span>·</span>
                    <span>
                      Latest turn: <strong className="font-mono text-zinc-700 dark:text-zinc-300">{formatTimestamp(meta.latest_event_ts)}</strong>
                    </span>
                  </>
                )}
                {lastSyncedAt && (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3 text-zinc-400" />
                      Synced <strong className="font-mono text-zinc-700 dark:text-zinc-300">{formatClockTime(lastSyncedAt)}</strong>
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex bg-zinc-200/70 dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 p-0.5 rounded-[8px]">
              {DATE_RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  disabled={loading || syncing}
                  onClick={() => setDays(r.value)}
                  className={`px-2.5 py-1.5 rounded-[6px] text-xs font-mono font-semibold transition-all disabled:opacity-50 ${
                    days === r.value
                      ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <FilterDropdown
              label="Project"
              value={project}
              options={meta?.available_projects || []}
              onChange={setProject}
              disabled={loading || syncing}
            />

            <FilterDropdown
              label="Surface"
              value={surface}
              options={meta?.available_surfaces || []}
              onChange={setSurface}
              disabled={loading || syncing}
            />

            <FilterDropdown
              label="Model"
              value={model}
              options={meta?.available_models || []}
              onChange={setModel}
              disabled={loading || syncing}
            />

            <FilterDropdown
              label="Provider"
              value={provider}
              options={meta?.available_providers || []}
              onChange={setProvider}
              disabled={loading || syncing}
            />

            <FilterDropdown
              label="Quota"
              value={quota}
              options={meta?.available_quotas || []}
              onChange={setQuota}
              disabled={loading || syncing}
            />

            <FilterDropdown
              label="Effort"
              value={effort}
              options={meta?.available_efforts || []}
              onChange={setEffort}
              disabled={loading || syncing}
            />

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-[8px] text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            )}

            <button
              type="button"
              disabled={loading || syncing}
              onClick={handleSyncData}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[8px] bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold transition-all shadow-sm disabled:opacity-55 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : 'Sync Data'}</span>
            </button>

            <button
              type="button"
              aria-label="Toggle color theme"
              onClick={() => setDarkMode((prev) => !prev)}
              className="p-2 rounded-[8px] bg-white dark:bg-[#0c0c0f] hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors shadow-sm"
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-zinc-700" />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1640px] mx-auto px-4 sm:px-6 py-5 space-y-5">
        {error && (
          <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 text-rose-800 dark:text-rose-300 rounded-lg p-4 flex items-start gap-3 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <div>
              <div className="font-semibold">Request Blocked or Failed</div>
              <div className="text-xs mt-1 font-mono opacity-90">{error}</div>
            </div>
          </div>
        )}

        {/* Active Cross-Filter Pill Ribbon */}
        {activeFilterChips.length > 0 && (
          <div className="bg-blue-50/75 dark:bg-blue-950/25 border border-blue-200/80 dark:border-blue-800/60 rounded-[10px] px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                <Filter className="w-3.5 h-3.5" />
                Active Cross-Filters:
              </span>
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onClear}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-blue-200 dark:border-blue-800 hover:border-rose-400 dark:hover:border-rose-500 transition-colors shadow-sm"
                >
                  <span className="text-zinc-400 dark:text-zinc-500">{chip.dimLabel}:</span>
                  <span className="font-mono font-semibold">{chip.display}</span>
                  <X className="w-3 h-3 text-zinc-400 hover:text-rose-500" />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={resetAllFilters}
              className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
            >
              Clear all filters
            </button>
          </div>
        )}

        {/* Two-Tier Executive KPI Strip (Zero Truncation + Tooltips + Quick Filters) */}
        <KpiCards
          kpis={data?.kpis}
          dailySeries={data?.daily_series || []}
          effortBreakdown={data?.effort_breakdown || []}
          days={days}
          activeQuota={quota}
          onToggleQuota={setQuota}
          onJumpTab={setActiveTab}
          loading={loading}
        />

        {!loading && !error && data?.kpis?.total_requests === 0 && (
          <EmptyOnboardingBanner meta={meta} onOpenSinkModal={() => setSinkModalOpen(true)} />
        )}

        {/* Real-Time Data-Driven Executive Insights */}
        <InsightsBanner
          kpis={data?.kpis}
          clientVersions={data?.client_version_breakdown || []}
          effortBreakdown={data?.effort_breakdown || []}
          onJumpTab={setActiveTab}
          loading={loading}
        />

        {/* Segmented Workspace Navigation Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800/90 pb-3">
          <nav
            aria-label="Dashboard Workspaces"
            className="inline-flex flex-wrap gap-1 bg-zinc-200/60 dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 p-1 rounded-[10px]"
          >
            {WORKSPACE_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const badgeCount =
                tab.id === 'models'
                  ? data?.model_breakdown?.length
                  : tab.id === 'finops'
                  ? data?.billing_skus?.length
                  : tab.id === 'trajectories'
                  ? data?.users?.length
                  : null;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-[8px] text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-sm'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-600 dark:text-blue-400' : ''}`} />
                  <span>{tab.label}</span>
                  {badgeCount !== null && badgeCount !== undefined && (
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.2 rounded-full ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                          : 'bg-zinc-200/80 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 hidden md:block">
            100% Real GCP Telemetry · Click Charts to Cross-Filter · Hover (?) for Formulas
          </div>
        </div>

        {/* Active Workspace Content */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            <ChartsSection
              dailySeries={data?.daily_series || []}
              modelBreakdown={data?.model_breakdown || []}
              effortBreakdown={data?.effort_breakdown || []}
              surfaceBreakdown={data?.surface_breakdown || []}
              projectBreakdown={data?.project_breakdown || []}
              heatmap={data?.activity_heatmap || []}
              timezone={meta?.org_timezone || 'UTC'}
              activeFilters={activeFilters}
              onCrossFilter={handleCrossFilter}
              darkMode={darkMode}
              loading={loading}
            />

            <section className="flex flex-col lg:flex-row gap-5 items-start">
              <div
                className={`w-full transition-all duration-300 ${
                  selectedUserSummary ? 'lg:w-2/3' : 'lg:w-full'
                }`}
              >
                <DeveloperTable
                  users={data?.users || []}
                  selectedUserEmail={selectedUserEmail}
                  onSelectUser={setSelectedUserEmail}
                  onCrossFilter={handleCrossFilter}
                  loading={loading}
                />
              </div>

              {selectedUserSummary && (
                <div className="w-full lg:w-1/3 transition-all duration-300">
                  <DeveloperDrawer
                    userSummary={selectedUserSummary}
                    drilldown={userDrilldown}
                    loading={drilldownLoading}
                    darkMode={darkMode}
                    onClose={() => setSelectedUserEmail(null)}
                  />
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'models' && (
          <ModelsAndFleetView
            modelBreakdown={data?.model_breakdown || []}
            effortBreakdown={data?.effort_breakdown || []}
            quotaBreakdown={data?.quota_breakdown || []}
            clientVersions={data?.client_version_breakdown || []}
            projectBreakdown={data?.project_breakdown || []}
            activeFilters={activeFilters}
            onCrossFilter={handleCrossFilter}
            darkMode={darkMode}
            loading={loading}
          />
        )}

        {activeTab === 'finops' && (
          <FinOpsBillingView
            kpis={data?.kpis}
            meta={meta}
            dailySeries={data?.daily_series || []}
            billingSkus={data?.billing_skus || []}
            darkMode={darkMode}
            loading={loading}
          />
        )}

        {activeTab === 'trajectories' && (
          <div className="space-y-5">
            <TrajectoriesView
              kpis={data?.kpis}
              trajectories={data?.top_trajectories || []}
              onSelectUser={(email) => setSelectedUserEmail(email)}
              loading={loading}
            />

            <section className="flex flex-col lg:flex-row gap-5 items-start">
              <div
                className={`w-full transition-all duration-300 ${
                  selectedUserSummary ? 'lg:w-2/3' : 'lg:w-full'
                }`}
              >
                <DeveloperTable
                  users={data?.users || []}
                  selectedUserEmail={selectedUserEmail}
                  onSelectUser={setSelectedUserEmail}
                  onCrossFilter={handleCrossFilter}
                  loading={loading}
                />
              </div>

              {selectedUserSummary && (
                <div className="w-full lg:w-1/3 transition-all duration-300">
                  <DeveloperDrawer
                    userSummary={selectedUserSummary}
                    drilldown={userDrilldown}
                    loading={drilldownLoading}
                    darkMode={darkMode}
                    onClose={() => setSelectedUserEmail(null)}
                  />
                </div>
              )}
            </section>
          </div>
        )}

        <footer className="pt-4 border-t border-zinc-200 dark:border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-500">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
            <span>
              {meta?.viewer_email ? 'Zero-Trust IAP Runtime' : 'Hardened Cloud Run Runtime'} · Least-Privilege SA · 150MB Scan Cap · Prompt &amp; code payloads excluded.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSinkModalOpen(true)}
            className="text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
          >
            View Pipeline &amp; Security Posture
          </button>
        </footer>
      </main>

      <SinkSetupModal
        open={sinkModalOpen}
        onClose={() => setSinkModalOpen(false)}
        meta={meta}
      />
    </div>
  );
}
