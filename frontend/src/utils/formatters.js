import { format, parseISO, isValid } from 'date-fns';

export const CHART_COLORS = [
  '#3b82f6', // Blue 500
  '#10b981', // Emerald 500
  '#f59e0b', // Amber 500
  '#8b5cf6', // Violet 500
  '#06b6d4', // Cyan 500
  '#ec4899', // Pink 500
  '#f97316', // Orange 500
  '#ef4444', // Red 500
  '#84cc16', // Lime 500
  '#6366f1', // Indigo 500
];

export function formatCompactNumber(val) {
  const n = Number(val || 0);
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

export function formatFullNumber(val) {
  return Number(val || 0).toLocaleString('en-US');
}

export function formatCurrency(val, decimals = 2) {
  const n = Number(val || 0);
  if (n < 0) {
    return `-$${Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  }
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatPercent(val, decimals = 1) {
  const n = Number(val || 0);
  return `${n.toFixed(decimals)}%`;
}

export function formatDurationMin(mins) {
  const m = Math.max(1, Math.round(Number(mins || 0)));
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60);
  const rem = m % 60;
  if (hrs >= 24) {
    const days = Math.floor(hrs / 24);
    const remHrs = hrs % 24;
    return remHrs > 0 ? `${days}d ${remHrs}h` : `${days}d`;
  }
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export function formatReadableDate(isoString) {
  if (!isoString) return '—';
  try {
    const parsed = typeof isoString === 'string' ? parseISO(isoString) : new Date(isoString);
    if (!isValid(parsed)) return String(isoString);
    return format(parsed, 'MMM dd, yyyy');
  } catch {
    return String(isoString);
  }
}

export function formatShortDate(isoString) {
  if (!isoString) return '';
  try {
    const parsed = typeof isoString === 'string' ? parseISO(isoString) : new Date(isoString);
    if (!isValid(parsed)) return String(isoString);
    return format(parsed, 'MMM dd');
  } catch {
    return String(isoString);
  }
}

export function formatTimestamp(isoString) {
  if (!isoString) return '—';
  try {
    const parsed = typeof isoString === 'string' ? parseISO(isoString) : new Date(isoString);
    if (!isValid(parsed)) return String(isoString);
    return format(parsed, 'MMM dd, HH:mm:ss');
  } catch {
    return String(isoString);
  }
}

export function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatClockTime(isoString) {
  if (!isoString) return '—';
  try {
    const parsed = typeof isoString === 'string' ? parseISO(isoString) : new Date(isoString);
    if (!isValid(parsed)) return String(isoString);
    return format(parsed, 'HH:mm:ss');
  } catch {
    return String(isoString);
  }
}
