import React from 'react';
import { X, Database, ShieldCheck, CheckCircle2, Lock } from 'lucide-react';

export default function SinkSetupModal({ open, onClose, meta }) {
  if (!open) return null;

  const sink = meta?.sink_status || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#0c0c0f] rounded-[12px] border border-zinc-200 dark:border-zinc-800 shadow-2xl w-full max-w-2xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              Live Telemetry &amp; Zero-Trust Security Posture
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              100% real Cloud Logging telemetry across{' '}
              {meta?.org_id ? (
                <>
                  Organization <code className="font-mono text-zinc-700 dark:text-zinc-300">{meta.org_id}</code>
                </>
              ) : (
                <>
                  Project <code className="font-mono text-zinc-700 dark:text-zinc-300">{meta?.project_id || 'GCP'}</code>
                </>
              )}{' '}
              with hardened runtime &amp; least-privilege IAM.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
              Organization Cloud Logging Sink
            </div>
            <div className="mt-1 flex items-center gap-2 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="truncate">{sink.sink_resource || 'Cloud Logging -> BigQuery Sink'}</span>
            </div>
          </div>

          <div className="p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
              BigQuery Real Event Rows
            </div>
            <div className="mt-1 font-mono text-xs text-zinc-800 dark:text-zinc-200">
              {Number(sink.hist_rows || 0).toLocaleString()} backfilled +{' '}
              {Number(sink.live_resp_rows || 0).toLocaleString()} live sink events
            </div>
          </div>
        </div>

        <div className="rounded-lg p-3.5 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 text-xs space-y-1.5">
          <div className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-emerald-500" />
            Active Defense-in-Depth Controls
          </div>
          <ul className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 space-y-1">
            <li>• Runtime IAM: Dedicated least-privilege SA (antigravity-dashboard-sa)</li>
            <li>• Container: Non-root UID 10001 + immutable read-only /app filesystem</li>
            <li>• DDoS &amp; Wallet Guards: maxInstanceCount=5, per-IP rate limits, 150MB BQ scan cap</li>
            <li>• API Guards: Parameterized SQL, CSRF + Origin checks, strict CSP/HSTS headers</li>
          </ul>
        </div>

        <div className="rounded-lg p-3.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong>Zero Synthetic Data &amp; Privacy-by-Design:</strong> Prompt &amp; code response payloads are excluded at query time via columnar struct pruning.
          </span>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 rounded-[8px] px-4 py-2 text-xs font-semibold transition-colors shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
