'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, addUser, login, client, ALLOWED_ORIGIN } = require('./helpers');
const { localDate } = require('../src/util');

describe('refer a friend (certificate registration)', () => {
  let ctx;
  let admin;
  let counsellor;
  let session;
  before(async () => {
    ctx = await startApp();
    const a = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
    const c = await addUser(ctx.db, { name: 'Kiran C', email: 'kiran@sloka.test', password: 'kiran-password-123' });
    admin = client(ctx.base, (await login(ctx.base, a.email, a.password)).cookie);
    counsellor = client(ctx.base, (await login(ctx.base, c.email, c.password)).cookie);
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
    ...extra,
  });
  const register = (body) =>
    fetch(`${ctx.base}/api/public/certificate-registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, data: await r.json() }));
  const friend = (n, extra = {}) => ({ name: `Friend ${n}`, phone: `90000000${10 + n}`, college: `College ${n}`, ...extra });

  test('referral details are validated, field by field', async () => {
    const cases = [
      [{ referrals: [friend(1)] }, { referralConsent: /friends agreed to be contacted/ }],
      [{ referrals: [{ name: 'Ravi' }], referralConsent: true }, { 'referrals.0.phone': /mobile number/, 'referrals.0.college': /college/ }],
      [{ referrals: [friend(1, { phone: '98765 43210' })], referralConsent: true }, { 'referrals.0.phone': /your own number/ }],
      [{ referrals: [friend(1), friend(2, { phone: '+91 9000000011' })], referralConsent: true }, { 'referrals.1.phone': /already added/ }],
      [{ referrals: [friend(1), friend(2), friend(3), friend(4)], referralConsent: true }, { referrals: /up to 3 friends/ }],
      [{ referrals: 'Ravi, 9123456780' }, { referrals: /Invalid/ }],
      [{ referrals: [friend(1, { phone: '12345' })], referralConsent: true }, { 'referrals.0.phone': /valid 10-digit/ }],
    ];
    for (const [extra, expected] of cases) {
      const r = await register(student(extra));
      assert.equal(r.status, 400, JSON.stringify(extra));
      for (const [key, re] of Object.entries(expected)) assert.match(r.data.fields[key] || '', re, `${key} for ${JSON.stringify(extra)}`);
    }
    assert.equal((await admin.get('/api/inquiries?source=referral')).data.total, 0, 'nothing saved');
  });

  test('blank friend rows are ignored; a registration without referrals still works', async () => {
    const r = await register(student({ email: 'solo@example.com', phone: '9123400000', referrals: [{ name: '', phone: ' ', college: '' }] }));
    assert.equal(r.status, 201);
    assert.equal((await admin.get('/api/inquiries?source=referral')).data.total, 0);
  });

  test('each friend becomes a new referral enquiry linked to the registration, without a student profile', async () => {
    const before = (await admin.get('/api/students')).data.total;
    const r = await register(student({ referrals: [friend(1), friend(2, { name: 'Ravi Teja', phone: '+91 91234 56780', college: 'Osmania University' })], referralConsent: true }));
    assert.equal(r.status, 201);
    const certId = r.data.certificate.id;
    assert.equal((await admin.get('/api/students')).data.total, before + 1, 'only the student who registered gets a profile');

    const list = await counsellor.get('/api/inquiries?source=referral&sort=name&dir=asc');
    assert.equal(list.status, 200);
    assert.equal(list.data.total, 2);
    const [f1, ravi] = list.data.items;
    assert.equal(f1.name, 'Friend 1');
    assert.equal(ravi.name, 'Ravi Teja');
    assert.equal(ravi.phone, '+919123456780');
    assert.equal(ravi.college, 'Osmania University');
    assert.equal(ravi.source, 'referral');
    assert.equal(ravi.status, 'new');
    assert.equal(ravi.email, null);
    assert.equal(ravi.studentId, null);
    assert.equal(ravi.referredBy.name, 'Asha Kumar');
    assert.equal(ravi.referredBy.college, 'JNTU Hyderabad');
    assert.equal(ravi.referredBy.certificateId, certId);

    // The admissions team works them like any other enquiry.
    const upd = await counsellor.patch(`/api/inquiries/${ravi.id}`, { status: 'contacted' });
    assert.equal(upd.status, 200);

    const detail = await counsellor.get(`/api/certificates/${ravi.referredBy.registrationId}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(
      detail.data.referrals.map((f) => [f.name, f.phone, f.college, f.status]),
      [
        ['Friend 1', '+919000000011', 'College 1', 'new'],
        ['Ravi Teja', '+919123456780', 'Osmania University', 'contacted'],
      ],
    );
    ctx.regId = ravi.referredBy.registrationId;
  });

  test('a repeat registration does not add the friends again', async () => {
    const r = await register(student({ referrals: [friend(3)], referralConsent: true }));
    assert.equal(r.status, 409);
    assert.equal((await admin.get('/api/inquiries?source=referral')).data.total, 2);
  });

  test('the enquiries CSV says who referred each friend', async () => {
    const res = await fetch(`${ctx.base}/api/inquiries/export?source=referral`, { headers: { Cookie: (await login(ctx.base, 'admin@sloka.test', 'admin-password-123')).cookie } });
    assert.equal(res.status, 200);
    const csv = await res.text();
    assert.match(csv.split('\n')[0], /Referred by/);
    assert.match(csv, /Ravi Teja/);
    assert.match(csv, /Asha Kumar \(/);
    assert.match(csv, /Refer a friend/);
  });

  test('erasing the registration keeps the friends as enquiries but drops the link to the student', async () => {
    assert.equal((await admin.del(`/api/certificates/${ctx.regId}`)).status, 204);
    const list = await admin.get('/api/inquiries?source=referral');
    assert.equal(list.data.total, 2);
    assert.ok(list.data.items.every((i) => i.referredBy === null));
  });
});
