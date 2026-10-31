'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, addUser, login, client, postPublic, validInquiry, referral, ALLOWED_ORIGIN } = require('./helpers');
const { localDate } = require('../src/util');

describe('manager role', () => {
  let ctx, admin, manager, counsellor, adminApi, managerApi, session, regId, studentId, inquiryId;

  before(async () => {
    ctx = await startApp();
    admin = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
    manager = await addUser(ctx.db, { name: 'Mohan Manager', email: 'mohan@sloka.test', role: 'manager', password: 'mohan-password-123' });
    counsellor = await addUser(ctx.db, { name: 'Kiran C', email: 'kiran@sloka.test', role: 'counsellor', password: 'kiran-password-123' });
    adminApi = client(ctx.base, (await login(ctx.base, admin.email, admin.password)).cookie);
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
    const row = (await ctx.db.get('SELECT id, student_id FROM certificate_registrations'));
    regId = row.id;
    studentId = row.student_id;
    await postPublic(ctx.base, validInquiry({ name: 'Ravi Teja', email: 'ravi@example.com', phone: '9000000002' }));
    inquiryId = (await ctx.db.get('SELECT MAX(id) AS id FROM inquiries')).id;
  });
  after(() => ctx.close());

  test('signs in with only the manage permission', async () => {
    const me = await managerApi.get('/api/auth/me');
    assert.equal(me.data.user.role, 'manager');
    assert.deepEqual(me.data.user.permissions, ['manage']);
    const c = await login(ctx.base, counsellor.email, counsellor.password);
    assert.deepEqual(c.body.user.permissions, []);
  });

  test('has the admin powers that are not exports, record edits/deletions or user deletion', async () => {
    const ok = async (res, status = 200) => assert.equal((await res).status, status, JSON.stringify((await res).data));
    await ok(managerApi.patch(`/api/sessions/${session.id}`, { registrationOpen: false }));
    await ok(managerApi.post(`/api/sessions/${session.id}/regenerate-code`));
    await ok(managerApi.post(`/api/certificates/${regId}/revoke`, { reason: 'Did not attend' }));
    await ok(managerApi.post(`/api/certificates/${regId}/reinstate`));
    await ok(managerApi.get('/api/settings'));
    await ok(managerApi.get('/api/templates'));
    await ok(managerApi.get('/api/users'));
    // Working enquiries, like a counsellor.
    await ok(managerApi.patch(`/api/inquiries/${inquiryId}`, { status: 'contacted' }));
    // Staff accounts below admin.
    const created = await managerApi.post('/api/users', { name: 'New Counsellor', email: 'nc@sloka.test', role: 'counsellor', password: 'a-long-password' });
    assert.equal(created.status, 201);
    await ok(managerApi.patch(`/api/users/${created.data.user.id}`, { role: 'manager', name: 'New Manager' }));
    await ok(managerApi.post(`/api/users/${counsellor.id}/password`, { password: 'reset-by-manager' }), 204);
  });

  test('cannot export or download student data', async () => {
    for (const path of ['/api/students/export', '/api/inquiries/export', '/api/certificates/export', `/api/sessions/${session.id}/export`]) {
      assert.equal((await managerApi.get(path)).status, 403, path);
    }
    // Pointing the Google Sheet sync at a new sheet would copy every registration there.
    assert.equal((await managerApi.put('/api/settings/google-sheet', { url: 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz/edit' })).status, 403);
  });

  test('cannot edit or delete records', async () => {
    for (const [method, path, body] of [
      ['patch', `/api/students/${studentId}`, { college: 'Changed' }],
      ['patch', `/api/certificates/${regId}`, { name: 'Someone Else' }],
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

  test('cannot deactivate staff, or create, change or take over an admin', async () => {
    for (const [method, path, body] of [
      ['patch', `/api/users/${counsellor.id}`, { active: false }],
      ['post', '/api/users', { name: 'Sneaky Admin', email: 'sneaky@sloka.test', role: 'admin', password: 'a-long-password' }],
      ['patch', `/api/users/${counsellor.id}`, { role: 'admin' }],
      ['patch', `/api/users/${admin.id}`, { role: 'counsellor' }],
      ['patch', `/api/users/${admin.id}`, { name: 'Renamed Admin' }],
      ['post', `/api/users/${admin.id}/password`, { password: 'taken-over-123' }],
    ]) {
      assert.equal((await managerApi[method](path, body)).status, 403, `${method} ${path} ${JSON.stringify(body)}`);
    }
    assert.equal((await managerApi.patch(`/api/users/${manager.id}`, { role: 'counsellor' })).status, 400, 'not their own role either');
    assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM users WHERE email = 'sneaky@sloka.test'")).n, 0);
    assert.equal((await login(ctx.base, admin.email, admin.password)).res.status, 200, 'admin password unchanged');
    assert.equal((await ctx.db.get('SELECT active FROM users WHERE id = ?', [counsellor.id])).active, 1);
  });

  test('admins can make and remove managers; changing a role signs the user out', async () => {
    const u = await addUser(ctx.db, { name: 'Promote Me', email: 'promote@sloka.test', password: 'promote-me-123' });
    const session = client(ctx.base, (await login(ctx.base, u.email, u.password)).cookie);
    assert.equal((await adminApi.patch(`/api/users/${u.id}`, { role: 'manager' })).data.user.role, 'manager');
    assert.equal((await session.get('/api/auth/me')).status, 401);
    const fresh = client(ctx.base, (await login(ctx.base, u.email, u.password)).cookie);
    assert.equal((await fresh.get('/api/settings')).status, 200);
    assert.equal((await adminApi.patch(`/api/users/${u.id}`, { active: false })).status, 200);
  });
});
