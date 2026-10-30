'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, validInquiry, postPublic, addUser, login, client, ALLOWED_ORIGIN } = require('./helpers');
const { loadConfig } = require('../src/config');
const { localDate } = require('../src/util');

const daysFromToday = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
};

describe('staff API', () => {
  let ctx, admin, counsellor, adminApi, counsellorApi, adminCookie;

  before(async () => {
    ctx = await startApp();
    admin = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
    counsellor = await addUser(ctx.db, { name: 'Kiran Counsellor', email: 'kiran@sloka.test', role: 'counsellor', password: 'kiran-password-123' });
    adminCookie = (await login(ctx.base, admin.email, admin.password)).cookie;
    adminApi = client(ctx.base, adminCookie);
    counsellorApi = client(ctx.base, (await login(ctx.base, counsellor.email, counsellor.password)).cookie);
  });
  after(() => ctx.close());

  const latestId = async () => (await ctx.db.get('SELECT MAX(id) AS id FROM inquiries')).id;

  test('unauthenticated staff routes return 401', async () => {
    const anon = client(ctx.base, '');
    const garbage = client(ctx.base, 'sloka_session=not-a-jwt');
    for (const api of [anon, garbage]) {
      for (const [method, path] of [
        ['get', '/api/auth/me'],
        ['get', '/api/meta'],
        ['get', '/api/staff'],
        ['get', '/api/stats'],
        ['get', '/api/inquiries'],
        ['get', '/api/inquiries/1'],
        ['get', '/api/inquiries/export'],
        ['post', '/api/inquiries'],
        ['patch', '/api/inquiries/1'],
        ['post', '/api/inquiries/1/notes'],
        ['del', '/api/inquiries/1'],
        ['get', '/api/users'],
        ['post', '/api/users'],
      ]) {
        const res = await api[method](path, method === 'patch' ? {} : undefined);
        assert.equal(res.status, 401, `${method} ${path}`);
      }
    }
  });

  test('staff routes never send CORS headers', async () => {
    const res = await fetch(`${ctx.base}/api/stats`, { headers: { Origin: ALLOWED_ORIGIN } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    const pre = await fetch(`${ctx.base}/api/inquiries`, {
      method: 'OPTIONS',
      headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
  });

  test('login sets a hardened session cookie; wrong password is rejected', async () => {
    const bad = await login(ctx.base, admin.email, 'wrong-password-xx');
    assert.equal(bad.res.status, 401);
    assert.equal(bad.setCookie, '');

    const ok = await login(ctx.base, 'ADMIN@sloka.test', admin.password);
    assert.equal(ok.res.status, 200);
    assert.equal(ok.body.user.role, 'admin');
    assert.match(ok.setCookie, /HttpOnly/i);
    assert.match(ok.setCookie, /SameSite=Strict/i);
    assert.match(ok.setCookie, /Max-Age=28800/);
    assert.doesNotMatch(ok.setCookie, /Secure/i, 'Secure only in production');

    const me = await client(ctx.base, ok.cookie).get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.deepEqual(me.data.user, {
      id: admin.id,
      name: 'Anita Admin',
      email: 'admin@sloka.test',
      role: 'admin',
      permissions: ['manage', 'export', 'editRecords', 'deleteRecords', 'deactivateUsers', 'manageAdmins'],
    });
  });

  test('counsellor gets 403 on export, delete and user management', async () => {
    await postPublic(ctx.base, validInquiry());
    const id = await latestId();
    for (const [method, path, body] of [
      ['get', '/api/inquiries/export'],
      ['del', `/api/inquiries/${id}`],
      ['get', '/api/users'],
      ['post', '/api/users', { name: 'X Y', email: 'x@y.com', role: 'admin', password: 'long-enough-pw' }],
      ['patch', `/api/users/${counsellor.id}`, { role: 'admin' }],
      ['post', `/api/users/${counsellor.id}/password`, { password: 'another-long-pw' }],
    ]) {
      const res = await counsellorApi[method](path, body);
      assert.equal(res.status, 403, `${method} ${path}`);
    }
    assert.ok((await adminApi.get(`/api/inquiries/${id}`)).status === 200, 'not deleted');
    assert.equal((await ctx.db.get('SELECT role FROM users WHERE id = ?', [counsellor.id])).role, 'counsellor');
  });

  test('counsellor: view, update status/assignee/follow-up and add notes', async () => {
    await postPublic(ctx.base, validInquiry({ name: 'Meera Rao', phone: '8123456789', email: 'meera@example.com' }));
    const id = await latestId();

    const list = await counsellorApi.get('/api/inquiries?status=new');
    assert.equal(list.status, 200);
    assert.ok(list.data.items.some((i) => i.id === id));

    const detail = await counsellorApi.get(`/api/inquiries/${id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.inquiry.phone, '+918123456789');
    assert.deepEqual(detail.data.notes, []);

    const followUp = daysFromToday(2);
    const upd = await counsellorApi.patch(`/api/inquiries/${id}`, { status: 'contacted', assignedTo: counsellor.id, nextFollowUp: followUp });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.inquiry.status, 'contacted');
    assert.deepEqual(upd.data.inquiry.assignedTo, { id: counsellor.id, name: 'Kiran Counsellor' });
    assert.equal(upd.data.inquiry.nextFollowUp, followUp);

    const note = await counsellorApi.post(`/api/inquiries/${id}/notes`, { body: 'Called, will visit on Saturday.' });
    assert.equal(note.status, 201);
    assert.equal(note.data.note.author.name, 'Kiran Counsellor');

    const after = await counsellorApi.get(`/api/inquiries/${id}`);
    const notes = after.data.notes;
    assert.equal(notes.length, 2);
    assert.equal(notes[0].kind, 'change');
    assert.match(notes[0].body, /Status: New → Contacted/);
    assert.match(notes[0].body, /Assigned to: — → Kiran Counsellor/);
    assert.equal(notes[1].kind, 'note');
    assert.equal(notes[1].body, 'Called, will visit on Saturday.');
    assert.equal(notes[1].author.id, counsellor.id);
    assert.ok(notes[1].createdAt);

    // validation
    assert.equal((await counsellorApi.patch(`/api/inquiries/${id}`, { status: 'won' })).status, 400);
    assert.equal((await counsellorApi.patch(`/api/inquiries/${id}`, { nextFollowUp: '2026-02-30' })).status, 400);
    assert.equal((await counsellorApi.patch(`/api/inquiries/${id}`, { assignedTo: 999 })).status, 400);
    assert.equal((await counsellorApi.patch(`/api/inquiries/${id}`, { name: '' })).status, 400);
    assert.equal((await counsellorApi.post(`/api/inquiries/${id}/notes`, { body: '   ' })).status, 400);
    assert.equal((await counsellorApi.get('/api/inquiries/999999')).status, 404);
    assert.equal((await counsellorApi.patch('/api/inquiries/abc', { status: 'new' })).status, 404);

    // clearing the follow-up and assignee
    const cleared = await counsellorApi.patch(`/api/inquiries/${id}`, { assignedTo: null, nextFollowUp: null });
    assert.equal(cleared.data.inquiry.assignedTo, null);
    assert.equal(cleared.data.inquiry.nextFollowUp, null);
  });

  test('manual enquiry (phone call / walk-in) by staff', async () => {
    const missingConsent = await counsellorApi.post('/api/inquiries', { source: 'walk-in', name: 'Walk In', phone: '9988776655' });
    assert.equal(missingConsent.status, 400);
    assert.ok(missingConsent.data.fields.consent);

    const wrongSource = await counsellorApi.post('/api/inquiries', { source: 'contact', name: 'Walk In', phone: '9988776655', consent: true });
    assert.equal(wrongSource.status, 400);
    assert.ok(wrongSource.data.fields.source);

    const notified = ctx.notifications.length;
    const res = await counsellorApi.post('/api/inquiries', {
      source: 'phone-call',
      name: 'Phone Caller',
      phone: '099887 76655',
      email: '',
      stream: 'pharmacy',
      plan: 'basic',
      assignedTo: counsellor.id,
      nextFollowUp: daysFromToday(1),
      note: 'Asked about fees.',
      consent: true,
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.inquiry.source, 'phone-call');
    assert.equal(res.data.inquiry.phone, '+919988776655');
    assert.equal(res.data.inquiry.email, null);
    assert.equal(res.data.inquiry.status, 'new');
    assert.equal(res.data.inquiry.createdBy.id, counsellor.id);
    assert.ok(res.data.inquiry.consentAt);
    assert.equal(res.data.notes[0].body, 'Asked about fees.');
    assert.equal(ctx.notifications.length, notified, 'staff-entered enquiries do not notify');
  });

  test('list filters, search and pagination', async () => {
    const q = await adminApi.get('/api/inquiries?q=81234%2056789');
    assert.ok(q.data.items.length >= 1);
    assert.ok(q.data.items.every((i) => i.phone.includes('8123456789')));

    const byName = await adminApi.get('/api/inquiries?q=meera');
    assert.ok(byName.data.items.every((i) => /meera/i.test(i.name)));
    assert.equal((await adminApi.get('/api/inquiries?q=%25')).data.total, 0, 'LIKE wildcards are escaped');

    const bySource = await adminApi.get('/api/inquiries?source=phone-call');
    assert.ok(bySource.data.items.length >= 1 && bySource.data.items.every((i) => i.source === 'phone-call'));

    const mine = await counsellorApi.get('/api/inquiries?assignedTo=me');
    assert.ok(mine.data.items.every((i) => i.assignedTo && i.assignedTo.id === counsellor.id));

    const all = await adminApi.get('/api/inquiries');
    const page = await adminApi.get('/api/inquiries?pageSize=2&page=2&sort=name&dir=asc');
    assert.equal(page.data.pageSize, 2);
    assert.equal(page.data.page, 2);
    assert.equal(page.data.total, all.data.total);
    assert.ok(page.data.items.length <= 2);

    for (const bad of ['status=won', 'sort=password_hash', 'dir=sideways', 'pageSize=1000', 'followUp=someday', 'stream=x']) {
      const r = await adminApi.get(`/api/inquiries?${bad}`);
      assert.equal(r.status, 400, bad);
      assert.equal(r.data.error, 'validation');
    }
  });

  test('admin: CSV export with BOM, CRLF, labels, filters and formula-injection escaping', async () => {
    await postPublic(
      ctx.base,
      validInquiry({
        name: '=HYPERLINK("http://evil.example","x")',
        phone: '7012345678',
        college: '+SUM(A1:A9)',
        domain: '@cmd',
        message: '-2+3\nsecond, "quoted" line',
        stream: 'computer-science',
        plan: 'basic',
        source: 'contact',
      }),
    );
    const res = await adminApi.get('/api/inquiries/export');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="sloka-enquiries-\d{4}-\d{2}-\d{2}\.csv"/);
    const csv = res.data; // fetch's text() strips the BOM, so check the raw bytes separately
    const raw = new Uint8Array(await (await fetch(`${ctx.base}/api/inquiries/export`, { headers: { Cookie: adminCookie } })).arrayBuffer());
    assert.deepEqual([...raw.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM bytes');
    const lines = csv.split('\r\n');
    assert.ok(lines[0].startsWith('ID,Created at,Name,Phone,Email,College,Stream,Year of study,Domain,Plan,Source'));
    assert.ok(!csv.replace(/\r\n/g, '').includes('\r'), 'only CRLF line endings outside quoted values');

    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil.example"",""x"")"`), 'leading = neutralised and quotes escaped');
    assert.ok(csv.includes(",'+SUM(A1:A9),"), 'leading + neutralised');
    assert.ok(csv.includes(",'@cmd,"), 'leading @ neutralised');
    assert.ok(csv.includes(`"'-2+3\nsecond, ""quoted"" line"`), 'leading - neutralised, multiline quoted');
    assert.ok(csv.includes(',7012345678,'), 'phone exported as the 10-digit national number');
    assert.ok(!csv.includes('+91'), 'no +91 phones (Excel would show a literal apostrophe)');
    assert.ok(csv.includes('Computer Science') && csv.includes('Basic Foundation') && csv.includes('Contact'), 'human labels');

    const filtered = await adminApi.get('/api/inquiries/export?source=phone-call');
    const rows = filtered.data.trim().split('\r\n').slice(1);
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.includes('Phone call')), 'export respects filters');
  });

  test('admin: permanent delete removes enquiry and notes', async () => {
    await postPublic(ctx.base, validInquiry({ name: 'Delete Me', phone: '6111111111' }));
    const id = await latestId();
    await adminApi.post(`/api/inquiries/${id}/notes`, { body: 'erasure requested' });
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM inquiry_notes WHERE inquiry_id = ?', [id])).n, 1);
    const res = await adminApi.del(`/api/inquiries/${id}`);
    assert.equal(res.status, 204);
    assert.equal((await adminApi.get(`/api/inquiries/${id}`)).status, 404);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM inquiry_notes WHERE inquiry_id = ?', [id])).n, 0);
    assert.equal((await adminApi.del(`/api/inquiries/${id}`)).status, 404);
  });

  test('admin user management; deactivation takes effect immediately', async () => {
    const weak = await adminApi.post('/api/users', { name: 'New Person', email: 'new@sloka.test', role: 'counsellor', password: 'short' });
    assert.equal(weak.status, 400);
    assert.ok(weak.data.fields.password);

    const created = await adminApi.post('/api/users', { name: 'New Person', email: 'New@Sloka.test', role: 'counsellor', password: 'a-long-password' });
    assert.equal(created.status, 201);
    assert.equal(created.data.user.email, 'new@sloka.test');
    const dup = await adminApi.post('/api/users', { name: 'Dup', email: 'new@sloka.test', role: 'counsellor', password: 'a-long-password' });
    assert.equal(dup.status, 400);

    const session = await login(ctx.base, 'new@sloka.test', 'a-long-password');
    const api = client(ctx.base, session.cookie);
    assert.equal((await api.get('/api/auth/me')).status, 200);

    const deact = await adminApi.patch(`/api/users/${created.data.user.id}`, { active: false });
    assert.equal(deact.status, 200);
    assert.equal(deact.data.user.active, false);
    assert.equal((await api.get('/api/auth/me')).status, 401, 'existing session rejected');
    assert.equal((await login(ctx.base, 'new@sloka.test', 'a-long-password')).res.status, 401);

    // reset password + reactivate
    assert.equal((await adminApi.post(`/api/users/${created.data.user.id}/password`, { password: 'reset-password-1' })).status, 204);
    await adminApi.patch(`/api/users/${created.data.user.id}`, { active: true });
    assert.equal((await login(ctx.base, 'new@sloka.test', 'reset-password-1')).res.status, 200);

    // safety rails
    const self = await adminApi.patch(`/api/users/${admin.id}`, { active: false });
    assert.equal(self.status, 400);
    const selfDemote = await adminApi.patch(`/api/users/${admin.id}`, { role: 'counsellor' });
    assert.equal(selfDemote.status, 400);

    const users = await adminApi.get('/api/users');
    assert.ok(users.data.users.every((u) => !('password_hash' in u) && !('passwordHash' in u)));
  });

  test('change own password', async () => {
    const u = await addUser(ctx.db, { name: 'Pass Changer', email: 'pc@sloka.test', password: 'first-password-1' });
    const s = await login(ctx.base, u.email, u.password);
    const api = client(ctx.base, s.cookie);
    const wrong = await api.post('/api/auth/password', { currentPassword: 'nope', newPassword: 'second-password-2' });
    assert.equal(wrong.status, 400);
    const ok = await api.post('/api/auth/password', { currentPassword: 'first-password-1', newPassword: 'second-password-2' });
    assert.equal(ok.status, 204);
    assert.equal((await api.get('/api/auth/me')).status, 401, 'old session invalidated');
    assert.equal((await login(ctx.base, u.email, 'second-password-2')).res.status, 200);
  });

  test('cross-site state-changing requests are refused', async () => {
    const id = await latestId();
    const cookie = (await login(ctx.base, counsellor.email, counsellor.password)).cookie;
    for (const headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { Origin: 'https://evil.example' }]) {
      const res = await fetch(`${ctx.base}/api/inquiries/${id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ status: 'not-interested' }),
      });
      assert.equal(res.status, 403, JSON.stringify(headers));
    }
    const same = await fetch(`${ctx.base}/api/inquiries/${id}/notes`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Origin: ctx.base },
      body: JSON.stringify({ body: 'same-origin ok' }),
    });
    assert.equal(same.status, 201);
  });

  test('failed logins are rate limited per email + IP', async () => {
    const u = await addUser(ctx.db, { name: 'Rate Limited', email: 'rl@sloka.test', password: 'rate-limit-pass' });
    for (let i = 0; i < 5; i++) assert.equal((await login(ctx.base, u.email, `wrong-${i}-password`)).res.status, 401);
    const blocked = await login(ctx.base, u.email, u.password);
    assert.equal(blocked.res.status, 429);
    assert.deepEqual(blocked.body, { error: 'rate_limited' });
  });

  test('noindex headers, robots.txt and CSP', async () => {
    for (const path of ['/', '/robots.txt', '/api/auth/me', '/api/public/inquiries']) {
      const res = await fetch(`${ctx.base}${path}`);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow', path);
    }
    const page = await fetch(`${ctx.base}/`);
    assert.equal(page.status, 200);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(await page.text(), /<meta name="robots" content="noindex,nofollow">/);
    const robots = await (await fetch(`${ctx.base}/robots.txt`)).text();
    assert.match(robots, /User-agent: \*\s+Disallow: \//);
  });
});

describe('stats', () => {
  let ctx, api;
  before(async () => {
    ctx = await startApp();
    const a = await addUser(ctx.db, { name: 'Stats Admin', email: 'stats@sloka.test', role: 'admin', password: 'stats-password-1' });
    api = client(ctx.base, (await login(ctx.base, a.email, a.password)).cookie);
    const today = daysFromToday(0);
    const yesterday = daysFromToday(-1);
    const now = new Date().toISOString();
    const insert = (...values) =>
      ctx.db.run(
        `INSERT INTO inquiries (name, phone, email, stream, plan, source, status, next_follow_up, consent_at, created_at, updated_at)
        VALUES (?, '+919000000000', 'x@example.com', ?, ?, 'contact', ?, ?, ?, ?, ?)`,
        values,
      );
    for (const [stream, plan, status, fu] of [
      ['computer-science', 'basic', 'new', null],
      ['computer-science', 'premium', 'enrolled', yesterday], // closed: not overdue
      ['computer-science', 'premium', 'pre-registered', today], // due today
      ['management', 'basic', 'contacted', yesterday], // overdue
      [null, null, 'new', today], // due today
      ['management', 'premium', 'enrolled', today], // closed: not due
      ['electronics', 'undecided', 'not-interested', yesterday], // closed
    ]) {
      await insert('Student', stream, plan, status, fu, now, now, now);
    }
  });
  after(() => ctx.close());

  test('overview numbers', async () => {
    const { status, data } = await api.get('/api/stats');
    assert.equal(status, 200);
    assert.equal(data.today, daysFromToday(0));
    assert.equal(data.total, 7);
    assert.equal(data.newCount, 2);
    assert.equal(data.dueToday, 2);
    assert.equal(data.overdue, 1);
    assert.deepEqual(
      Object.fromEntries(data.byStatus.map((s) => [s.status, s.count])),
      { new: 2, contacted: 1, counselled: 0, 'pre-registered': 1, enrolled: 2, 'not-interested': 1 },
    );
    assert.deepEqual(data.byStream, [
      { stream: 'computer-science', label: 'Computer Science', total: 3, preRegistered: 1, enrolled: 1, enrolledPct: 33.3 },
      { stream: 'management', label: 'Management', total: 2, preRegistered: 0, enrolled: 1, enrolledPct: 50 },
      { stream: 'electronics', label: 'Electronics', total: 1, preRegistered: 0, enrolled: 0, enrolledPct: 0 },
      { stream: null, label: 'Not specified', total: 1, preRegistered: 0, enrolled: 0, enrolledPct: 0 },
    ]);
    assert.deepEqual(data.byPlan, [
      { plan: 'basic', label: 'Basic Foundation', total: 2, preRegistered: 0, enrolled: 0, enrolledPct: 0 },
      { plan: 'premium', label: 'Premium Foundation', total: 3, preRegistered: 1, enrolled: 2, enrolledPct: 66.7 },
      { plan: 'undecided', label: 'Undecided', total: 1, preRegistered: 0, enrolled: 0, enrolledPct: 0 },
      { plan: null, label: 'Not specified', total: 1, preRegistered: 0, enrolled: 0, enrolledPct: 0 },
    ]);
  });

  test('follow-up filters match the stats', async () => {
    assert.equal((await api.get('/api/inquiries?followUp=today')).data.total, 2);
    assert.equal((await api.get('/api/inquiries?followUp=overdue')).data.total, 1);
    assert.equal((await api.get('/api/inquiries?followUp=due')).data.total, 3);
    assert.equal((await api.get('/api/inquiries?stream=none')).data.total, 1);
  });
});

describe('config', () => {
  const DATABASE_URL = 'mysql://user:pass@db.example:4000/sloka_academy';

  test('refuses to start without a strong JWT_SECRET', () => {
    assert.throws(() => loadConfig({}), /JWT_SECRET/);
    assert.throws(() => loadConfig({ JWT_SECRET: 'too-short', DATABASE_URL }), /JWT_SECRET/);
    assert.doesNotThrow(() => loadConfig({ JWT_SECRET: 'x'.repeat(32), DATABASE_URL }));
  });

  test('parses origins and trust proxy', () => {
    const c = loadConfig({ JWT_SECRET: 'x'.repeat(32), DATABASE_URL, ALLOWED_ORIGINS: 'https://a.example/, https://b.example', TRUST_PROXY: '1' });
    assert.deepEqual(c.allowedOrigins, ['https://a.example', 'https://b.example']);
    assert.equal(c.trustProxy, 1);
    assert.deepEqual(loadConfig({ JWT_SECRET: 'x'.repeat(32), DATABASE_URL }).allowedOrigins, ['http://localhost:3000']);
  });

  test('DATABASE_URL: required, names a database of its own, TLS unless turned off', () => {
    const jwt = { JWT_SECRET: 'x'.repeat(32) };
    assert.throws(() => loadConfig(jwt), /DATABASE_URL must be set/);
    assert.throws(() => loadConfig({ ...jwt, DATABASE_URL: 'postgres://u:p@h/db' }), /must start with mysql/);
    assert.throws(() => loadConfig({ ...jwt, DATABASE_URL: 'mysql://u:p@h:4000/' }), /database name/);
    assert.throws(() => loadConfig({ ...jwt, DATABASE_URL: 'mysql://u:p@h:4000/sys' }), /built-in "sys"/);
    assert.deepEqual(loadConfig({ ...jwt, DATABASE_URL: 'mysql://a.root:p%40ss@gw.example:4000/sloka_academy' }).database, {
      host: 'gw.example',
      port: 4000,
      user: 'a.root',
      password: 'p@ss',
      database: 'sloka_academy',
      ssl: true,
    });
    assert.equal(loadConfig({ ...jwt, DATABASE_URL: 'mysql://u:p@localhost/dev?ssl=false' }).database.ssl, false);
  });
});
