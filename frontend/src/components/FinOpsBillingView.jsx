import React, { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { Receipt, Sparkles, CreditCard, BadgePercent, Search, Download } from 'lucide-react';
import MetricTooltip from './MetricTooltip';
import {
  formatCompactNumber,
  formatCurrency,
  formatShortDate,
  formatReadableDate,
} from '../utils/formatters';
import { downloadCsv } from '../utils/csv';

export default function FinOpsBillingView({
  kpis,
  meta,
  dailySeries = [],
  billingSkus = [],
  darkMode,
  loading,
}) {
  const [skuSearch, setSkuSearch] = useState('');

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

  const finopsChartOption = useMemo(() => {
    const dates = dailySeries.map((d) => formatShortDate(d.date));
    return {
      color: ['#f43f5e', '#10b981', '#3b82f6'],
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
            <div style="font-weight:700;margin-bottom:5px">${formatReadableDate(pt.date)}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.6">
              <span style="color:#f43f5e">●</span> Estimated Token Cost: <b>${formatCurrency(pt.estimated_cost_usd)}</b><br/>
              <span style="color:#10b981">●</span> Avoided via Prompt Cache: <b>${formatCurrency(pt.cache_savings_usd)}</b><br/>
              <span style="color:#3b82f6">●</span> Cache Hit Rate: <b>${pt.cache_hit_rate_pct}%</b>
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
      grid: { left: 54, right: 48, top: 48, bottom: 26 },
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
          name: 'USD ($)',
          nameTextStyle: { color: themeTokens.axisColor, fontSize: 10 },
          splitLine: { lineStyle: { color: themeTokens.gridBorder, type: 'dashed' } },
          axisLabel: {
            color: themeTokens.axisColor,
            fontSize: 11,
            fontFamily: '"JetBrains Mono", monospace',
            formatter: (v) => `$${formatCompactNumber(v)}`,
          },
        },
        {
          type: 'value',
          name: 'Hit %',
          min: 0,
          max: 100,
          nameTextStyle: { color: themeTokens.axisColor, fontSize: 10 },
          splitLine: { show: false },
          axisLabel: {
            color: themeTokens.axisColor,
            fontSize: 11,
            fontFamily: '"JetBrains Mono", monospace',
            formatter: (v) => `${v}%`,
          },
        },
      ],
      series: [
        {
          name: 'Estimated Token Spend ($)',
          type: 'bar',
          yAxisIndex: 0,
          barMaxWidth: 16,
          itemStyle: { color: '#f43f5e', borderRadius: [3, 3, 0, 0] },
          data: dailySeries.map((d) => d.estimated_cost_usd),
        },
        {
          name: 'Avoided Cache Spend ($)',
          type: 'bar',
          yAxisIndex: 0,
          barMaxWidth: 16,
          itemStyle: { color: '#10b981', borderRadius: [3, 3, 0, 0] },
          data: dailySeries.map((d) => d.cache_savings_usd),
        },
        {
          name: 'Cache Hit %',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: '#3b82f6' },
          data: dailySeries.map((d) => d.cache_hit_rate_pct),
        },
      ],
    };
  }, [dailySeries, themeTokens]);

  const filteredSkus = useMemo(() => {
    const q = skuSearch.trim().toLowerCase();
    if (!q) return billingSkus;
    return billingSkus.filter(
      (s) =>
        s.sku_description?.toLowerCase().includes(q) ||
        s.service_name?.toLowerCase().includes(q) ||
        s.billing_category?.toLowerCase().includes(q)
    );
  }, [billingSkus, skuSearch]);

  const maxGrossSku = useMemo(
    () => Math.max(1, ...billingSkus.map((s) => Number(s.gross_cost_usd || 0))),
    [billingSkus]
  );

  if (loading || !kpis) {
    return <div className="h-[520px] bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-[12px] animate-pulse" />;
  }

  return (
    <div className="space-y-5">
      {/* 4 FinOps Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <Receipt className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="whitespace-nowrap">GCP Invoice Gross Spend</span>
            <MetricTooltip
              title="GCP Cloud Billing Gross Spend"
              description="Pre-discount invoice cost from your linked Cloud Billing BigQuery export table across Subscription Seat SKUs and Model Inference SKUs."
              formula="SUM(cost) across AI & Gemini Enterprise SKUs"
            />
          </div>
          <div className="mt-2 text-2xl font-extrabold font-mono tabular-nums text-zinc-950 dark:text-zinc-50">
            {formatCurrency(kpis.invoice_gross_usd)}
          </div>
          <div className="mt-1.5 text-[11px] font-mono text-zinc-500">
            Seats {formatCurrency(kpis.invoice_subscription_usd)} · Model SKUs {formatCurrency(kpis.invoice_model_sku_usd)}
          </div>
        </div>

        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <BadgePercent className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="whitespace-nowrap">GCP Credits &amp; Discounts</span>
            <MetricTooltip
              title="Cloud Billing Credits & Discounts"
              description="Committed-use discounts (CUDs), enterprise negotiated discounts, and promotional credits applied in Cloud Billing."
              formula="SUM(credits.amount) from Billing Export"
            />
          </div>
          <div className="mt-2 text-2xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatCurrency(kpis.invoice_credits_usd)}
          </div>
          <div className="mt-1.5 text-[11px] text-zinc-500">
            Promotional &amp; committed-use credits in Cloud Billing export
          </div>
        </div>

        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <CreditCard className="w-4 h-4 text-rose-500 shrink-0" />
            <span className="whitespace-nowrap">GCP Invoice Net Billed</span>
            <MetricTooltip
              title="Reconciled Net Billed Spend"
              description="Actual net payable Cloud Billing invoice amount after subtracting all credits and discounts from gross spend."
              formula="Net Billed = Gross Cost + Credits (negative)"
            />
          </div>
          <div className="mt-2 text-2xl font-extrabold font-mono tabular-nums text-zinc-950 dark:text-zinc-50">
            {formatCurrency(kpis.invoice_net_usd)}
          </div>
          <div className="mt-1.5 text-[11px] font-mono text-zinc-500">
            {meta?.billing_table ? 'Reconciled from Cloud Billing BigQuery export' : 'Link BILLING_EXPORT_TABLE to enable'}
          </div>
        </div>

        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="whitespace-nowrap">Prompt Cache Cost Avoided</span>
            <MetricTooltip
              align="right"
              title="Prompt Cache Cost Avoidance"
              description="Estimated input token spend saved because Antigravity reused cached trajectory context instead of re-sending uncached input tokens."
              formula="Avoidance % = Cache Saved ÷ (Actual Spend + Cache Saved)"
              benchmark="High cache avoidance (>55%) dramatically lowers effective cost per autonomous turn."
            />
          </div>
          <div className="mt-2 text-2xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatCurrency(kpis.cache_savings_usd)}
          </div>
          <div className="mt-1.5 text-[11px] font-mono text-zinc-500">
            {kpis.cost_avoidance_pct}% saved vs. uncached list token rates
          </div>
        </div>
      </div>

      {/* Daily Spend vs Cache Avoidance Chart */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] p-5 shadow-sm">
        <div className="mb-3">
          <h2 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Daily Token Spend vs. Prompt Cache Cost Avoidance ($)
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Illustrates how high context reuse ({kpis.cache_hit_rate_pct}% average cache hit rate) suppresses daily token spend
          </p>
        </div>
        <ReactECharts option={finopsChartOption} style={{ height: '275px', width: '100%' }} notMerge />
      </div>

      {/* Real GCP Cloud Billing Export SKU Ledger */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200/90 dark:border-zinc-800/90 rounded-[12px] shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
              Live GCP Cloud Billing Export — AI &amp; Subscription SKU Ledger
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {meta?.billing_table ? (
                <>
                  Direct line-item reconciliation from <code className="font-mono">{meta.billing_table}</code>
                </>
              ) : (
                <>
                  Optional: Set <code className="font-mono">BILLING_EXPORT_TABLE</code> on Cloud Run to reconcile live Cloud Billing SKUs
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                maxLength={80}
                value={skuSearch}
                onChange={(e) => setSkuSearch(e.target.value)}
                placeholder="Filter SKU or service..."
                className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-950 dark:text-zinc-100"
              />
            </div>
            <button
              type="button"
              disabled={!filteredSkus.length}
              onClick={() =>
                downloadCsv(
                  'antigravity_billing_skus.csv',
                  ['service_name', 'sku_description', 'billing_category', 'gross_cost_usd', 'credits_usd', 'net_cost_usd'],
                  filteredSkus
                )
              }
              className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-3 py-1.5 text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-zinc-100/80 dark:bg-zinc-900/90 text-zinc-500 dark:text-zinc-400 text-[11px] font-semibold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="py-3 px-4">GCP Service &amp; Billed SKU Description</th>
                <th className="py-3 px-3">Billing Category</th>
                <th className="py-3 px-3 w-40">Gross Weight</th>
                <th className="py-3 px-3 text-right">Gross Cost</th>
                <th className="py-3 px-3 text-right">Credits</th>
                <th className="py-3 px-4 text-right">Net Billed</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {filteredSkus.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    No Cloud Billing SKU rows found in the selected date window.
                  </td>
                </tr>
              ) : (
                filteredSkus.map((sku, idx) => {
                  const gross = Number(sku.gross_cost_usd || 0);
                  const wPct = Math.min(100, Math.max(4, Math.round((gross / maxGrossSku) * 100)));
                  const catBadge =
                    sku.billing_category === 'Subscription Seat'
                      ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20'
                      : sku.billing_category === 'Prompt Caching SKU'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
                      : sku.billing_category === 'Long Context (>200K)'
                      ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
                      : 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20';

                  return (
                    <tr key={`${sku.service_name}-${sku.sku_description}-${idx}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                          {sku.sku_description}
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {sku.service_name}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold border ${catBadge}`}>
                          {sku.billing_category}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${wPct}%` }} />
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
                        {formatCurrency(sku.gross_cost_usd)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                        {Number(sku.credits_usd) !== 0 ? formatCurrency(sku.credits_usd) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-zinc-950 dark:text-zinc-50">
                        {formatCurrency(sku.net_cost_usd)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
