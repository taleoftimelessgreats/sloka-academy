'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { startApp, addUser, login, client, ALLOWED_ORIGIN } = require('./helpers');
const { parseWebAppUrl, isTestDeploymentUrl, appsScript } = require('../src/sheets');
const { localDate } = require('../src/util');

const WEB_APP = 'https://script.google.com/macros/s/AKfycbx1234567890abcdefghijklmnopqrstuvwxyz/exec';
const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';

/**
 * A fake spreadsheet running the real Apps Script source. Cells hold what the script wrote; display
 * values drop the leading apostrophe, as Google Sheets does. `state.mode`: 'ok', 'signin' (Google's
 * sign-in page instead of the script) or 'missing' (404).
 */
function fakeGoogle() {
  const state = { mode: 'ok', calls: 0, tabs: new Map(), script: null };
  const display = (v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v);
  function sheetOf(name) {
    const grid = [];
    const lastCol = () => Math.max(0, ...grid.map((r) => r.findLastIndex((v) => v !== '') + 1));
    return {
      grid,
      getLastRow: () => grid.findLastIndex((r) => r.some((v) => v !== '')) + 1,
      getLastColumn: lastCol,
      getRange: (row, col, rows, cols) => ({
        getDisplayValues: () =>
          Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => display(grid[row - 1 + i]?.[col - 1 + j] ?? ''))),
        setValues(values) {
          assert.equal(values.length, rows, `${name}: row count`);
          values.forEach((r, i) => {
            assert.equal(r.length, cols, `${name}: column count`);
            grid[row - 1 + i] ||= [];
            r.forEach((v, j) => {
              grid[row - 1 + i][col - 1 + j] = v;
            });
          });
        },
      }),
    };
  }
  const book = {
    getId: () => SHEET_ID,
    getName: () => 'Sloka registrations',
    getUrl: () => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    getSheetByName: (n) => state.tabs.get(n) || null,
    insertSheet: (n) => {
      state.tabs.set(n, sheetOf(n));
      return state.tabs.get(n);
    },
  };
  /** Load the script an admin would paste (as the sheet has it). */
  state.install = (source) => {
    const ctx = {
      SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {} },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    };
    vm.runInNewContext(source, ctx);
    state.script = ctx;
  };
  state.rows = (tab) => (state.tabs.get(tab)?.grid || []).map((r) => r.map(display));
  state.fetch = async (url, init = {}) => {
    state.calls++;
    assert.equal(url, WEB_APP);
    assert.equal(init.method, 'POST');
    if (state.mode === 'missing') return new Response('<html>Not found</html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    if (state.mode === 'signin' || !state.script) {
      return new Response('<html>Sign in - Google Accounts</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    const out = state.script.doPost({ postData: { contents: init.body } });
    return new Response(out.text, { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return state;
}

describe('google sheets helpers', () => {
  test('parseWebAppUrl accepts deployed Apps Script web app URLs only', () => {
    assert.equal(parseWebAppUrl(WEB_APP), WEB_APP);
    assert.equal(parseWebAppUrl(` ${WEB_APP}?x=1#y `), WEB_APP, 'query and fragment dropped');
    const workspace = 'https://script.google.com/a/macros/slokaacademy.com/s/AKfycbx1234567890abcdefghijklmnop/exec';
    assert.equal(parseWebAppUrl(workspace), workspace);
    assert.equal(parseWebAppUrl(WEB_APP.replace('https:', 'http:')), null);
    assert.equal(parseWebAppUrl(WEB_APP.replace('script.google.com', 'script.google.com.evil.example')), null);
    assert.equal(parseWebAppUrl(WEB_APP.replace('/exec', '/dev')), null);
    assert.equal(parseWebAppUrl(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`), null);
    assert.equal(parseWebAppUrl('not a link'), null);
    assert.ok(isTestDeploymentUrl(WEB_APP.replace('/exec', '/dev')));
    assert.ok(!isTestDeploymentUrl(WEB_APP));
  });

  test('the script embeds the secret and refuses anything else', () => {
    assert.match(appsScript('abc_DEF-123'), /const SECRET = 'abc_DEF-123';/);
    assert.throws(() => appsScript("x'; evil(); '"), /invalid secret/);
  });
});

describe('google sheets sync (Apps Script web app)', () => {
  let ctx;
  let admin;
  let google;
  let session;
  before(async () => {
    google = fakeGoogle();
    ctx = await startApp({ sheetsFetch: google.fetch });
    const a = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
    const m = await addUser(ctx.db, { name: 'Mohan M', email: 'mohan@sloka.test', role: 'manager', password: 'mohan-password-123' });
    const c = await addUser(ctx.db, { name: 'Kiran C', email: 'kiran@sloka.test', password: 'kiran-password-123' });
    admin = client(ctx.base, (await login(ctx.base, a.email, a.password)).cookie);
    ctx.managerApi = client(ctx.base, (await login(ctx.base, m.email, m.password)).cookie);
    ctx.counsellorApi = client(ctx.base, (await login(ctx.base, c.email, c.password)).cookie);
    session = (await admin.post('/api/sessions', { title: 'Careers in VLSI', sessionDate: localDate(), mode: 'online' })).data.session;
  });
  after(() => ctx.close());

  const register = async (extra = {}) => {
    const r = await fetch(`${ctx.base}/api/public/certificate-registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({
        sessionId: session.id,
        code: session.code,
        name: 'Asha Kumar',
        email: 'asha@example.com',
        phone: '9876543210',
        college: 'JNTU Hyderabad',
        stream: 'electronics',
        consent: true,
        ...extra,
      }),
    });
    assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
    return (await r.json()).certificate;
  };
  const syncNow = () => admin.post('/api/settings/google-sheet/sync');

  test('settings: no service account needed; the script (with its secret) is for admins only', async () => {
    assert.equal((await ctx.counsellorApi.get('/api/settings')).status, 403);
    const r = await admin.get('/api/settings');
    assert.equal(r.status, 200);
    assert.equal(r.data.googleSheet.configured, false);
    assert.equal(r.data.googleSheet.webAppUrl, null);
    assert.equal(r.data.googleSheet.pending, null);
    assert.equal('serviceAccountEmail' in r.data.googleSheet, false);

    assert.equal((await ctx.managerApi.get('/api/settings/google-sheet/script')).status, 403, 'managers cannot export');
    const s1 = await admin.get('/api/settings/google-sheet/script');
    assert.equal(s1.status, 200);
    const secret = /const SECRET = '([A-Za-z0-9_-]{32})';/.exec(s1.data.script)[1];
    assert.equal(/const SECRET = '([^']+)'/.exec((await admin.get('/api/settings/google-sheet/script')).data.script)[1], secret, 'the secret stays the same');
    google.install(s1.data.script);

    const sync = await syncNow();
    assert.equal(sync.status, 400);
    assert.match(sync.data.fields.url, /Connect a sheet first/);
  });

  test('registrations and referred friends made before a sheet is connected are copied once it is; new ones follow', async () => {
    const c1 = await register({
      referrals: [
        { name: 'Ravi Teja', phone: '9123456780', college: 'Osmania University' },
        { name: 'Meena K', phone: '9000000001', college: '=HYPERLINK("x")' },
      ],
      referralConsent: true,
    });
    await ctx.settle();
    assert.equal(google.calls, 0, 'nothing to sync to yet');

    for (const [url, msg] of [
      ['https://docs.google.com/spreadsheets/d/x/edit', /Web app URL from Apps Script/],
      [WEB_APP.replace('/exec', '/dev'), /test URL \(ending in \/dev\)/],
    ]) {
      const bad = await admin.put('/api/settings/google-sheet', { url });
      assert.equal(bad.status, 400);
      assert.match(bad.data.fields.url, msg);
    }
    assert.equal((await ctx.managerApi.put('/api/settings/google-sheet', { url: WEB_APP })).status, 403);

    const saved = await admin.put('/api/settings/google-sheet', { url: WEB_APP });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.check, { ok: true, title: 'Sloka registrations' });
    assert.equal(saved.data.googleSheet.sheetId, SHEET_ID, 'learned from the script');
    assert.equal(saved.data.googleSheet.sheetUrl, `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
    await new Promise((r) => setTimeout(r, 50));
    await ctx.settle();

    const regs = google.rows('Career Guidance Registrations');
    assert.equal(regs[0][0], 'Submitted at');
    assert.equal(regs.length, 2);
    assert.equal(regs[1][1], c1.id);
    assert.equal(regs[1][3], 'asha@example.com');
    assert.equal(regs[1][4], '9876543210', 'kept as text (no number formatting)');
    assert.equal(regs[1][6], 'Electronics');
    assert.ok(google.tabs.get('Career Guidance Registrations').grid[1][1].startsWith("'"), 'written as plain text');

    const friends = google.rows('Referrals');
    assert.deepEqual(friends[0].slice(0, 5), ['Referred at', "Friend's name", "Friend's phone", "Friend's college", 'Referred by']);
    assert.equal(friends.length, 3);
    assert.deepEqual(friends[1].slice(1, 9), ['Ravi Teja', '9123456780', 'Osmania University', 'Asha Kumar', '9876543210', 'JNTU Hyderabad', c1.id, 'Careers in VLSI']);
    assert.equal(friends[2][3], '=HYPERLINK("x")', 'text, never a formula');
    assert.equal(google.tabs.get('Referrals').grid[2][3], `'=HYPERLINK("x")`);

    const c2 = await register({ email: 'ravi@example.com', name: 'Ravi Teja', phone: '9123456780' });
    await new Promise((r) => setTimeout(r, 1700)); // the debounce after a registration
    await ctx.settle();
    assert.equal(google.rows('Career Guidance Registrations').length, 3);
    assert.equal(google.rows('Career Guidance Registrations')[2][1], c2.id);
    assert.equal(google.rows('Referrals').length, 3, 'no friends on that one');

    const status = (await admin.get('/api/settings')).data.googleSheet;
    assert.equal(status.pending, 0);
    assert.ok(status.lastSyncAt);
    assert.equal(status.lastError, null);
    assert.equal(status.sheetTitle, 'Sloka registrations');
  });

  test('rows are never duplicated, even when the server sends them again', async () => {
    await ctx.db.run('DELETE FROM sheet_sync');
    const r = await syncNow();
    assert.equal(r.data.ok, true);
    assert.equal(r.data.synced, 2, 'sent again');
    assert.equal(google.rows('Career Guidance Registrations').length, 3, 'but the script skipped rows already there');
    assert.equal(google.rows('Referrals').length, 3);
  });

  test('a wrong secret, a private deployment or a bad URL give clear messages; rows wait for the retry', async () => {
    const other = await fetch(`${ctx.base}/api/public/certificate-registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ sessionId: session.id, code: session.code, name: 'Meena K', email: 'meena@example.com', phone: '9000000002', college: 'VNR VJIET', consent: true }),
    });
    assert.equal(other.status, 201);

    google.install(appsScript('a-different-secret'));
    let r = await syncNow();
    assert.equal(r.data.ok, false);
    assert.match(r.data.message, /different secret/);
    assert.equal(r.data.googleSheet.pending, 1);
    assert.match(r.data.googleSheet.lastError, /different secret/);

    google.install((await admin.get('/api/settings/google-sheet/script')).data.script);
    google.mode = 'signin';
    r = await syncNow();
    assert.equal(r.data.ok, false);
    assert.match(r.data.message, /Who has access/);

    google.mode = 'missing';
    const t = await admin.post('/api/settings/google-sheet/test');
    assert.equal(t.data.ok, false);
    assert.match(t.data.message, /no web app at this URL/);

    google.mode = 'ok';
    r = await syncNow();
    assert.equal(r.data.ok, true);
    assert.equal(r.data.synced, 1);
    assert.equal(r.data.googleSheet.lastError, null);
    assert.equal(google.rows('Career Guidance Registrations').length, 4);
  });

  test('disconnecting clears the sheet; nothing is sent', async () => {
    const r = await admin.put('/api/settings/google-sheet', { url: '' });
    assert.equal(r.status, 200);
    assert.equal(r.data.check, null);
    assert.equal(r.data.googleSheet.configured, false);
    assert.equal(r.data.googleSheet.sheetId, null);
    const calls = google.calls;
    await register({ email: 'new@example.com', phone: '9000000003', name: 'New Person' });
    await new Promise((r2) => setTimeout(r2, 1700));
    await ctx.settle();
    assert.equal(google.calls, calls);
  });
});
