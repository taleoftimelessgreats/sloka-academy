'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, addUser, login, client, postPublic, validInquiry, ALLOWED_ORIGIN } = require('./helpers');
const { createNotifier } = require('../src/notify');
const { localDate } = require('../src/util');

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDate(d);
};

const registration = (s, extra = {}) => ({
  sessionId: s.id,
  code: s.code,
  name: 'Ravi Teja',
  email: 'ravi@example.com',
  phone: '98111 00001',
  college: 'Vasavi Degree College',
  consent: true,
  ...extra,
});

async function setup(options) {
  const ctx = await startApp(options);
  const admin = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
  const manager = await addUser(ctx.db, { name: 'Mohan Manager', email: 'mohan@sloka.test', role: 'manager', password: 'mohan-password-123' });
  const counsellor = await addUser(ctx.db, { name: 'Kiran C', email: 'kiran@sloka.test', role: 'counsellor', password: 'kiran-password-123' });
  ctx.adminApi = client(ctx.base, (await login(ctx.base, admin.email, admin.password)).cookie);
  ctx.managerApi = client(ctx.base, (await login(ctx.base, manager.email, manager.password)).cookie);
  ctx.counsellorApi = client(ctx.base, (await login(ctx.base, counsellor.email, counsellor.password)).cookie);
  let n = 0;
  ctx.newSession = async () => {
    const r = await ctx.adminApi.post('/api/sessions', { title: `Career Guidance ${++n}`, sessionDate: yesterday(), mode: 'online' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.session;
  };
  const publicPost = async (path, body) => {
    const res = await fetch(`${ctx.base}/api/public${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };
  ctx.register = (body) => publicPost('/certificate-registrations', body);
  ctx.verify = (token, code) => publicPost(`/profile-verifications/${token}/verify`, { code });
  ctx.resend = (token) => publicPost(`/profile-verifications/${token}/resend`, {});
  ctx.student = (where, params) => ctx.db.get(`SELECT * FROM students WHERE ${where}`, params);
  ctx.reg = (certId) => ctx.db.get('SELECT * FROM certificate_registrations WHERE certificate_id = ?', [certId]);
  ctx.wrongCode = (code) => String((Number(code) + 1) % 1000000).padStart(6, '0');
  return ctx;
}

describe('profile matching and verification', () => {
  let ctx;
  before(async () => {
    // A high daily email limit here: the limit has its own tests below.
    ctx = await setup({ studentEmail: true, config: { emailDailyLimit: 100, verificationResendAfterMs: 0, verificationRateLimit: { max: 1000, windowMs: 600000 } } });
  });
  after(() => ctx.close());

  test('same details link straight away; the profile only gains what it was missing', async () => {
    const walkIn = await ctx.adminApi.post('/api/inquiries', { name: 'Ravi Teja', phone: '98111 00001', source: 'walk-in', status: 'new', consent: true });
    assert.equal(walkIn.status, 201);
    assert.equal(walkIn.data.verification, null);
    const r = await ctx.register(registration(await ctx.newSession()));
    assert.equal(r.status, 201);
    assert.equal(r.data.verification, undefined);
    const profile = await ctx.student('phone = ?', ['+919811100001']);
    assert.equal(r.data.certificate.studentId, profile.student_code);
    assert.equal(profile.email, 'ravi@example.com', 'blank filled');
    assert.equal(profile.college, 'Vasavi Degree College', 'blank filled');
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM students')).n, 1);
  });

  test('different details: the profile is unchanged and the code emailed to it confirms the change', async () => {
    const r = await ctx.register(registration(await ctx.newSession(), { name: 'Tales Of Timeless Greats', college: 'Vasavi' }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.certificate.studentId, null, 'not linked yet');
    const v = r.data.verification;
    assert.equal(v.codeSent, true);
    assert.equal(v.sentTo, 'r•••@example.com');
    assert.ok(Date.parse(v.expiresAt) > Date.now());
    const sent = ctx.codes.at(-1);
    assert.equal(sent.to, 'ravi@example.com', 'sent to the address already on the profile');

    let profile = await ctx.student('phone = ?', ['+919811100001']);
    assert.equal(profile.name, 'Ravi Teja');
    assert.equal(profile.college, 'Vasavi Degree College');
    assert.equal((await ctx.reg(r.data.certificate.id)).student_id, null);
    const list = await ctx.counsellorApi.get('/api/students?q=ravi');
    assert.equal(list.data.total, 1, 'no duplicate profile');
    assert.equal(list.data.pendingVerifications, 1);
    assert.equal(list.data.items[0].pendingVerifications, 1);
    const open = (await ctx.counsellorApi.get('/api/verifications')).data.verifications;
    assert.equal(open.length, 1);
    assert.deepEqual(open[0].conflicts, ['name', 'college']);
    assert.equal(open[0].record.certificateId, r.data.certificate.id);
    assert.equal(open[0].proposed.name, 'Tales Of Timeless Greats');

    const wrong = await ctx.verify(v.token, ctx.wrongCode(sent.code));
    assert.deepEqual([wrong.status, wrong.data], [400, { error: 'wrong_code', attemptsLeft: 4 }]);
    assert.equal((await ctx.verify(v.token, '12ab')).status, 400);
    assert.equal((await ctx.verify('0'.repeat(32), sent.code)).status, 404);

    const ok = await ctx.verify(v.token, sent.code);
    assert.deepEqual([ok.status, ok.data], [200, { status: 'verified', studentId: profile.student_code }]);
    profile = await ctx.student('id = ?', [profile.id]);
    assert.equal(profile.name, 'Tales Of Timeless Greats', 'verified details are applied');
    assert.equal(profile.college, 'Vasavi');
    assert.equal((await ctx.reg(r.data.certificate.id)).student_id, profile.id);
    assert.deepEqual((await ctx.verify(v.token, sent.code)).data, { error: 'closed' });
    const detail = await ctx.counsellorApi.get(`/api/students/${profile.id}`);
    assert.equal(detail.data.certificates.length, 2, 'both registrations, each with its own record');
    assert.deepEqual(detail.data.verifications, []);
    await ctx.settle();
    assert.ok(ctx.emails.some((m) => m.certificateId === r.data.certificate.id), 'the certificate was still emailed');
  });

  test('too many wrong codes: the registration stays pending and staff decide', async () => {
    const s1 = await ctx.newSession();
    const meena = { name: 'Meena K', email: 'meena@example.com', phone: '98111 00002', college: 'JNTU' };
    assert.equal((await ctx.register(registration(s1, meena))).status, 201);
    const r = await ctx.register(registration(await ctx.newSession(), { ...meena, college: 'Osmania University' }));
    const { token } = r.data.verification;
    const code = ctx.codes.at(-1).code;
    for (let left = 4; left > 0; left--) assert.equal((await ctx.verify(token, ctx.wrongCode(code))).data.attemptsLeft, left);
    assert.deepEqual((await ctx.verify(token, ctx.wrongCode(code))).data, { error: 'locked' });
    assert.deepEqual((await ctx.verify(token, code)).data, { error: 'locked' }, 'the right code no longer works');
    assert.deepEqual((await ctx.resend(token)).data, { error: 'locked' });

    const profile = await ctx.student('email = ?', ['meena@example.com']);
    assert.equal(profile.college, 'JNTU');
    const reg = await ctx.reg(r.data.certificate.id);
    assert.equal(reg.student_id, null);
    const cert = await ctx.counsellorApi.get(`/api/certificates/${reg.id}`);
    assert.equal(cert.data.verification.status, 'failed');
    const id = cert.data.verification.id;

    assert.equal((await ctx.counsellorApi.post(`/api/verifications/${id}/resolve`, { action: 'link' })).status, 403);
    assert.equal((await ctx.managerApi.post(`/api/verifications/${id}/resolve`, { action: 'update' })).status, 403, 'changing a profile is for admins');
    assert.equal((await ctx.managerApi.post(`/api/verifications/${id}/resolve`, { action: 'merge' })).status, 400);
    const own = await ctx.managerApi.post(`/api/verifications/${id}/resolve`, { action: 'new_profile' });
    assert.equal(own.status, 200, JSON.stringify(own.data));
    assert.equal(own.data.verification.status, 'resolved');
    assert.equal(own.data.verification.resolvedBy.name, 'Mohan Manager');
    const linked = await ctx.reg(r.data.certificate.id);
    const separate = await ctx.student('id = ?', [linked.student_id]);
    assert.notEqual(separate.id, profile.id);
    assert.equal(separate.college, 'Osmania University');
    assert.equal(separate.email, null, "the email stays with the profile it belongs to");
    assert.match(separate.student_code, /^SLK-STU-\d{4}-\d{5}$/);
    assert.equal((await ctx.student('id = ?', [profile.id])).college, 'JNTU');
    assert.equal((await ctx.managerApi.post(`/api/verifications/${id}/resolve`, { action: 'link' })).status, 409);
  });

  test('an admin can accept the submitted details', async () => {
    // An internship enquiry from Meena with another college (the helper's default, JNTU Hyderabad).
    const res = await postPublic(ctx.base, validInquiry({ name: 'Meena K', email: 'meena@example.com', phone: '9811100002' }));
    const body = await res.json();
    assert.equal(body.verification.codeSent, true);
    const id = (await ctx.db.get('SELECT id FROM profile_verifications WHERE token = ?', [body.verification.token])).id;
    const done = await ctx.adminApi.post(`/api/verifications/${id}/resolve`, { action: 'update' });
    assert.equal(done.status, 200);
    assert.deepEqual(done.data.verification.conflicts, ['college']);
    assert.equal((await ctx.student('email = ?', ['meena@example.com'])).college, 'JNTU Hyderabad');
    const programs = (await ctx.counsellorApi.get('/api/students?q=meena')).data.items[0].programs;
    assert.deepEqual(programs, ['career-guidance', 'internship']);
  });

  test('expired codes can be replaced, up to three codes', async () => {
    const r = await ctx.register(registration(await ctx.newSession(), { name: 'Ravi T' }));
    const { token } = r.data.verification;
    await ctx.db.run("UPDATE profile_verifications SET code_expires_at = '2000-01-01T00:00:00.000Z' WHERE token = ?", [token]);
    assert.deepEqual((await ctx.verify(token, ctx.codes.at(-1).code)).data, { error: 'expired' });
    const again = await ctx.resend(token);
    assert.equal(again.status, 200);
    assert.equal(again.data.verification.codeSent, true);
    assert.equal((await ctx.resend(token)).status, 200);
    assert.deepEqual((await ctx.resend(token)).data, { error: 'resend_limit' });
    assert.equal((await ctx.verify(token, ctx.codes.at(-1).code)).data.status, 'verified');
  });

  test('a profile without an email cannot receive a code: the enquiry waits for staff', async () => {
    await ctx.adminApi.post('/api/inquiries', { name: 'Kiran Rao', phone: '98111 00009', source: 'walk-in', status: 'new', consent: true });
    const res = await postPublic(ctx.base, validInquiry({ name: 'Kiran R', email: 'kiran.r@example.com', phone: '9811100009' }));
    const { verification } = await res.json();
    assert.deepEqual({ ...verification, token: 'x' }, { token: 'x', codeSent: false, sentTo: null, expiresAt: null, reason: 'no_email' });
  });

  test('staff edits change the enquiry only; one moved onto another student waits for verification', async () => {
    const created = await ctx.adminApi.post('/api/inquiries', { name: 'Arjun Rao', phone: '98111 00010', source: 'phone-call', status: 'new', consent: true });
    const id = created.data.inquiry.id;
    const arjun = created.data.inquiry.studentId;
    const renamed = await ctx.counsellorApi.patch(`/api/inquiries/${id}`, { name: 'Arjun R' });
    assert.equal(renamed.data.inquiry.studentId, arjun, 'still the same student');
    assert.equal((await ctx.student('id = ?', [arjun])).name, 'Arjun Rao', 'the profile is not rewritten');
    const moved = await ctx.counsellorApi.patch(`/api/inquiries/${id}`, { phone: '98111 00002' }); // Meena's number
    assert.equal(moved.data.inquiry.studentId, null);
    assert.equal(moved.data.verification.student.name, 'Meena K');
    assert.equal(await ctx.student('id = ?', [arjun]), undefined, 'the emptied profile is removed');
  });

  test('erasing a student gives the records waiting on them a profile of their own', async () => {
    const s = await ctx.newSession();
    await ctx.register(registration(s, { name: 'Sita Devi', email: 'sita@example.com', phone: '98111 00020', college: 'KMIT' }));
    const r = await ctx.register(registration(await ctx.newSession(), { name: 'Sita D', email: 'sita@example.com', phone: '98111 00020', college: 'KMIT' }));
    assert.ok(r.data.verification);
    const sita = await ctx.student('email = ?', ['sita@example.com']);
    assert.equal((await ctx.adminApi.del(`/api/students/${sita.id}`)).status, 204);
    const reg = await ctx.reg(r.data.certificate.id);
    assert.ok(reg, 'the waiting registration is kept');
    const own = await ctx.student('id = ?', [reg.student_id]);
    assert.equal(own.name, 'Sita D');
    assert.equal(own.email, 'sita@example.com', 'the email is free again, so it goes to the new profile');
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM profile_verifications WHERE student_id = ?', [sita.id])).n, 0);
  });
});

describe('daily email limit', () => {
  let ctx;
  before(async () => {
    ctx = await setup({ studentEmail: true, config: { certResendCooldownMs: 0 } });
  });
  after(() => ctx.close());
  const sentTo = (address) => ctx.outbox.filter((m) => m.to === address).length;

  test('at most 5 emails per address per day, whatever they are for', async () => {
    const s = await ctx.newSession();
    const r = await ctx.register(registration(s, { email: 'busy@example.com', phone: '98222 00001' }));
    await ctx.settle();
    const regId = (await ctx.reg(r.data.certificate.id)).id;
    for (let i = 0; i < 4; i++) assert.equal((await ctx.adminApi.post(`/api/certificates/${regId}/resend`)).data.result, 'sent');
    assert.equal(sentTo('busy@example.com'), 5);
    const sixth = await ctx.adminApi.post(`/api/certificates/${regId}/resend`);
    assert.equal(sixth.data.result, 'failed');
    assert.equal(sixth.data.certificate.emailStatus, 'failed');
    assert.match(sixth.data.certificate.emailError, /Daily email limit reached for busy@example\.com \(5 emails per day/);
    assert.equal(sentTo('busy@example.com'), 5, 'nothing more was sent');
    assert.equal(await ctx.services.quota.remaining('BUSY@example.com'), 0, 'counted per address, any letter case');

    // Registering again would re-send the certificate: not today.
    const dup = await ctx.register(registration(s, { email: 'busy@example.com', phone: '98222 00001' }));
    assert.deepEqual(dup.data, { error: 'already_registered', emailed: false });
    // Verification codes count too: none can be sent to this address today.
    const conflict = await ctx.register(registration(await ctx.newSession(), { name: 'Someone Else', email: 'busy@example.com', phone: '98222 00001' }));
    assert.equal(conflict.data.verification.reason, 'email_limit');
    await ctx.settle();
    assert.equal(sentTo('busy@example.com'), 5);

    // Other addresses are not affected.
    await ctx.register(registration(s, { email: 'calm@example.com', phone: '98222 00002' }));
    await ctx.settle();
    assert.equal(sentTo('calm@example.com'), 1);
  });

  test('an email that fails to send does not use up the limit', async () => {
    ctx.mail.fail = '421 try again later';
    await ctx.register(registration(await ctx.newSession(), { email: 'retry@example.com', phone: '98222 00003' }));
    await ctx.settle();
    ctx.mail.fail = null;
    assert.equal(await ctx.services.quota.remaining('retry@example.com'), 5);
  });

  test('the count starts again each day', async () => {
    await ctx.db.run("INSERT INTO email_quota (recipient, day, sent) VALUES ('daily@example.com', ?, 5)", [yesterday()]);
    assert.equal(await ctx.services.quota.remaining('daily@example.com'), 5);
  });

  test('team notifications count towards the limit as well', async () => {
    const delivered = [];
    const config = { ...ctx.config, notifyTo: 'team@sloka.test' };
    const notifier = createNotifier(config, {
      quota: ctx.services.quota,
      transport: { sendMail: async (m) => delivered.push(m.to) },
      logger: { log() {}, error() {} },
    });
    for (let i = 1; i <= 7; i++) notifier.inquiryCreated({ id: i, name: 'Student', source: 'contact' });
    for (let waited = 0; waited < 30000 && (await ctx.db.get("SELECT sent FROM email_quota WHERE recipient = 'team@sloka.test'"))?.sent !== 5; waited += 200) {
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(delivered.length, 5);
  });
});
