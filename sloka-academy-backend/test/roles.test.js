'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, addUser, login, client, postPublic, validInquiry, referral, ALLOWED_ORIGIN } = require('./helpers');
const { localDate } = require('../src/util');

const ASSOCIATE = { employeeId: 'SLK-101', mobile: '9876500001', department: 'operations', designation: 'Counsellor', dateOfJoining: '2026-01-05' };

// The portal's original Manager role, kept (as a custom role) with what it could do before roles became editable.
describe('manager role', () => {
  let ctx, superAdmin, admin, manager, counsellor, managerApi, session, regId, studentId, inquiryId;

  before(async () => {
    ctx = await startApp();
    superAdmin = await addUser(ctx.db, { name: 'Sam Super', email: 'super@sloka.test', role: 'super_admin', password: 'super-password-123' });
    admin = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
    manager = await addUser(ctx.db, { name: 'Mohan Manager', email: 'mohan@sloka.test', role: 'manager', password: 'mohan-password-123' });
    counsellor = await addUser(ctx.db, { name: 'Kiran C', email: 'kiran@sloka.test', role: 'counsellor', password: 'kiran-password-123' });
    managerApi = client(ctx.base, (await login(ctx.base, manager.email, manager.password)).cookie);

    const s = await managerApi.post('/api/sessions', { title: 'Careers in VLSI', sessionDate: localDate(), venue: 'CVR College', mode: 'in-person' });
    assert.equal(s.status, 201, 'managers create sessions');
    session = s.data.session;
    const reg = await fetch(`${ctx.base}/api/public/certificate-registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({
        sessionId: session.id, code: session.code, name: 'Priya Sharma', email: 'priya@example.com', phone: '9876543210', college: 'CVR', consent: true, ...referral(),
      }),
    });
    assert.equal(reg.status, 201);
    const row = await ctx.db.get('SELECT id, student_id FROM certificate_registrations');
    regId = row.id;
    studentId = row.student_id;
    await postPublic(ctx.base, validInquiry({ name: 'Ravi Teja', email: 'ravi@example.com', phone: '9000000002' }));
    inquiryId = (await ctx.db.get('SELECT MAX(id) AS id FROM inquiries')).id;
  });
  after(() => ctx.close());

  test('signs in with the permissions of the original manager', async () => {
    const me = (await managerApi.get('/api/auth/me')).data.user;
    assert.equal(me.role, 'manager');
    assert.equal(me.roleName, 'Manager');
    for (const p of ['sessions.create', 'sessions.edit', 'certificates.edit', 'certTemplates.edit', 'settings.view', 'associates.create', 'enquiries.edit', 'students.create']) {
      assert.ok(me.permissions.includes(p), p);
    }
    for (const p of ['enquiries.export', 'students.edit', 'students.delete', 'associates.delete', 'settings.edit', 'registrations.view', 'roles.view']) {
      assert.ok(!me.permissions.includes(p), p);
    }
    const c = await login(ctx.base, counsellor.email, counsellor.password);
    assert.deepEqual(c.body.user.permissions, ['certTemplates.view', 'certificates.view', 'enquiries.create', 'enquiries.edit', 'enquiries.view', 'sessions.view', 'students.view']);
  });

  test('runs sessions, certificates, designs and associates below them', async () => {
    const ok = async (res, status = 200) => {
      const r = await res;
      assert.equal(r.status, status, JSON.stringify(r.data));
      return r;
    };
    await ok(managerApi.patch(`/api/sessions/${session.id}`, { registrationOpen: false }));
    await ok(managerApi.post(`/api/sessions/${session.id}/regenerate-code`));
    await ok(managerApi.post(`/api/certificates/${regId}/revoke`, { reason: 'Did not attend' }));
    await ok(managerApi.post(`/api/certificates/${regId}/reinstate`));
    await ok(managerApi.get('/api/settings'));
    await ok(managerApi.get('/api/templates'));
    await ok(managerApi.get('/api/associates'));
    await ok(managerApi.patch(`/api/inquiries/${inquiryId}`, { status: 'contacted' }));
    // Associates with roles no more powerful than their own.
    const created = await ok(managerApi.post('/api/associates', { ...ASSOCIATE, name: 'New Counsellor', email: 'nc@sloka.test', role: 'counsellor' }), 201);
    assert.equal(created.data.invite.emailed, false, 'email is off in this test');
    assert.match(created.data.invite.tempPassword, /^[A-Za-z2-9]{12}$/);
    await ok(managerApi.patch(`/api/associates/${created.data.associate.id}`, { role: 'manager', name: 'New Manager' }));
    await ok(managerApi.post(`/api/associates/${counsellor.id}/reset-password`));
  });

  test('cannot export or download student data', async () => {
    for (const path of ['/api/students/export', '/api/inquiries/export', '/api/certificates/export', `/api/sessions/${session.id}/export`]) {
      assert.equal((await managerApi.get(path)).status, 403, path);
    }
    // Pointing the Google Sheet sync at a new sheet would copy every registration there.
    assert.equal((await managerApi.put('/api/settings/google-sheet', { url: 'https://script.google.com/macros/s/abc/exec' })).status, 403);
  });

  test('cannot edit or delete student records', async () => {
    for (const [method, path, body] of [
      ['patch', `/api/students/${studentId}`, { college: 'Changed' }],
      ['del', `/api/students/${studentId}`],
      ['del', `/api/certificates/${regId}`],
      ['del', `/api/inquiries/${inquiryId}`],
      ['del', `/api/sessions/${session.id}`],
      ['del', '/api/templates/1'],
    ]) {
      assert.equal((await managerApi[method](path, body)).status, 403, `${method} ${path}`);
    }
    assert.equal((await ctx.db.get('SELECT college FROM students WHERE id = ?', [studentId])).college, 'CVR');
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM certificate_registrations')).n, 1);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM inquiries WHERE id = ?', [inquiryId])).n, 1);
  });

  test('cannot deactivate associates, or create, change or take over anyone more powerful', async () => {
    for (const [method, path, body] of [
      ['patch', `/api/associates/${counsellor.id}`, { active: false }],
      ['post', '/api/associates', { ...ASSOCIATE, employeeId: 'SLK-102', name: 'Sneaky Admin', email: 'sneaky@sloka.test', role: 'admin' }],
      ['post', '/api/associates', { ...ASSOCIATE, employeeId: 'SLK-103', name: 'Sneaky Super', email: 'sneaky2@sloka.test', role: 'super_admin' }],
      ['patch', `/api/associates/${counsellor.id}`, { role: 'admin' }],
      ['patch', `/api/associates/${admin.id}`, { role: 'counsellor' }],
      ['patch', `/api/associates/${admin.id}`, { name: 'Renamed Admin' }],
      ['patch', `/api/associates/${superAdmin.id}`, { name: 'Renamed Super' }],
      ['post', `/api/associates/${admin.id}/reset-password`],
      ['post', `/api/associates/${superAdmin.id}/reset-password`],
      ['put', `/api/associates/${counsellor.id}/permissions`, { overrides: { 'enquiries.export': true } }],
    ]) {
      assert.equal((await managerApi[method](path, body)).status, 403, `${method} ${path} ${JSON.stringify(body)}`);
    }
    assert.equal((await managerApi.patch(`/api/associates/${manager.id}`, { role: 'counsellor' })).status, 400, 'not their own role either');
    assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM users WHERE email LIKE 'sneaky%'")).n, 0);
    assert.equal((await login(ctx.base, admin.email, admin.password)).res.status, 200, 'admin password unchanged');
    assert.equal((await ctx.db.get('SELECT active FROM users WHERE id = ?', [counsellor.id])).active, 1);
  });

  test('changing a role signs the associate out; the new role applies at once', async () => {
    const adminApi = client(ctx.base, (await login(ctx.base, admin.email, admin.password)).cookie);
    const u = await addUser(ctx.db, { name: 'Promote Me', email: 'promote@sloka.test', password: 'promote-me-123' });
    const old = client(ctx.base, (await login(ctx.base, u.email, u.password)).cookie);
    assert.equal((await old.get('/api/settings')).status, 403);
    assert.equal((await adminApi.patch(`/api/associates/${u.id}`, { role: 'manager' })).data.associate.role, 'manager');
    assert.equal((await old.get('/api/auth/me')).status, 401);
    const fresh = client(ctx.base, (await login(ctx.base, u.email, u.password)).cookie);
    assert.equal((await fresh.get('/api/settings')).status, 200);
    assert.equal((await adminApi.patch(`/api/associates/${u.id}`, { active: false })).status, 200);
  });
});
