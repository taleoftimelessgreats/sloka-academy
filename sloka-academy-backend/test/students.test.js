'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, openTestDatabase, addUser, login, client, postPublic, validInquiry, referral, ALLOWED_ORIGIN } = require('./helpers');
const { isDuplicate } = require('../src/db');
const { localDate } = require('../src/util');

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDate(d);
};

const student = (sessionId, code, extra = {}) => ({
  sessionId,
  code,
  name: 'Priya Sharma',
  email: 'priya.sharma@example.com',
  phone: '98765 43210',
  college: 'CVR College of Engineering',
  stream: 'electronics',
  yearOfStudy: 'year-3',
  consent: true,
  website: '',
  ...referral(),
  ...extra,
});

async function setup() {
  const ctx = await startApp();
  const admin = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
  const counsellor = await addUser(ctx.db, { name: 'Kiran C', email: 'kiran@sloka.test', role: 'counsellor', password: 'kiran-password-123' });
  ctx.adminApi = client(ctx.base, (await login(ctx.base, admin.email, admin.password)).cookie);
  await addUser(ctx.db, { name: 'Sam Super', email: 'super@sloka.test', role: 'super_admin', password: 'super-password-123' });
  ctx.superApi = client(ctx.base, (await login(ctx.base, 'super@sloka.test', 'super-password-123')).cookie);
  ctx.counsellorApi = client(ctx.base, (await login(ctx.base, counsellor.email, counsellor.password)).cookie);
  ctx.newSession = async (title) => {
    const r = await ctx.adminApi.post('/api/sessions', { title, sessionDate: yesterday(), venue: 'CVR College, Hyderabad', mode: 'in-person' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.session;
  };
  ctx.register = async (body) => {
    const res = await fetch(`${ctx.base}/api/public/certificate-registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };
  return ctx;
}

describe('master student database', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.close());

  test('career guidance registrations and internship enquiries share one student record', async () => {
    const s1 = await ctx.newSession('Careers in VLSI');
    const s2 = await ctx.newSession('Careers in Cloud');
    assert.equal((await ctx.register(student(s1.id, s1.code))).status, 201);
    // Same details (letter case and spaces aside): linked, no verification needed.
    const again = await ctx.register(student(s2.id, s2.code, { email: 'PRIYA.SHARMA@example.com', college: 'cvr college of  engineering' }));
    assert.equal(again.status, 201);
    assert.equal(again.data.verification, undefined);
    // Internship pre-registration with the same email (different process, same person).
    const inq = await postPublic(ctx.base, validInquiry({ name: 'Priya Sharma', email: 'priya.sharma@example.com', phone: '9876543210', college: 'CVR College of Engineering' }));
    assert.equal(inq.status, 201);
    assert.deepEqual(await inq.json(), { ok: true });
    // A walk-in enquiry with only a phone number links by phone.
    const walkIn = await ctx.adminApi.post('/api/inquiries', { name: 'Priya Sharma', phone: '+91 98765 43210', source: 'walk-in', status: 'new', consent: true });
    assert.equal(walkIn.status, 201, JSON.stringify(walkIn.data));

    const list = await ctx.adminApi.get('/api/students?q=priya');
    assert.equal(list.status, 200);
    assert.equal(list.data.total, 1, JSON.stringify(list.data.items));
    const s = list.data.items[0];
    assert.equal(s.email, 'priya.sharma@example.com');
    assert.equal(s.certificates, 2);
    assert.equal(s.enquiries, 2);
    assert.equal(s.latestEnquiryStatus, 'new');
    assert.deepEqual(s.programs, ['career-guidance', 'internship']);
    assert.equal(s.college, 'CVR College of Engineering', 'the profile was not rewritten');

    const detail = await ctx.counsellorApi.get(`/api/students/${s.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.certificates.length, 2);
    assert.equal(detail.data.enquiries.length, 2);
    assert.deepEqual(detail.data.certificates.map((c) => c.session.title).sort(), ['Careers in Cloud', 'Careers in VLSI']);
  });

  test('filters: programme, stream; different emails are different students', async () => {
    const s = await ctx.newSession('Careers in Pharma');
    assert.equal((await ctx.register(student(s.id, s.code, { name: 'Arjun Rao', email: 'arjun@example.com', phone: '9123456780', stream: 'pharmacy' }))).status, 201);
    assert.equal((await postPublic(ctx.base, validInquiry({ name: 'Meena K', email: 'meena@example.com', phone: '9000000001' }))).status, 201);

    const emails = (r) => r.data.items.map((i) => i.email).sort();
    const cg = await ctx.adminApi.get('/api/students?program=career-guidance');
    assert.deepEqual(emails(cg), ['arjun@example.com', 'priya.sharma@example.com']);
    const intern = await ctx.adminApi.get('/api/students?program=internship');
    assert.deepEqual(emails(intern), ['meena@example.com', 'priya.sharma@example.com']);
    const pharma = await ctx.adminApi.get('/api/students?stream=pharmacy');
    assert.deepEqual(pharma.data.items.map((i) => i.name), ['Arjun Rao']);
    const bySession = await ctx.adminApi.get(`/api/students?sessionId=${s.id}`);
    assert.deepEqual(bySession.data.items.map((i) => i.name), ['Arjun Rao']);
    assert.equal((await ctx.adminApi.get('/api/students?program=nope')).status, 400);
  });

  test('admin edits the profile; email must stay unique; counsellors cannot edit', async () => {
    const { data } = await ctx.adminApi.get('/api/students?q=arjun');
    const id = data.items[0].id;
    assert.equal((await ctx.counsellorApi.patch(`/api/students/${id}`, { college: 'X' })).status, 403);
    const ok = await ctx.adminApi.patch(`/api/students/${id}`, { college: 'Osmania University', yearOfStudy: 'year-4' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.student.college, 'Osmania University');
    const clash = await ctx.adminApi.patch(`/api/students/${id}`, { email: 'meena@example.com' });
    assert.equal(clash.status, 400);
    assert.match(clash.data.fields.email, /already uses this email/);
  });

  test('CSV export (admin only) lists students with programme counts', async () => {
    assert.equal((await ctx.counsellorApi.get('/api/students/export')).status, 403);
    const r = await ctx.adminApi.get('/api/students/export');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /sloka-students-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = r.data.replace(/^﻿/, '').trim().split('\r\n');
    assert.match(lines[0], /^Student ID,Name,Email,Phone,College/);
    assert.ok(lines.some((l) => l.includes('priya.sharma@example.com') && l.includes('9876543210')));
  });

  test('erasing a student removes their registrations, certificates and enquiries', async () => {
    const { data } = await ctx.adminApi.get('/api/students?q=priya');
    const id = data.items[0].id;
    const certIds = (await ctx.db.all('SELECT certificate_id FROM certificate_registrations WHERE student_id = ?', [id])).map((r) => r.certificate_id);
    assert.equal(certIds.length, 2);
    assert.equal((await ctx.counsellorApi.del(`/api/students/${id}`)).status, 403);
    assert.equal((await ctx.adminApi.del(`/api/students/${id}`)).status, 403, 'only Super Admins delete');
    assert.equal((await ctx.superApi.del(`/api/students/${id}`)).status, 204);
    assert.equal((await ctx.adminApi.get(`/api/students/${id}`)).status, 404);
    for (const certId of certIds) {
      const v = await fetch(`${ctx.base}/api/public/certificates/${certId}/verify`);
      assert.equal(v.status, 404);
    }
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM inquiries WHERE student_id = ?', [id])).n, 0);
  });

  test('deleting the only registration of a student also removes the empty student record', async () => {
    const s = await ctx.newSession('Careers in Finance');
    const r = await ctx.register(student(s.id, s.code, { name: 'Solo Student', email: 'solo@example.com', phone: '9555555555' }));
    const reg = (await ctx.db.get('SELECT id, student_id FROM certificate_registrations WHERE certificate_id = ?', [r.data.certificate.id]));
    assert.equal((await ctx.superApi.del(`/api/certificates/${reg.id}`)).status, 204);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM students WHERE id = ?', [reg.student_id])).n, 0);
  });
});

describe('Student IDs and duplicate profiles', () => {
  let ctx;
  const year = new Date().getFullYear();
  const codeOf = async (email) => (await ctx.db.get('SELECT student_code FROM students WHERE email = ?', [email])).student_code;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.close());

  test('every new student gets the next Student ID; it is never reused after an erasure', async () => {
    const s = await ctx.newSession('Careers in Data');
    const r = await ctx.register(student(s.id, s.code, { email: 'first@example.com', phone: '9100000001' }));
    assert.equal(r.status, 201);
    assert.equal(r.data.certificate.studentId, `SLK-STU-${year}-00001`);
    assert.equal((await postPublic(ctx.base, validInquiry({ email: 'second@example.com', phone: '9100000002' }))).status, 201);
    assert.equal(await codeOf('second@example.com'), `SLK-STU-${year}-00002`);

    const second = (await ctx.db.get("SELECT id FROM students WHERE email = 'second@example.com'")).id;
    assert.equal((await ctx.superApi.del(`/api/students/${second}`)).status, 204);
    await postPublic(ctx.base, validInquiry({ email: 'third@example.com', phone: '9100000003' }));
    assert.equal(await codeOf('third@example.com'), `SLK-STU-${year}-00003`);

    const found = await ctx.counsellorApi.get(`/api/students?q=STU-${year}-00003`);
    assert.deepEqual(found.data.items.map((i) => i.email), ['third@example.com']);
    const detail = await ctx.counsellorApi.get(`/api/students/${found.data.items[0].id}`);
    assert.equal(detail.data.student.studentCode, `SLK-STU-${year}-00003`);
  });

  test('a returning student with a new email but the same mobile number gets no second profile; the change waits for verification', async () => {
    await postPublic(ctx.base, validInquiry({ name: 'Asha Kumar', email: 'asha.college@example.com', phone: '9100000004' }));
    const before = (await ctx.db.get('SELECT COUNT(*) AS n FROM students')).n;
    const res = await postPublic(ctx.base, validInquiry({ name: 'Asha Kumar', email: 'asha.personal@example.com', phone: '+91 91000 00004' }));
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.verification.codeSent, false);
    assert.equal(body.verification.reason, 'email_off', 'email is not set up in this test');
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM students')).n, before, 'no second profile');
    const rows = await ctx.db.all("SELECT id, student_id FROM inquiries WHERE phone = '+919100000004' ORDER BY id");
    assert.equal(rows.length, 2);
    assert.equal(rows[1].student_id, null, 'not linked until verified');
    const profile = await ctx.db.get('SELECT * FROM students WHERE id = ?', [rows[0].student_id]);
    assert.equal(profile.email, 'asha.college@example.com', 'the profile keeps its email');

    const inq = await ctx.counsellorApi.get(`/api/inquiries/${rows[1].id}`);
    assert.equal(inq.data.inquiry.studentCode, null);
    assert.equal(inq.data.verification.student.studentCode, profile.student_code);
    assert.deepEqual(inq.data.verification.conflicts, ['email']);
    assert.equal(inq.data.verification.proposed.email, 'asha.personal@example.com');

    // Staff decide: same person, keep the profile as it is.
    const settled = await ctx.adminApi.post(`/api/verifications/${inq.data.verification.id}/resolve`, { action: 'link' });
    assert.equal(settled.status, 200, JSON.stringify(settled.data));
    assert.equal((await ctx.counsellorApi.get(`/api/inquiries/${rows[1].id}`)).data.inquiry.studentCode, profile.student_code);
    assert.equal((await ctx.db.get('SELECT email FROM students WHERE id = ?', [profile.id])).email, 'asha.college@example.com');
  });

  test('a mobile number that belongs to another student is never copied onto a second profile', async () => {
    // Email matches one student, the number belongs to another: flagged for verification against the
    // email's profile; the number stays where it is.
    await postPublic(ctx.base, validInquiry({ name: 'Meena K', email: 'meena@example.com', phone: '9100000005' }));
    const res = await postPublic(ctx.base, validInquiry({ name: 'Meena K', email: 'meena@example.com', phone: '9100000004' }));
    const meena = await ctx.db.get("SELECT id FROM students WHERE email = 'meena@example.com'");
    const pending = await ctx.db.get('SELECT student_id, conflicts FROM profile_verifications WHERE token = ?', [(await res.json()).verification.token]);
    assert.deepEqual({ ...pending }, { student_id: meena.id, conflicts: '["phone"]' });
    assert.equal((await ctx.db.get("SELECT phone FROM students WHERE email = 'meena@example.com'")).phone, '+919100000005');
    assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM students WHERE phone = '+919100000004'")).n, 1);
  });

  test('one certificate per person per session, even with a different email', async () => {
    const s = await ctx.newSession('Careers in Cloud');
    assert.equal((await ctx.register(student(s.id, s.code, { email: 'ravi@example.com', phone: '9100000006' }))).status, 201);
    const again = await ctx.register(student(s.id, s.code, { email: 'ravi.other@example.com', phone: '91000 00006' }));
    assert.equal(again.status, 409);
    assert.equal(again.data.error, 'already_registered');
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM certificate_registrations WHERE session_id = ?', [s.id])).n, 1);
  });

  test('staff cannot give a student a mobile number another student already has', async () => {
    const id = (await ctx.db.get("SELECT id FROM students WHERE email = 'meena@example.com'")).id;
    const clash = await ctx.adminApi.patch(`/api/students/${id}`, { phone: '9100000006' });
    assert.equal(clash.status, 400);
    assert.match(clash.data.fields.phone, /already uses this mobile number/);
    assert.equal((await ctx.adminApi.patch(`/api/students/${id}`, { phone: '9100000099' })).status, 200);
  });

  test('exports and the Google Sheet row carry the Student ID', async () => {
    const lines = (await ctx.adminApi.get('/api/students/export')).data.replace(/^﻿/, '').trim().split('\r\n');
    assert.ok(lines.slice(1).every((l) => new RegExp(`^SLK-STU-${year}-\\d{5},`).test(l)), lines.join('\n'));
    const certs = (await ctx.adminApi.get('/api/certificates/export')).data.trim().split('\r\n');
    assert.match(certs[0], /,Student ID$/);
    assert.match(certs[1], new RegExp(`,SLK-STU-${year}-\\d{5}$`));
    const { toRow } = require('../src/sheetSync');
    const { REG_SELECT } = require('../src/certificateRepo');
    assert.match(toRow((await ctx.db.get(`${REG_SELECT} ORDER BY r.id LIMIT 1`))).at(-1), new RegExp(`^SLK-STU-${year}-00001$`));
  });
});

describe('Student ID backfill', () => {
  let t;
  before(async () => (t = await openTestDatabase()));
  after(() => t.drop());

  test('students without a Student ID get one at startup, numbered by when they were first seen', async () => {
    const { assignMissingStudentIds } = require('../src/studentIds');
    const add = (name, email, at) => t.db.run('INSERT INTO students (name, email, created_at, updated_at) VALUES (?, ?, ?, ?)', [name, email, at, at]);
    await add('Later', 'later@example.com', '2026-03-01T10:00:00.000Z');
    await add('Earlier', 'earlier@example.com', '2026-01-05T10:00:00.000Z');
    await add('Last year', 'old@example.com', '2025-06-01T10:00:00.000Z');
    assert.equal(await assignMissingStudentIds(t.db, 'SLK'), 3);
    const codes = Object.fromEntries((await t.db.all('SELECT email, student_code FROM students')).map((r) => [r.email, r.student_code]));
    assert.deepEqual(codes, {
      'old@example.com': 'SLK-STU-2025-00001',
      'earlier@example.com': 'SLK-STU-2026-00001',
      'later@example.com': 'SLK-STU-2026-00002',
    });
    assert.equal(await assignMissingStudentIds(t.db, 'SLK'), 0, 'existing IDs are kept');
  });
});

describe('database rules', () => {
  let t;
  before(async () => (t = await openTestDatabase()));
  after(() => t.drop());
  const at = '2026-10-01T10:00:00.000Z';

  test('the roles start as the requirements set them, with the original Manager and Counsellor kept', async () => {
    const roles = await t.db.all('SELECT role_key, scope, is_system FROM roles ORDER BY role_key');
    assert.deepEqual(
      roles.map((r) => [r.role_key, r.scope, r.is_system]),
      [['accounts', 'all', 1], ['admin', 'all', 1], ['bd_associate', 'own', 1], ['bd_manager', 'team', 1], ['counsellor', 'all', 0], ['manager', 'all', 0], ['super_admin', 'all', 1]],
    );
    const count = async (role) => (await t.db.get('SELECT COUNT(*) AS n FROM role_permissions WHERE role_key = ?', [role])).n;
    const { ALL_PERMISSIONS, SUPER_ADMIN_ONLY } = require('../src/permissions');
    assert.equal(await count('super_admin'), ALL_PERMISSIONS.length);
    assert.equal(await count('admin'), ALL_PERMISSIONS.length - 2 - SUPER_ADMIN_ONLY.length, 'everything but roles and deleting records');
    assert.ok((await t.db.get('SELECT COUNT(*) AS n FROM courses')).n >= 40, 'course master seeded from the website');
  });

  test('one profile per email (any letter case) and per mobile number; blanks do not clash', async () => {
    const addStudent = (email, phone) =>
      t.db.run('INSERT INTO students (name, email, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', ['S', email, phone, at, at]);
    await addStudent('asha@example.com', '+919876543210');
    await addStudent(null, null);
    await addStudent(null, null);
    await assert.rejects(addStudent('ASHA@example.com', null), (err) => isDuplicate(err, 'uq_students_email'));
    await assert.rejects(addStudent('other@example.com', '+919876543210'), (err) => isDuplicate(err, 'uq_students_phone'));
  });

  test('searches ignore letter case', async () => {
    const { n } = await t.db.get("SELECT COUNT(*) AS n FROM students WHERE email LIKE '%ASHA%'");
    assert.equal(n, 1);
  });
});

