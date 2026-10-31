'use strict';

const crypto = require('node:crypto');

// Google Sheets through an Apps Script web app that lives in the spreadsheet itself. The script runs as
// the sheet's owner, so the server needs no Google account, API key or service account: only the web
// app's URL and a shared secret that the script checks on every request.

class SheetsError extends Error {
  constructor(message, { status = 0, transient = false } = {}) {
    super(message);
    this.status = status;
    this.transient = transient;
  }
}

const NOT_FOUND_MSG = 'Google found no web app at this URL. In Apps Script, open Deploy → Manage deployments and copy the Web app URL again.';
const NO_ANSWER_MSG =
  "Google didn't pass the request to the script. In Apps Script, open Deploy → Manage deployments → Edit and check that “Who has access” is “Anyone” and that the script below was pasted in full; then deploy a new version.";
const SECRET_MSG =
  "The script in the sheet has a different secret. Copy the script from this page again, paste it over the old one, then Deploy → Manage deployments → Edit → Version: New version.";

/**
 * The URL of a deployed Apps Script web app (https://script.google.com/macros/s/<id>/exec, or the
 * Google Workspace form …/a/macros/<domain>/s/<id>/exec), without query or fragment. Null otherwise.
 */
function parseWebAppUrl(input) {
  if (typeof input !== 'string') return null;
  let u;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'script.google.com' || u.port || u.username || u.password) return null;
  return /^\/(?:a\/macros\/[A-Za-z0-9.-]{1,253}|macros)\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(u.pathname) ? `${u.origin}${u.pathname}` : null;
}

/** The test URL Apps Script shows under "Test deployments" (…/dev): it only works for the script's owner. */
const isTestDeploymentUrl = (input) => typeof input === 'string' && /^https:\/\/script\.google\.com\/.*\/dev(?:[?#]|$)/.test(input.trim());

const newSecret = () => crypto.randomBytes(24).toString('base64url');

/**
 * The Apps Script source an admin pastes into the sheet (Extensions → Apps Script). It appends the rows it
 * is sent, skipping any whose key (e.g. the certificate ID) is already in the tab, so a resend never
 * duplicates a row. Every value is written as plain text: nothing becomes a formula, number or date.
 */
function appsScript(secret) {
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) throw new Error('invalid secret');
  return `// Sloka Academy: copies career guidance registrations and referred friends into this spreadsheet.
// Paste this into Extensions → Apps Script, then Deploy → New deployment → Web app
// (Execute as: Me, Who has access: Anyone). Keep the secret private: it lets the portal add rows.
const SECRET = '${secret}';

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (!req || !sameText(String(req.secret), SECRET)) return reply({ ok: false, error: 'bad_secret' });
    const book = SpreadsheetApp.getActiveSpreadsheet();
    if (req.action === 'append') {
      const lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try {
        (req.tabs || []).forEach(function (tab) { addRows(book, tab); });
        SpreadsheetApp.flush();
      } finally {
        lock.releaseLock();
      }
    }
    return reply({ ok: true, spreadsheetId: book.getId(), title: book.getName(), url: book.getUrl() });
  } catch (err) {
    return reply({ ok: false, error: 'script_error', message: String((err && err.message) || err) });
  }
}

function addRows(book, tab) {
  const sheet = book.getSheetByName(tab.name) || book.insertSheet(tab.name);
  const width = tab.header.length;
  // Write the header into an empty first row, or extend it when it is an older version of this header.
  const first = sheet.getLastColumn() > 0 ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0] : [];
  if (first.every(function (v, i) { return v === '' || v === tab.header[i]; })) {
    sheet.getRange(1, 1, 1, width).setValues([tab.header]);
  }
  const last = sheet.getLastRow();
  const seen = {};
  if (last > 1) {
    sheet.getRange(2, tab.key + 1, last - 1, 1).getDisplayValues().forEach(function (r) { seen[r[0]] = true; });
  }
  const rows = tab.rows.filter(function (r) {
    const fresh = !seen[r[tab.key]];
    seen[r[tab.key]] = true;
    return fresh;
  });
  if (!rows.length) return;
  // A leading apostrophe stores the value as plain text and is not shown in the cell.
  sheet.getRange(last + 1, 1, rows.length, width).setValues(rows.map(function (r) {
    return r.map(function (v) { return v === '' ? '' : "'" + v; });
  }));
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
`;
}

/** Client for the Apps Script web app. Errors are SheetsErrors with a staff-readable message. */
function createSheetsClient(webAppUrl, secret, { fetchImpl = fetch } = {}) {
  async function call(payload) {
    let res;
    try {
      // Apps Script answers a POST with a redirect to the script's output, which fetch follows (as a GET).
      res = await fetchImpl(webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, secret }),
        redirect: 'follow',
        signal: AbortSignal.timeout(60000),
      });
    } catch (err) {
      throw new SheetsError(`Could not reach Google: ${err.message}`, { transient: true });
    }
    const text = await res.text().catch(() => '');
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (res.status === 429 || res.status >= 500) {
      throw new SheetsError(`Google is busy (HTTP ${res.status}). The rows will be sent again shortly.`, { status: res.status, transient: true });
    }
    if (res.status === 404) throw new SheetsError(NOT_FOUND_MSG, { status: 404 });
    // Anything but the script's JSON (typically a Google sign-in page) means the request never reached it.
    if (!res.ok || !body || typeof body !== 'object') throw new SheetsError(NO_ANSWER_MSG, { status: res.status });
    if (body.ok !== true) {
      if (body.error === 'bad_secret') throw new SheetsError(SECRET_MSG, { status: 403 });
      throw new SheetsError(`The script in the sheet reported: ${String(body.message || body.error || 'an error')}`.slice(0, 500));
    }
    if (typeof body.spreadsheetId !== 'string' || !body.spreadsheetId) throw new SheetsError(NO_ANSWER_MSG, { status: res.status });
    return { spreadsheetId: body.spreadsheetId, title: String(body.title || ''), url: typeof body.url === 'string' ? body.url : null };
  }

  return {
    /** { spreadsheetId, title, url } of the spreadsheet the script belongs to. */
    describe: () => call({ action: 'describe' }),
    /** Append rows to tabs: [{ name, header, key (column index of the unique value), rows }]. */
    append: (tabs) => call({ action: 'append', tabs }),
  };
}

module.exports = { parseWebAppUrl, isTestDeploymentUrl, newSecret, appsScript, createSheetsClient, SheetsError };
