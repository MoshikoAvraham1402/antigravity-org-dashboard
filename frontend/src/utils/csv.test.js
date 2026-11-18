import { describe, expect, it } from 'vitest';
import { buildCsvContent, sanitizeCsvCell } from './csv';
import { escapeHtml, formatCompactNumber, formatCurrency, formatDurationMin } from './formatters';

describe('csv utilities', () => {
  it('neutralizes spreadsheet formula injection prefixes cleanly', () => {
    expect(sanitizeCsvCell('=CMD("calc")')).toBe('"\'=CMD(""calc"")"');
    expect(sanitizeCsvCell(' =CMD("calc")')).toBe('"\' =CMD(""calc"")"');
    expect(sanitizeCsvCell('\t=CMD("calc")')).toBe('"\'\t=CMD(""calc"")"');
    expect(sanitizeCsvCell('+1+1')).toBe('"\'+1+1"');
    expect(sanitizeCsvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(sanitizeCsvCell('normal-value')).toBe('"normal-value"');
  });

  it('builds CSV rows in header order', () => {
    const csv = buildCsvContent(['model', 'tokens'], [{ model: 'gemini-4-hydrogen', tokens: 1200 }]);
    expect(csv).toBe('model,tokens\n"gemini-4-hydrogen","1200"');
  });
});

describe('formatters', () => {
  it('formats compact numbers, currencies, durations, and escapes HTML', () => {
    expect(formatCompactNumber(1500)).toBe('1.5K');
    expect(formatCompactNumber(2500000)).toBe('2.5M');
    expect(formatCurrency(12.3)).toBe('$12.30');
    expect(formatCurrency(-4.5)).toBe('-$4.50');
    expect(formatDurationMin(125)).toBe('2h 5m');
    expect(escapeHtml('<script>alert("xss\'&")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&#39;&amp;&quot;)&lt;/script&gt;'
    );
  });
});
