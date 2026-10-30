'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, addUser, login, client, ALLOWED_ORIGIN } = require('./helpers');
const { loadConfig } = require('../src/config');
const { localDate } = require('../src/util');

const ID_RE = /^SLK-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/;
const WRONG_CODE = "That code doesn't match this session. Use the code announced at the end of the session.";
const CLOSED = 'Registration for this session is closed.';
const BAD_NAME = 'Please write your name in English letters, exactly as it should appear on the certificate.';

const daysFromToday = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
};

function publicPost(base, path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
    body: JSON.stringify(body),
  });
}

const student = (sessionId, code, extra = {}) => ({
  sessionId,
  code,
  name: 'Priya Sharma',
  email: 'Priya.Sharma@Example.com',
  phone: '98765 43210',
  college: 'CVR College of Engineering',
  stream: 'electronics',
  yearOfStudy: 'year-3',
  consent: true,
  website: '',
  ...extra,
});

async function setup(options) {
  const ctx = await startApp(options);
  const admin = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
  const counsellor = await addUser(ctx.db, { name: 'Kiran C', email: 'kiran@sloka.test', role: 'counsellor', password: 'kiran-password-123' });
  ctx.admin = admin;
  ctx.adminCookie = (await login(ctx.base, admin.email, admin.password)).cookie;
  ctx.adminApi = client(ctx.base, ctx.adminCookie);
  ctx.counsellorApi = client(ctx.base, (await login(ctx.base, counsellor.email, counsellor.password)).cookie);
  ctx.newSession = async (extra = {}) => {
    const r = await ctx.adminApi.post('/api/sessions', {
      title: 'Careers in VLSI and Embedded Systems',
      sessionDate: daysFromToday(-1),
      venue: 'CVR College of Engineering, Hyderabad',
      mode: 'in-person',
      ...extra,
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.session;
  };
  ctx.register = async (body) => {
    const res = await publicPost(ctx.base, '/api/public/certificate-registrations', body);
    return { res, status: res.status, data: await res.json() };
  };
  return ctx;
}

describe('certificates: public API', () => {
  let ctx;
  let open;
  let issued; // { id, downloadPath }
  before(async () => {
    ctx = await setup();
    open = await ctx.newSession();
  });
  after(() => ctx.close());

  const regCount = async () => (await ctx.db.get('SELECT COUNT(*) AS n FROM certificate_registrations')).n;

  test('session codes are generated from the unambiguous alphabet', () => {
    assert.match(open.code, /^[A-HJKMNP-Z2-9]{6}$/);
    assert.doesNotMatch(open.code, /[01OIL]/);
  });

  test('public sessions list: only open sessions, newest first, never the code', async () => {
    const closed = await ctx.newSession({ title: 'Closed Session', registrationOpen: false });
    const expired = await ctx.newSession({ title: 'Expired Session', closesAt: new Date(Date.now() - 60000).toISOString() });
    const newer = await ctx.newSession({ title: 'Newer Session', sessionDate: daysFromToday(3), mode: 'online', venue: '' });
    const res = await fetch(`${ctx.base}/api/public/sessions`, { headers: { Origin: ALLOWED_ORIGIN } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    const text = await res.text();
    const { sessions } = JSON.parse(text);
    const ids = sessions.map((s) => s.id);
    assert.ok(ids.includes(open.id) && ids.includes(newer.id));
    assert.ok(!ids.includes(closed.id) && !ids.includes(expired.id));
    assert.equal(ids[0], newer.id, 'newest date first');
    for (const s of sessions) assert.deepEqual(Object.keys(s).sort(), ['date', 'id', 'mode', 'title', 'venue']);
    for (const s of [open, closed, expired, newer]) assert.ok(!text.includes(s.code), 'code never exposed');
    assert.deepEqual(sessions.find((s) => s.id === open.id), {
      id: open.id,
      title: open.title,
      date: open.sessionDate,
      venue: open.venue,
      mode: 'in-person',
    });
  });

  test('CORS preflight allows GET and POST from allowed origins only', async () => {
    const pre = await fetch(`${ctx.base}/api/public/certificate-registrations`, {
      method: 'OPTIONS',
      headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.match(pre.headers.get('access-control-allow-methods'), /GET/);
    assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
    assert.equal(pre.headers.get('access-control-allow-credentials'), null);
    const evil = await fetch(`${ctx.base}/api/public/sessions`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });

  test('wrong code → 400 fields.code, nothing stored', async () => {
    const before = await regCount();
    const r = await ctx.register(student(open.id, 'WRONG1'));
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'validation');
    assert.equal(r.data.fields.code, WRONG_CODE);
    assert.equal(await regCount(), before);
  });

  test('unknown or closed session → 400 fields.sessionId', async () => {
    const r = await ctx.register(student(999999, open.code));
    assert.equal(r.status, 400);
    assert.equal(r.data.fields.sessionId, CLOSED);
    const closed = await ctx.newSession({ title: 'Closed Two', registrationOpen: false });
    const r2 = await ctx.register(student(closed.id, closed.code));
    assert.equal(r2.data.fields.sessionId, CLOSED);
  });

  test('non-Latin name → 400 fields.name', async () => {
    const r = await ctx.register(student(open.id, open.code, { name: 'ప్రియ శర్మ' }));
    assert.equal(r.status, 400);
    assert.equal(r.data.fields.name, BAD_NAME);
  });

  test('missing required fields and consent are reported', async () => {
    const r = await ctx.register({ sessionId: open.id, code: open.code });
    assert.equal(r.status, 400);
    for (const f of ['name', 'email', 'phone', 'college', 'consent']) assert.ok(r.data.fields[f], f);
  });

  test('honeypot → 201 {ok:true} without a certificate, nothing stored', async () => {
    const before = await regCount();
    const r = await ctx.register(student(open.id, open.code, { website: 'http://spam.example', email: 'bot@example.com' }));
    assert.equal(r.status, 201);
    assert.deepEqual(r.data, { ok: true });
    assert.equal(await regCount(), before);
  });

  test('correct code (any case, padded) → 201 with certificate', async () => {
    const r = await ctx.register(student(open.id, `  ${open.code.toLowerCase()} `, { name: '  priya   Sharma ' }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const c = r.data.certificate;
    assert.deepEqual(Object.keys(r.data), ['certificate', 'emailing']);
    assert.equal(r.data.emailing, false, 'no SMTP in this setup');
    assert.deepEqual(Object.keys(c).sort(), ['downloadPath', 'id', 'issuedAt', 'name', 'sessionDate', 'sessionTitle', 'studentId']);
    assert.match(c.studentId, new RegExp(`^SLK-STU-${new Date().getFullYear()}-\\d{5}$`));
    assert.match(c.id, ID_RE);
    assert.equal(c.id.slice(4, 8), String(new Date().getFullYear()));
    assert.equal(c.name, 'priya Sharma');
    assert.equal(c.sessionTitle, open.title);
    assert.equal(c.sessionDate, open.sessionDate);
    assert.ok(!Number.isNaN(Date.parse(c.issuedAt)));
    assert.match(c.downloadPath, new RegExp(`^/api/public/certificates/${c.id}/pdf\\?token=[A-Za-z0-9_-]{43}$`));
    issued = c;

    const row = (await ctx.db.get('SELECT * FROM certificate_registrations WHERE certificate_id = ?', [c.id]));
    assert.equal(row.email, 'priya.sharma@example.com');
    assert.equal(row.phone, '+919876543210');
    assert.equal(row.status, 'issued');
    assert.ok(row.consent_at);
    assert.equal(row.download_token_hash.length, 64);
    assert.ok(!c.downloadPath.includes(row.download_token_hash), 'only the hash is stored');
    assert.equal(ctx.notifications.length, 0, 'no team notification for certificate registrations');
  });

  test('duplicate (same session, email in different case) → 409, no certificate returned', async () => {
    const r = await ctx.register(student(open.id, open.code, { email: 'PRIYA.SHARMA@example.COM', name: 'Someone Else' }));
    assert.equal(r.status, 409);
    assert.deepEqual(r.data, { error: 'already_registered', emailed: false });
  });

  test('verify returns only the allowed fields (case-insensitive ID)', async () => {
    const res = await fetch(`${ctx.base}/api/public/certificates/${issued.id.toLowerCase()}/verify`, { headers: { Origin: ALLOWED_ORIGIN } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    const v = await res.json();
    assert.deepEqual(v, {
      id: issued.id,
      status: 'valid',
      name: 'priya Sharma',
      sessionTitle: open.title,
      sessionDate: open.sessionDate,
      issuedAt: issued.issuedAt,
    });
    const missing = await fetch(`${ctx.base}/api/public/certificates/SLK-2026-00000000/verify`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'not_found' });
  });

  test('PDF with the token → 200 application/pdf; wrong or missing token → 404', async () => {
    const res = await fetch(`${ctx.base}${issued.downloadPath}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.headers.get('content-disposition'), `attachment; filename="Sloka-Academy-Certificate-${issued.id}.pdf"`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
    const row = (await ctx.db.get('SELECT download_count, last_downloaded_at FROM certificate_registrations WHERE certificate_id = ?', [issued.id]));
    assert.equal(row.download_count, 1);
    assert.ok(row.last_downloaded_at);

    const wrong = await fetch(`${ctx.base}/api/public/certificates/${issued.id}/pdf?token=${'A'.repeat(43)}`);
    assert.equal(wrong.status, 404);
    const none = await fetch(`${ctx.base}/api/public/certificates/${issued.id}/pdf`);
    assert.equal(none.status, 404);
    const unknown = await fetch(`${ctx.base}/api/public/certificates/SLK-2026-00000000/pdf?token=x`);
    assert.equal(unknown.status, 404);
  });

  test('revoke → verify says revoked and PDF → 410; reinstate restores it', async () => {
    const regId = (await ctx.db.get('SELECT id FROM certificate_registrations WHERE certificate_id = ?', [issued.id])).id;
    assert.equal((await ctx.adminApi.post(`/api/certificates/${regId}/revoke`, {})).status, 400, 'reason required');
    const rv = await ctx.adminApi.post(`/api/certificates/${regId}/revoke`, { reason: 'Did not attend the session' });
    assert.equal(rv.status, 200);
    assert.equal(rv.data.certificate.status, 'revoked');

    const v = await (await fetch(`${ctx.base}/api/public/certificates/${issued.id}/verify`)).json();
    assert.equal(v.status, 'revoked');
    assert.deepEqual(Object.keys(v).sort(), ['id', 'issuedAt', 'name', 'sessionDate', 'sessionTitle', 'status']);
    const pdf = await fetch(`${ctx.base}${issued.downloadPath}`);
    assert.equal(pdf.status, 410);
    assert.match(await pdf.text(), /revoked/i);

    const staffPdf = await fetch(`${ctx.base}/api/certificates/${regId}/pdf`, { headers: { Cookie: ctx.adminCookie } });
    assert.equal(staffPdf.status, 200, 'staff can still download a (watermarked) copy');
    assert.equal(Buffer.from(await staffPdf.arrayBuffer()).subarray(0, 5).toString('latin1'), '%PDF-');

    const back = await ctx.adminApi.post(`/api/certificates/${regId}/reinstate`, {});
    assert.equal(back.status, 200);
    assert.equal(back.data.certificate.status, 'issued');
    assert.equal(back.data.certificate.revokedReason, null);
    assert.equal((await (await fetch(`${ctx.base}/api/public/certificates/${issued.id}/verify`)).json()).status, 'valid');
    assert.equal((await fetch(`${ctx.base}${issued.downloadPath}`)).status, 200);
    const types = back.data.events.map((e) => e.type);
    assert.deepEqual(types.slice(0, 1), ['registered']);
    assert.ok(types.includes('revoked') && types.includes('reinstated') && types.includes('downloaded'));
  });

  test('name correction is reflected in verify and logged old → new', async () => {
    const regId = (await ctx.db.get('SELECT id FROM certificate_registrations WHERE certificate_id = ?', [issued.id])).id;
    const bad = await ctx.adminApi.patch(`/api/certificates/${regId}`, { name: 'ప్రియ' });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.fields.name, BAD_NAME);
    const r = await ctx.adminApi.patch(`/api/certificates/${regId}`, { name: 'Priya Sharma' });
    assert.equal(r.status, 200);
    assert.equal(r.data.certificate.name, 'Priya Sharma');
    const ev = r.data.events.find((e) => e.type === 'name_corrected');
    assert.equal(ev.detail, 'priya Sharma → Priya Sharma');
    assert.equal(ev.actor.id, ctx.admin.id);
    const v = await (await fetch(`${ctx.base}/api/public/certificates/${issued.id}/verify`)).json();
    assert.equal(v.name, 'Priya Sharma');
  });
});

describe('certificates: staff API', () => {
  let ctx;
  let session;
  let regId;
  before(async () => {
    ctx = await setup();
    session = await ctx.newSession({ title: 'Data Science Careers', code: 'campus26' });
    const r = await ctx.register(student(session.id, 'CAMPUS26', { college: "=cmd|' /C calc'!A0", phone: '+91 70123 45678', email: 'ravi@example.com', name: 'Ravi Kumar' }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    regId = (await ctx.db.get('SELECT id FROM certificate_registrations WHERE certificate_id = ?', [r.data.certificate.id])).id;
  });
  after(() => ctx.close());

  test('custom code is stored upper-cased and shown to staff with the student link', async () => {
    assert.equal(session.code, 'CAMPUS26');
    assert.equal(session.studentLink, `https://www.slokaacademy.com/certificate/?session=${session.id}`);
    const bad = await ctx.adminApi.post('/api/sessions', { title: 'X Session', sessionDate: '2026-11-12', mode: 'in-person', venue: 'Somewhere', code: 'abc' });
    assert.equal(bad.status, 400);
    assert.ok(bad.data.fields.code);
    const noVenue = await ctx.adminApi.post('/api/sessions', { title: 'Y Session', sessionDate: '2026-11-12', mode: 'in-person' });
    assert.ok(noVenue.data.fields.venue);
    const telugu = await ctx.adminApi.post('/api/sessions', { title: 'కెరీర్ గైడెన్స్', sessionDate: '2026-11-12', mode: 'online' });
    assert.ok(telugu.data.fields.title, 'titles must be printable on the PDF');
  });

  test('counsellor: can view, search and download; 403 on admin actions', async () => {
    const api = ctx.counsellorApi;
    assert.equal((await api.get('/api/sessions')).status, 200);
    assert.equal((await api.get(`/api/sessions/${session.id}`)).status, 200);
    const list = await api.get(`/api/certificates?q=ravi`);
    assert.equal(list.status, 200);
    assert.equal(list.data.total, 1);
    const byId = await api.get(`/api/certificates?q=${list.data.items[0].certificateId.toLowerCase()}`);
    assert.equal(byId.data.total, 1);
    assert.equal((await api.get(`/api/certificates/${regId}`)).status, 200);
    assert.equal((await api.get(`/api/certificates/${regId}/pdf`)).status, 200);
    for (const [method, path, body] of [
      ['post', '/api/sessions', { title: 'Nope Session', sessionDate: '2026-11-12', mode: 'online' }],
      ['patch', `/api/sessions/${session.id}`, { registrationOpen: false }],
      ['post', `/api/sessions/${session.id}/regenerate-code`, {}],
      ['del', `/api/sessions/${session.id}`],
      ['get', `/api/sessions/${session.id}/export`],
      ['get', '/api/certificates/export'],
      ['patch', `/api/certificates/${regId}`, { name: 'New Name' }],
      ['post', `/api/certificates/${regId}/revoke`, { reason: 'Testing revoke' }],
      ['post', `/api/certificates/${regId}/reinstate`, {}],
      ['del', `/api/certificates/${regId}`],
    ]) {
      const r = await api[method](path, body);
      assert.equal(r.status, 403, `${method} ${path}`);
    }
    assert.equal((await ctx.db.get('SELECT status FROM certificate_registrations WHERE id = ?', [regId])).status, 'issued');
  });

  test('resend without SMTP configured is refused clearly', async () => {
    const r = await ctx.counsellorApi.post(`/api/certificates/${regId}/resend`, {});
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'email_not_configured');
  });

  test('session export: CSV with BOM, formula escaping and 10-digit phones', async () => {
    const res = await ctx.adminApi.get(`/api/sessions/${session.id}/export`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="sloka-session-\d+-.*\.csv"/);
    const csv = res.data;
    const lines = csv.split('\r\n');
    assert.ok(lines[0].startsWith('Certificate ID,Status,Name,Email,Phone,College'));
    assert.ok(csv.includes(`"'=cmd|' /C calc'!A0"`) || csv.includes(`,'=cmd|' /C calc'!A0,`), 'formula neutralised');
    assert.ok(csv.includes(',7012345678,'), 'phone as national number');
    assert.ok(!csv.includes('+91'));
    const raw = Buffer.from(await (await fetch(`${ctx.base}/api/sessions/${session.id}/export`, { headers: { Cookie: ctx.adminCookie } })).arrayBuffer());
    assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);

    const all = await ctx.adminApi.get('/api/certificates/export?status=issued');
    assert.equal(all.status, 200);
    assert.ok(all.data.includes('Ravi Kumar'));
  });

  test('deleting a session with registrations is refused; empty sessions can be deleted', async () => {
    const r = await ctx.adminApi.del(`/api/sessions/${session.id}`);
    assert.equal(r.status, 409);
    assert.equal(r.data.error, 'has_registrations');
    const empty = await ctx.newSession({ title: 'Empty Session' });
    assert.equal((await ctx.adminApi.del(`/api/sessions/${empty.id}`)).status, 204);
    assert.equal((await ctx.adminApi.get(`/api/sessions/${empty.id}`)).status, 404);
  });

  test('admin can close registration and regenerate the code', async () => {
    const old = session.code;
    const regen = await ctx.adminApi.post(`/api/sessions/${session.id}/regenerate-code`, {});
    assert.equal(regen.status, 200);
    assert.notEqual(regen.data.session.code, old);
    const closed = await ctx.adminApi.patch(`/api/sessions/${session.id}`, { registrationOpen: false });
    assert.equal(closed.data.session.registrationOpen, false);
    const r = await ctx.register(student(session.id, regen.data.session.code, { email: 'late@example.com' }));
    assert.equal(r.data.fields.sessionId, CLOSED);
  });

  test('overview stats include certificate numbers and recent activity', async () => {
    const s = await ctx.adminApi.get('/api/stats');
    assert.equal(s.status, 200);
    const c = s.data.certificates;
    assert.equal(c.issuedTotal, 1);
    assert.equal(c.revoked, 0);
    assert.equal(c.registrationsThisWeek, 1);
    assert.equal(typeof c.openSessions, 'number');
    assert.ok(c.recent.length >= 1 && c.recent[0].certificateId);
  });

  test('admin can permanently delete a registration and its activity log', async () => {
    assert.ok((await ctx.db.get('SELECT COUNT(*) AS n FROM certificate_events WHERE registration_id = ?', [regId])).n > 0);
    assert.equal((await ctx.adminApi.del(`/api/certificates/${regId}`)).status, 204);
    assert.equal((await ctx.adminApi.get(`/api/certificates/${regId}`)).status, 404);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM certificate_events WHERE registration_id = ?', [regId])).n, 0);
  });
});

describe('certificates: failed-code limiter', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.close());

  test('too many wrong codes per IP, then 429 (even with the right code)', async () => {
    const s = await ctx.newSession();
    const max = ctx.config.certCodeFailLimit.max;
    for (let i = 0; i < max; i++) {
      const r = await ctx.register(student(s.id, `WRONG${i}`, { email: `s${i}@example.com` }));
      assert.equal(r.status, 400, `attempt ${i + 1}`);
    }
    const blocked = await ctx.register(student(s.id, s.code));
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.data, { error: 'rate_limited' });
    assert.equal(blocked.res.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  });
});

describe('certificates: with student email configured', () => {
  let ctx;
  before(async () => {
    ctx = await setup({ studentEmail: true, config: { certResendCooldownMs: 0 } });
  });
  after(() => ctx.close());

  const regRow = async (certId) => (await ctx.db.get('SELECT * FROM certificate_registrations WHERE certificate_id = ?', [certId]));

  test('registration emails the certificate PDF; a repeat registration sends it again with a new link', async () => {
    const s = await ctx.newSession({ title: 'Cloud Careers' });
    const r = await ctx.register(student(s.id, s.code));
    assert.equal(r.status, 201);
    assert.equal(r.data.emailing, true);
    await ctx.settle();
    assert.equal(ctx.emails.length, 1);
    const mail = ctx.emails[0];
    assert.equal(mail.to, 'priya.sharma@example.com');
    assert.equal(mail.resent, false);
    assert.ok(Buffer.isBuffer(mail.pdf) && mail.pdf.subarray(0, 5).toString() === '%PDF-', 'PDF attached');
    assert.equal(mail.downloadUrl, `http://localhost:3000${r.data.certificate.downloadPath}`);
    assert.match(mail.verifyUrl, /^https:\/\/www\.slokaacademy\.com\/verify\/\?id=SLK-/);
    const row = await regRow(r.data.certificate.id);
    assert.equal(row.email_status, 'sent');
    assert.ok(row.emailed_at);

    const dup = await ctx.register(student(s.id, s.code, { email: 'priya.sharma@EXAMPLE.com' }));
    assert.equal(dup.status, 409);
    assert.deepEqual(dup.data, { error: 'already_registered', emailed: true });
    await ctx.settle();
    assert.equal(ctx.emails.length, 2);
    assert.equal(ctx.emails[1].resent, true);
    assert.equal((await fetch(`${ctx.base}${r.data.certificate.downloadPath}`)).status, 404, 'old link disabled');
    const newPath = new URL(ctx.emails[1].downloadUrl).pathname + new URL(ctx.emails[1].downloadUrl).search;
    assert.equal((await fetch(`${ctx.base}${newPath}`)).status, 200, 'new link works');
  });

  test('a failed email is recorded, shown to staff and can be retried', async () => {
    const s = await ctx.newSession({ title: 'Data Careers' });
    ctx.mail.fail = '550 mailbox unavailable';
    const r = await ctx.register(student(s.id, s.code, { email: 'kavya@example.com' }));
    assert.equal(r.status, 201);
    await ctx.settle();
    ctx.mail.fail = null;
    const row = await regRow(r.data.certificate.id);
    assert.equal(row.email_status, 'failed');
    assert.equal(row.email_error, '550 mailbox unavailable');

    const failed = await ctx.adminApi.get('/api/certificates?emailStatus=failed');
    assert.deepEqual(failed.data.items.map((i) => i.certificateId), [r.data.certificate.id]);
    const stats = await ctx.adminApi.get('/api/stats');
    assert.equal(stats.data.certificates.emailFailed, 1);

    const before = ctx.emails.length;
    const resend = await ctx.adminApi.post(`/api/certificates/${row.id}/resend`);
    assert.equal(resend.status, 200, JSON.stringify(resend.data));
    assert.equal(resend.data.result, 'sent');
    assert.equal(resend.data.certificate.emailStatus, 'sent');
    assert.equal(ctx.emails.length, before + 1);
    const types = resend.data.events.map((e) => e.type);
    assert.ok(types.includes('email_failed') && types.includes('emailed'), types.join());
  });

  test('admin can correct the email; the certificate then goes to the new address', async () => {
    const s = await ctx.newSession({ title: 'Design Careers' });
    const r = await ctx.register(student(s.id, s.code, { email: 'rahul@gmial.com', name: 'Rahul Verma', phone: '9811122233' }));
    await ctx.settle();
    const row = await regRow(r.data.certificate.id);
    const fix = await ctx.adminApi.patch(`/api/certificates/${row.id}`, { email: 'Rahul@Gmail.com' });
    assert.equal(fix.status, 200, JSON.stringify(fix.data));
    assert.equal(fix.data.certificate.email, 'rahul@gmail.com');
    const master = (await ctx.db.get('SELECT * FROM students WHERE id = ?', [fix.data.certificate.studentId]));
    assert.equal(master.email, 'rahul@gmail.com', 'typo fixed on the master record too');
    assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM students WHERE email = 'rahul@gmial.com'")).n, 0);
    const resend = await ctx.adminApi.post(`/api/certificates/${row.id}/resend`);
    assert.equal(resend.data.result, 'sent');
    assert.equal(ctx.emails.at(-1).to, 'rahul@gmail.com');
  });
});

describe('config', () => {
  test('defaults: enquiry limit 20/10min, certificate limits and URLs', () => {
    const DATABASE_URL = 'mysql://user:pass@db.example:4000/sloka_academy';
    const c = loadConfig({ JWT_SECRET: 'x'.repeat(32), DATABASE_URL });
    assert.deepEqual(c.publicRateLimit, { max: 20, windowMs: 600000 });
    assert.deepEqual(c.certRegisterRateLimit, { max: 300, windowMs: 600000 });
    assert.deepEqual(c.certCodeFailLimit, { max: 100, windowMs: 900000 });
    assert.equal(c.certIdPrefix, 'SLK');
    assert.equal(c.certVerifyUrl, 'https://www.slokaacademy.com/verify/');
    assert.equal(c.siteUrl, 'https://www.slokaacademy.com');
    assert.equal(c.dashboardUrl, 'http://localhost:3000/admin/');
    assert.equal(c.publicApiUrl, 'http://localhost:3000'); // the website's origin; it forwards /api
    assert.throws(() => loadConfig({ JWT_SECRET: 'x'.repeat(32), DATABASE_URL, CERT_ID_PREFIX: 'bad prefix!' }), /CERT_ID_PREFIX/);
  });
});
