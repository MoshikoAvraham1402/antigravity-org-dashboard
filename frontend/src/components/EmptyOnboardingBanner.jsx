import React from 'react';
import { Terminal, Database, Cloud, Laptop, Receipt } from 'lucide-react';

export default function EmptyOnboardingBanner({ meta, onOpenSinkModal }) {
  const projectId = meta?.project_id || 'YOUR_PROJECT_ID';
  const dataset = meta?.monitoring_dataset || 'antigravity_monitoring';

  return (
    <section className="bg-white dark:bg-[#0c0c0f] border border-amber-200/90 dark:border-amber-900/50 rounded-[12px] p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60">
            Waiting for First Telemetry Event
          </span>
          <h2 className="text-base font-bold text-zinc-950 dark:text-zinc-50 mt-1.5">
            No telemetry events found in {projectId}.{dataset} for this window
          </h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
            Connect any of the three supported telemetry sources below, then click <strong>Sync Data</strong>.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenSinkModal}
          className="self-start shrink-0 px-3 py-1.5 rounded-[8px] text-xs font-semibold border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          View Pipeline Status
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="p-3.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 space-y-1.5">
          <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <Cloud className="w-3.5 h-3.5 text-blue-500" />
            1. Enterprise Antigravity Logs
          </div>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Ensure <code>businessaicode.googleapis.com</code> Data Access Audit Logs are enabled and the Cloud Logging sink routes to <code>{meta?.raw_logs_dataset || 'antigravity_raw_logs'}</code>.
          </p>
        </div>

        <div className="p-3.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 space-y-1.5">
          <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-emerald-500" />
            2. Vertex AI &amp; Gemini API Metrics
          </div>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Grant <code>roles/monitoring.viewer</code> on active GCP projects to the runtime service account so <strong>Sync Data</strong> ingests Vertex AI token &amp; request metrics.
          </p>
        </div>

        <div className="p-3.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 space-y-1.5">
          <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <Laptop className="w-3.5 h-3.5 text-violet-500" />
            3. Local Workstation Sync
          </div>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Using personal Antigravity IDE/CLI? Run the metadata-only sync script:
          </p>
          <div className="font-mono text-[10.5px] p-1.5 rounded bg-zinc-900 text-zinc-100 dark:bg-black flex items-center gap-1.5 overflow-x-auto">
            <Terminal className="w-3 h-3 text-emerald-400 shrink-0" />
            <code>python scripts/sync_local_antigravity.py --project {projectId}</code>
          </div>
        </div>
      </div>

      {!meta?.billing_enabled && (
        <div className="text-[11.5px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 pt-1">
          <Receipt className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span>
            Optional: Set <code>BILLING_EXPORT_TABLE</code> on Cloud Run to reconcile actual GCP Cloud Billing invoice SKUs.
          </span>
        </div>
      )}
    </section>
  );
}
