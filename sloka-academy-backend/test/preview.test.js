'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, addUser, login, client, referral, ALLOWED_ORIGIN } = require('./helpers');
const { localDate } = require('../src/util');

describe('certificate previews', () => {
  let ctx;
  let admin;
  let session;
  before(async () => {
    ctx = await startApp();
    const a = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
    admin = client(ctx.base, (await login(ctx.base, a.email, a.password)).cookie);
    session = (await admin.post('/api/sessions', { title: 'Careers in Pharma', sessionDate: localDate(), mode: 'in-person', venue: 'Hall A' })).data.session;
  });
  after(() => ctx.close());

  const student = (extra = {}) => ({
    sessionId: session.id,
    code: session.code,
    name: 'Asha Kumar',
    email: 'asha@example.com',
    phone: '9876543210',
    college: 'JNTU Hyderabad',
    consent: true,
    ...referral(),
    ...extra,
  });
  const post = (body) =>
    fetch(`${ctx.base}/api/public/certificate-registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify(body),
    });
  const count = async (table) => (await ctx.db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n;
  const isPdf = async (res) => (await res.clone().arrayBuffer()).byteLength > 1000 && (await res.text()).startsWith('%PDF-');

  test('before issuing: a checked registration returns a PREVIEW PDF and stores nothing', async () => {
    const res = await post(student({ preview: true }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), /^inline/);
    assert.ok(await isPdf(res));
    assert.equal(await count('certificate_registrations'), 0);
    assert.equal(await count('inquiries'), 0, 'no referral enquiries either');
    assert.equal(await count('students'), 0);
  });

  test('a preview is checked like a registration: wrong code, missing friend', async () => {
    let res = await post(student({ preview: true, code: 'ZZZZZZ' }));
    assert.equal(res.status, 400);
    assert.match((await res.json()).fields.code, /code/i);
    res = await post(student({ preview: true, referrals: [{ name: 'Ravi', phone: '', college: '' }] }));
    assert.equal(res.status, 400);
    assert.match((await res.json()).fields['referrals.0.phone'], /mobile number/);
  });

  test('after issuing: anyone with the ID can view the certificate; a revoked one still shows, stamped', async () => {
    const issued = await post(student());
    assert.equal(issued.status, 201);
    const { id } = (await issued.json()).certificate;

    const again = await post(student({ preview: true }));
    assert.equal(again.status, 409, 'a preview of a certificate already issued is refused like the registration');

    let res = await fetch(`${ctx.base}/api/public/certificates/${id.toLowerCase()}/preview`, { headers: { Origin: ALLOWED_ORIGIN } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.ok(await isPdf(res));
    const reg = await ctx.db.get('SELECT id, download_count FROM certificate_registrations WHERE certificate_id = ?', [id]);
    assert.equal(reg.download_count, 0, 'viewing is not a download');

    assert.equal((await admin.post(`/api/certificates/${reg.id}/revoke`, { reason: 'Issued by mistake' })).status, 200);
    res = await fetch(`${ctx.base}/api/public/certificates/${id}/preview`);
    assert.equal(res.status, 200);

    res = await fetch(`${ctx.base}/api/public/certificates/SLK-2026-00000000/preview`);
    assert.equal(res.status, 404);
  });
});
