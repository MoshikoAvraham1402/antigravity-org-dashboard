/**
 * Safe CSV cell serializer and browser download helper with formula-injection protection.
 */
export function sanitizeCsvCell(val) {
  let str = String(val ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export function buildCsvContent(headers, rows) {
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => sanitizeCsvCell(row[h])).join(',')),
  ];
  return lines.join('\n');
}

export function downloadCsv(filename, headers, rows) {
  if (!rows?.length) return;
  const csv = buildCsvContent(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
