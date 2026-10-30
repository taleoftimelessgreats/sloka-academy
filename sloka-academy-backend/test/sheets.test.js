'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startApp, addUser, login, client, ALLOWED_ORIGIN } = require('./helpers');
const { parseSheetUrl, signAssertion, loadServiceAccount } = require('../src/sheets');
const { localDate } = require('../src/util');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'sloka-sync@sloka-academy.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  token_uri: 'https://oauth2.googleapis.com/token',
});
const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;

/** Fake Google: records calls; `state.denied` makes the spreadsheet 403. */
function fakeGoogle() {
  const state = { calls: [], appended: [], tabs: ['Sheet1'], header: null, denied: false, tokens: 0 };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  state.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    state.calls.push(`${method} ${u.hostname}${decodeURIComponent(u.pathname)}`);
    if (u.hostname === 'oauth2.googleapis.com') {
      const assertion = new URLSearchParams(init.body).get('assertion');
      const [h, c, sig] = assertion.split('.');
      const okSig = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, 'base64url'));
      if (!okSig) return json(400, { error: 'invalid_grant' });
      state.tokens++;
      return json(200, { access_token: 'tok-123', expires_in: 3600 });
    }
    assert.equal(init.headers.Authorization, 'Bearer tok-123');
    if (state.denied) return json(403, { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } });
    const path = decodeURIComponent(u.pathname);
    if (method === 'GET' && path === `/v4/spreadsheets/${SHEET_ID}`) {
      return json(200, { properties: { title: 'Sloka registrations' }, sheets: state.tabs.map((title) => ({ properties: { title } })) });
    }
    if (method === 'POST' && path === `/v4/spreadsheets/${SHEET_ID}:batchUpdate`) {
      state.tabs.push(JSON.parse(init.body).requests[0].addSheet.properties.title);
      return json(200, {});
    }
    if (method === 'GET' && path.endsWith('!1:1')) return json(200, state.header ? { values: [state.header] } : {});
    if (method === 'PUT') {
      assert.equal(u.searchParams.get('valueInputOption'), 'RAW');
      state.header = JSON.parse(init.body).values[0];
      return json(200, {});
    }
    if (method === 'POST' && path.endsWith(':append')) {
      assert.equal(u.searchParams.get('valueInputOption'), 'RAW');
      state.appended.push(...JSON.parse(init.body).values);
      return json(200, {});
    }
    return json(404, { error: { message: `unexpected ${method} ${path}` } });
  };
  return state;
}

describe('google sheets helpers', () => {
  test('parseSheetUrl accepts sheet links and bare IDs only', () => {
    assert.equal(parseSheetUrl(SHEET_URL), SHEET_ID);
    assert.equal(parseSheetUrl(`https://docs.google.com/spreadsheets/u/1/d/${SHEET_ID}/edit`), SHEET_ID);
    assert.equal(parseSheetUrl(SHEET_ID), SHEET_ID);
    assert.equal(parseSheetUrl(`http://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`), null);
    assert.equal(parseSheetUrl(`https://evil.example/spreadsheets/d/${SHEET_ID}/edit`), null);
    assert.equal(parseSheetUrl('https://docs.google.com/document/d/abc/edit'), null);
    assert.equal(parseSheetUrl('not a link'), null);
  });

  test('service-account assertion is a valid RS256 JWT for the Sheets scope', () => {
    const sa = loadServiceAccount({ googleServiceAccountJson: KEY_JSON });
    const jwt = signAssertion(sa, 1_800_000_000);
    const [h, c, sig] = jwt.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(c, 'base64url'));
    assert.equal(claims.iss, 'sloka-sync@sloka-academy.iam.gserviceaccount.com');
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets');
    assert.equal(claims.exp - claims.iat, 3600);
    assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, 'base64url')));
    assert.equal(loadServiceAccount({}), null);
    assert.throws(() => loadServiceAccount({ googleServiceAccountJson: '{"client_email":"x"}' }), /client_email and private_key/);
  });
});

describe('google sheets sync', () => {
  let ctx;
  let api;
  let google;
  before(async () => {
    google = fakeGoogle();
    ctx = await startApp({ env: { GOOGLE_SERVICE_ACCOUNT_JSON: KEY_JSON }, sheetsFetch: google.fetch });
    const admin = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
    const c = await addUser(ctx.db, { name: 'Kiran C', email: 'kiran@sloka.test', password: 'kiran-password-123' });
    api = client(ctx.base, (await login(ctx.base, admin.email, admin.password)).cookie);
    ctx.counsellorApi = client(ctx.base, (await login(ctx.base, c.email, c.password)).cookie);
  });
  after(() => ctx.close());

  const register = async (s, extra = {}) => {
    const r = await fetch(`${ctx.base}/api/public/certificate-registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ sessionId: s.id, code: s.code, name: 'Asha Kumar', email: 'asha@example.com', phone: '9876543210', college: 'JNTU Hyderabad', stream: 'electronics', consent: true, ...extra }),
    });
    assert.equal(r.status, 201);
    return (await r.json()).certificate;
  };

  test('settings: admin only; shows the service account to share the sheet with', async () => {
    assert.equal((await ctx.counsellorApi.get('/api/settings')).status, 403);
    const r = await api.get('/api/settings');
    assert.equal(r.status, 200);
    assert.equal(r.data.googleSheet.connected, true);
    assert.equal(r.data.googleSheet.serviceAccountEmail, 'sloka-sync@sloka-academy.iam.gserviceaccount.com');
    assert.equal(r.data.googleSheet.sheetId, null);
    assert.equal(r.data.email.enabled, false);
  });

  test('registrations made before a sheet is linked are copied once it is saved; new ones follow', async () => {
    const s = (await api.post('/api/sessions', { title: 'Careers in VLSI', sessionDate: localDate(), mode: 'online' })).data.session;
    const c1 = await register(s);
    await ctx.settle();
    assert.equal(google.appended.length, 0, 'nothing to sync to yet');

    const invalid = await api.put('/api/settings/google-sheet', { url: 'https://example.com/x' });
    assert.equal(invalid.status, 400);
    assert.match(invalid.data.fields.url, /link of a Google Sheet/);

    const saved = await api.put('/api/settings/google-sheet', { url: SHEET_URL });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.check, { ok: true, title: 'Sloka registrations' });
    await new Promise((r) => setTimeout(r, 50));
    await ctx.settle();
    assert.ok(google.tabs.includes('Career Guidance Registrations'), 'tab created');
    assert.equal(google.header[0], 'Submitted at');
    assert.equal(google.appended.length, 1);
    const row = google.appended[0];
    assert.equal(row[1], c1.id);
    assert.equal(row[3], 'asha@example.com');
    assert.equal(row[4], '9876543210');
    assert.equal(row[6], 'Electronics');
    assert.ok(row.every((v) => typeof v === 'string'), 'all cells are text');

    const c2 = await register(s, { email: 'ravi@example.com', name: 'Ravi Teja', phone: '9123456780', college: '=HYPERLINK("x")' });
    await new Promise((r) => setTimeout(r, 1700)); // the debounce after a registration
    await ctx.settle();
    assert.equal(google.appended.length, 2);
    assert.equal(google.appended[1][1], c2.id);
    assert.equal(google.appended[1][5], '=HYPERLINK("x")', 'sent RAW: Sheets will not run it as a formula');

    const status = (await api.get('/api/settings')).data.googleSheet;
    assert.equal(status.pending, 0);
    assert.ok(status.lastSyncAt);
    assert.equal(status.lastError, null);
    assert.equal(google.tokens, 1, 'access token reused');
  });

  test('a sheet that is not shared gives a clear message and rows wait for the retry', async () => {
    google.denied = true;
    const s = (await api.post('/api/sessions', { title: 'Careers in Cloud', sessionDate: localDate(), mode: 'online' })).data.session;
    await register(s, { email: 'meena@example.com', name: 'Meena K' });
    const r = await api.post('/api/settings/google-sheet/sync');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, false);
    assert.match(r.data.message, /isn't shared with sloka-sync@sloka-academy\.iam\.gserviceaccount\.com/);
    assert.equal(r.data.googleSheet.pending, 1);

    google.denied = false;
    const again = await api.post('/api/settings/google-sheet/sync');
    assert.equal(again.data.ok, true);
    assert.equal(again.data.synced, 1);
    assert.equal(again.data.googleSheet.lastError, null);
    assert.equal(google.appended.length, 3);
  });
});
