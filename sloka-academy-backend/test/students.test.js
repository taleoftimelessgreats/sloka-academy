'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, openTestDatabase, addUser, login, client, postPublic, validInquiry, referral, ALLOWED_ORIGIN } = require('./helpers');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDuplicate } = require('../src/db');
const { DEFAULT_LAYOUT } = require('../src/certificateTemplates');
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
    assert.equal((await ctx.adminApi.del(`/api/students/${id}`)).status, 204);
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
    assert.equal((await ctx.adminApi.del(`/api/certificates/${reg.id}`)).status, 204);
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
    assert.equal((await ctx.adminApi.del(`/api/students/${second}`)).status, 204);
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

  test('roles are limited to counsellor, manager and admin', async () => {
    const addUserRow = (email, role) =>
      t.db.run('INSERT INTO users (name, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', ['U', email, 'x', role, at, at]);
    await addUserRow('m@sloka.test', 'manager');
    await assert.rejects(addUserRow('x@sloka.test', 'owner'), /truncated|role/i);
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

describe('import from the former SQLite database', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { importSqlite } = require('../scripts/import-sqlite');
  const at = '2026-10-01T10:00:00.000Z';
  const big = Buffer.alloc(5 * 1024 * 1024 + 7, 3); // more than TiDB keeps in one row
  big[0] = 0x89;
  let t;
  let file;

  before(async () => {
    t = await openTestDatabase();
    file = path.join(os.tmpdir(), `sloka-import-${process.pid}-${Date.now()}.db`);
    const lite = new DatabaseSync(file);
    // The tables and columns of the last SQLite schema (version 4) that this import needs.
    lite.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, '${at}'), (2, '${at}'), (3, '${at}'), (4, '${at}');
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, password_hash TEXT, role TEXT, active INTEGER, token_version INTEGER,
        created_at TEXT, updated_at TEXT, last_login_at TEXT);
      INSERT INTO users VALUES (3, 'Anita', 'anita@sloka.test', 'hash', 'admin', 1, 2, '${at}', '${at}', NULL),
        (5, 'Mohan', 'mohan@sloka.test', 'hash', 'manager', 0, 0, '${at}', '${at}', '${at}');
      CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT, college TEXT, stream TEXT, year_of_study TEXT,
        created_at TEXT, updated_at TEXT, student_code TEXT);
      INSERT INTO students VALUES (10, 'Asha', 'asha@example.com', '+919876543210', 'JNTU', NULL, NULL, '${at}', '${at}', 'SLK-STU-2026-00041'),
        (11, 'Ravi', NULL, '+919000000000', NULL, NULL, NULL, '${at}', '${at}', NULL);
      CREATE TABLE certificate_templates (id INTEGER PRIMARY KEY, name TEXT, file_type TEXT, file BLOB, file_size INTEGER, page_width REAL,
        page_height REAL, layout TEXT, is_default INTEGER, archived INTEGER, created_by INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE sessions (id INTEGER PRIMARY KEY, title TEXT, session_date TEXT, venue TEXT, mode TEXT, description TEXT, code TEXT,
        registration_open INTEGER, closes_at TEXT, created_by INTEGER, created_at TEXT, updated_at TEXT, template_id INTEGER);
      INSERT INTO sessions VALUES (2, 'VLSI careers', '2026-10-01', 'CVR', 'in-person', NULL, 'ABC234', 1, NULL, 3, '${at}', '${at}', 4);
      CREATE TABLE inquiries (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, email TEXT, college TEXT, stream TEXT, year_of_study TEXT, domain TEXT,
        plan TEXT, source TEXT, brochure TEXT, message TEXT, status TEXT, assigned_to INTEGER, next_follow_up TEXT, consent_at TEXT,
        created_by INTEGER, created_at TEXT, updated_at TEXT, student_id INTEGER);
      INSERT INTO inquiries VALUES (7, 'Ravi', '+919000000000', NULL, NULL, NULL, NULL, NULL, NULL, 'walk-in', NULL, NULL, 'new', 5, NULL,
        '${at}', 3, '${at}', '${at}', 11);
      CREATE TABLE inquiry_notes (id INTEGER PRIMARY KEY, inquiry_id INTEGER, author_id INTEGER, kind TEXT, body TEXT, created_at TEXT);
      INSERT INTO inquiry_notes VALUES (9, 7, 5, 'note', 'Called back', '${at}');
      CREATE TABLE certificate_registrations (id INTEGER PRIMARY KEY, session_id INTEGER, name TEXT, email TEXT, phone TEXT, college TEXT,
        stream TEXT, year_of_study TEXT, consent_at TEXT, certificate_id TEXT, download_token_hash TEXT, status TEXT, revoked_reason TEXT,
        issued_at TEXT, download_count INTEGER, last_downloaded_at TEXT, created_at TEXT, updated_at TEXT, student_id INTEGER,
        template_id INTEGER, email_status TEXT, email_error TEXT, emailed_at TEXT);
      INSERT INTO certificate_registrations VALUES (20, 2, 'Asha', 'asha@example.com', '+919876543210', 'JNTU', NULL, NULL, '${at}',
        'SLK-2026-7K4M9Q2X', '${'a'.repeat(64)}', 'issued', NULL, '${at}', 1, '${at}', '${at}', '${at}', 10, 4, 'sent', NULL, '${at}');
      CREATE TABLE certificate_events (id INTEGER PRIMARY KEY, registration_id INTEGER, type TEXT, detail TEXT, actor_id INTEGER, created_at TEXT);
      INSERT INTO certificate_events VALUES (30, 20, 'registered', 'Registered', NULL, '${at}'), (31, 20, 'emailed', 'Sent', 3, '${at}');
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_by INTEGER, updated_at TEXT);
      INSERT INTO settings VALUES ('google_sheet_id', 'sheet123', 3, '${at}');
      CREATE TABLE sheet_sync (registration_id INTEGER, spreadsheet_id TEXT, synced_at TEXT, PRIMARY KEY (registration_id, spreadsheet_id));
      INSERT INTO sheet_sync VALUES (20, 'sheet123', '${at}');
      CREATE TABLE id_sequences (name TEXT PRIMARY KEY, value INTEGER);
      INSERT INTO id_sequences VALUES ('student:2026', 12);
    `);
    lite
      .prepare('INSERT INTO certificate_templates VALUES (4, ?, ?, ?, ?, ?, ?, ?, 1, 0, 3, ?, ?)')
      .run('Gold', 'png', big, big.length, 841.89, 595.28, JSON.stringify(DEFAULT_LAYOUT), at, at);
    lite.close();
  });

  after(async () => {
    await t.drop();
    fs.rmSync(file, { force: true });
  });

  test('copies every table with ids, Student IDs and links unchanged', async () => {
    const counts = await importSqlite(file, t.db, { log: () => {} });
    assert.equal(counts.users, 2);
    assert.equal(counts.certificate_events, 2);
    const reg = await t.db.get('SELECT * FROM certificate_registrations WHERE id = 20');
    assert.equal(reg.certificate_id, 'SLK-2026-7K4M9Q2X');
    assert.equal(reg.download_token_hash, 'a'.repeat(64), 'emailed download links keep working');
    assert.equal(reg.student_id, 10);
    assert.equal((await t.db.get('SELECT student_code FROM students WHERE id = 10')).student_code, 'SLK-STU-2026-00041');
    assert.deepEqual({ ...(await t.db.get('SELECT assigned_to, created_by, student_id FROM inquiries WHERE id = 7')) }, { assigned_to: 5, created_by: 3, student_id: 11 });
    assert.equal((await t.db.get('SELECT author_id FROM inquiry_notes WHERE id = 9')).author_id, 5);
    assert.equal((await t.db.get('SELECT token_version FROM users WHERE id = 3')).token_version, 2, 'signed-in sessions stay valid');
    assert.equal((await t.db.get("SELECT value FROM settings WHERE `key` = 'google_sheet_id'")).value, 'sheet123');
    assert.equal((await t.db.get('SELECT COUNT(*) AS n FROM sheet_sync')).n, 1, 'rows already in the Google Sheet are not sent again');
  });

  test('template files are stored in parts and read back whole', async () => {
    const { createTemplateRepo } = require('../src/certificateTemplates');
    const parts = await t.db.all('SELECT part FROM certificate_template_files WHERE template_id = 4 ORDER BY part');
    assert.equal(parts.length, 3);
    const tpl = await createTemplateRepo(t.db).forRender(4);
    assert.ok(tpl.file.equals(big));
  });

  test('a student without a Student ID gets the next free number, and new rows continue after the imported ids', async () => {
    assert.equal((await t.db.get('SELECT student_code FROM students WHERE id = 11')).student_code, 'SLK-STU-2026-00042', 'after the highest imported number');
    const r = await t.db.run("INSERT INTO inquiries (name, phone, source, consent_at, created_at, updated_at) VALUES ('New', '+919111111111', 'contact', ?, ?, ?)", [at, at, at]);
    assert.ok(r.insertId > 7, `new enquiry id ${r.insertId}`);
  });

  test('refuses to import into a database that already has data, unless asked to replace it', async () => {
    await assert.rejects(importSqlite(file, t.db, { log: () => {} }), /already has data/);
    await importSqlite(file, t.db, { replace: true, log: () => {} });
    assert.equal((await t.db.get('SELECT COUNT(*) AS n FROM inquiries')).n, 1, 'the extra enquiry is gone');
  });
});
