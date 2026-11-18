import React, { useState } from 'react';
import { Lock, Eye, EyeOff, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';

export default function AuthLockScreen({ onSubmitToken, error, loading }) {
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleaned = token.trim();
    if (!cleaned || loading) return;
    onSubmitToken(cleaned);
  };

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-[14px] shadow-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight">
              Antigravity Dashboard Locked
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Enter your access password / token (<code className="font-mono">DASHBOARD_AUTH_TOKEN</code>)
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              autoFocus
              autoComplete="current-password"
              spellCheck={false}
              maxLength={256}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter password or bearer token..."
              className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[9px] pl-3.5 pr-10 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-950 dark:text-zinc-50"
            />
            <button
              type="button"
              aria-label={show ? 'Hide password' : 'Show password'}
              onClick={() => setShow((prev) => !prev)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <button
            type="submit"
            disabled={!token.trim() || loading}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[9px] bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>{loading ? 'Verifying...' : 'Unlock Dashboard'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>

        <div className="rounded-lg p-3 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <span>
            Your access token is held strictly in browser <code>sessionStorage</code> for this tab session and verified in constant time on the server.
          </span>
        </div>
      </div>
    </div>
  );
}
