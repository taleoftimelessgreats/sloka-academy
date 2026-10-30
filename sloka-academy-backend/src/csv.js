'use strict';

const FORMULA_START = /^[=+\-@\t\r]/;

// Neutralise spreadsheet formula injection, then apply RFC 4180 quoting.
function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Phones are stored as +91XXXXXXXXXX. Export the 10-digit national number so Excel shows it as-is
// (a leading "+" would trip the formula guard and display a literal apostrophe).
function nationalPhone(p) {
  return typeof p === 'string' && /^\+91[6-9]\d{9}$/.test(p) ? p.slice(3) : p;
}

// Excel-friendly CSV: UTF-8 BOM + CRLF line endings.
function toCsv(header, rows) {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

module.exports = { csvCell, toCsv, nationalPhone };
