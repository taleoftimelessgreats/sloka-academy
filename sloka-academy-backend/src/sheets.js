'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

class SheetsError extends Error {
  constructor(message, { status = 0, transient = false } = {}) {
    super(message);
    this.status = status;
    this.transient = transient;
  }
}

/**
 * Read the service-account key ({ client_email, private_key }) from GOOGLE_SERVICE_ACCOUNT_FILE or
 * GOOGLE_SERVICE_ACCOUNT_JSON. Returns null when neither is set; throws when the key is unusable.
 */
function loadServiceAccount(config) {
  let raw = config.googleServiceAccountJson;
  if (!raw && config.googleServiceAccountFile) {
    try {
      raw = fs.readFileSync(config.googleServiceAccountFile, 'utf8');
    } catch (err) {
      throw new Error(`GOOGLE_SERVICE_ACCOUNT_FILE could not be read (${err.code || err.message}).`);
    }
  }
  if (!raw) return null;
  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    throw new Error('The Google service-account key is not valid JSON. Use the JSON key file downloaded from Google Cloud.');
  }
  if (!key || typeof key.client_email !== 'string' || typeof key.private_key !== 'string') {
    throw new Error('The Google service-account key must contain client_email and private_key.');
  }
  try {
    crypto.createPrivateKey(key.private_key);
  } catch {
    throw new Error('The private_key in the Google service-account key is not a valid key.');
  }
  return { clientEmail: key.client_email, privateKey: key.private_key, tokenUrl: key.token_uri || DEFAULT_TOKEN_URL };
}

/** Spreadsheet ID from a Google Sheets link (or a bare ID). Returns null if it doesn't look like one. */
function parseSheetUrl(input) {
  if (typeof input !== 'string') return null;
  const v = input.trim();
  if (/^[A-Za-z0-9_-]{25,100}$/.test(v)) return v;
  let u;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null;
  const m = u.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{25,100})(?:\/|$)/);
  return m ? m[1] : null;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** RS256-signed JWT assertion for the OAuth 2.0 service-account flow. */
function signAssertion(sa, nowSeconds) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({ iss: sa.clientEmail, scope: SCOPE, aud: sa.tokenUrl, iat: nowSeconds, exp: nowSeconds + 3600 }),
  );
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), sa.privateKey);
  return `${header}.${claims}.${b64url(signature)}`;
}

const quoteTab = (title) => `'${title.replace(/'/g, "''")}'`;

/** Minimal Google Sheets client: just what syncing registrations needs. */
function createSheetsClient(sa, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  let token = null;
  let tokenExpires = 0;

  async function call(url, init, what) {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20000), redirect: 'error' });
    } catch (err) {
      throw new SheetsError(`Could not reach Google (${what}): ${err.message}`, { transient: true });
    }
    const body = await res.json().catch(() => null);
    if (res.ok) return body;
    const detail = (body && body.error && (body.error.message || body.error_description || body.error)) || `HTTP ${res.status}`;
    throw new SheetsError(String(detail), { status: res.status, transient: res.status === 429 || res.status >= 500 });
  }

  async function accessToken() {
    if (token && now() < tokenExpires - 60000) return token;
    let body;
    try {
      body = await call(
        sa.tokenUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: signAssertion(sa, Math.floor(now() / 1000)),
          }).toString(),
        },
        'sign-in',
      );
    } catch (err) {
      if (err.transient) throw err;
      throw new SheetsError(`Google rejected the service-account key: ${err.message}`, { status: err.status });
    }
    token = body.access_token;
    tokenExpires = now() + (Number(body.expires_in) || 3600) * 1000;
    return token;
  }

  async function api(method, path, body) {
    const t = await accessToken();
    return call(
      `${API}/${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      },
      'Sheets API',
    );
  }

  return {
    /** { title, tabs: [title] } */
    async describe(spreadsheetId) {
      const r = await api('GET', `${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`);
      return { title: r.properties.title, tabs: (r.sheets || []).map((s) => s.properties.title) };
    },
    /** Make sure the tab exists and starts with the header row. */
    async ensureTab(spreadsheetId, title, header) {
      const id = encodeURIComponent(spreadsheetId);
      const { tabs } = await this.describe(spreadsheetId);
      if (!tabs.includes(title)) {
        await api('POST', `${id}:batchUpdate`, { requests: [{ addSheet: { properties: { title } } }] });
      }
      const first = await api('GET', `${id}/values/${encodeURIComponent(`${quoteTab(title)}!1:1`)}`);
      if (!first.values || !first.values.length) {
        await api('PUT', `${id}/values/${encodeURIComponent(`${quoteTab(title)}!A1`)}?valueInputOption=RAW`, { values: [header] });
      }
    },
    /** Append rows below the existing data. RAW: nothing is interpreted as a formula. */
    async append(spreadsheetId, title, rows) {
      const range = encodeURIComponent(`${quoteTab(title)}!A1`);
      await api('POST', `${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        values: rows,
      });
    },
  };
}

module.exports = { loadServiceAccount, parseSheetUrl, signAssertion, createSheetsClient, SheetsError, SCOPE };
