'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, addUser, login, client } = require('./helpers');

const details = (extra = {}) => ({
  name: 'Bhavana Rao',
  employeeId: 'slk-bd-007',
  email: 'Bhavana@Sloka.test',
  mobile: '98480 12345',
  department: 'bd-sales',
  designation: 'BD Associate',
  role: 'bd_associate',
  dateOfJoining: '2026-06-01',
  ...extra,
});

describe('associates', () => {
  let ctx, superAdmin, admin, superApi, adminApi;

  before(async () => {
    ctx = await startApp({ studentEmail: true });
    superAdmin = await addUser(ctx.db, { name: 'Sam Super', email: 'super@sloka.test', role: 'super_admin', password: 'super-password-123' });
    admin = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
    superApi = client(ctx.base, (await login(ctx.base, superAdmin.email, superAdmin.password)).cookie);
    adminApi = client(ctx.base, (await login(ctx.base, admin.email, admin.password)).cookie);
  });
  after(() => ctx.close());

  const lastEmailTo = (to) => [...ctx.outbox].reverse().find((m) => m.to === to);
  const tempPasswordIn = (msg) => /Temporary password: (\S+)/.exec(msg.text)[1];

  test('Add Associate: every field is required (reporting manager optional) and checked', async () => {
    const r = await adminApi.post('/api/associates', { name: 'X' });
    assert.equal(r.status, 400);
    for (const k of ['employeeId', 'email', 'mobile', 'department', 'designation', 'role', 'dateOfJoining']) assert.ok(r.data.fields[k], k);
    assert.ok(!r.data.fields.reportingManagerId);
    const bad = await adminApi.post('/api/associates', details({ mobile: '12345', department: 'space', role: 'nonexistent_role', employeeId: 'has spaces!' }));
    assert.equal(bad.status, 400);
    for (const k of ['mobile', 'department', 'role', 'employeeId']) assert.ok(bad.data.fields[k], k);
  });

  test('creates the login, emails the invite and requires a new password at first sign-in', async () => {
    const r = await adminApi.post('/api/associates', details());
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const a = r.data.associate;
    assert.equal(a.email, 'bhavana@sloka.test');
    assert.equal(a.employeeId, 'SLK-BD-007');
    assert.equal(a.mobile, '+919848012345');
    assert.equal(a.roleName, 'BD Associate');
    assert.equal(a.mustChangePassword, true);
    assert.deepEqual(r.data.invite, { emailed: true }, 'the password is not returned once it is emailed');
    const mail = lastEmailTo('bhavana@sloka.test');
    assert.match(mail.subject, /admin portal account/);
    assert.match(mail.text, /role: BD Associate/);
    const temp = tempPasswordIn(mail);

    const first = await login(ctx.base, 'bhavana@sloka.test', temp);
    assert.equal(first.res.status, 200);
    assert.equal(first.body.user.mustChangePassword, true);
    const api = client(ctx.base, first.cookie);
    const blocked = await api.get('/api/registrations');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.error, 'password_change_required');
    assert.equal((await api.get('/api/auth/me')).status, 200, 'their own account still works');
    assert.equal((await api.post('/api/auth/password', { currentPassword: temp, newPassword: temp })).status, 400, 'a new password, not the same one');
    assert.equal((await api.post('/api/auth/password', { currentPassword: temp, newPassword: 'my-own-password-1' })).status, 204);
    const after = client(ctx.base, (await login(ctx.base, 'bhavana@sloka.test', 'my-own-password-1')).cookie);
    assert.equal((await after.get('/api/registrations')).status, 200);
    assert.equal((await after.get('/api/auth/me')).data.user.mustChangePassword, false);
  });

  test('email and employee ID are unique; the reporting manager is an active associate and never a loop', async () => {
    assert.match((await adminApi.post('/api/associates', details({ employeeId: 'X-1' }))).data.fields.email, /already exists/);
    assert.match((await adminApi.post('/api/associates', details({ email: 'other@sloka.test' }))).data.fields.employeeId, /Another associate/);
    const bhavana = (await adminApi.get('/api/associates')).data.associates.find((x) => x.email === 'bhavana@sloka.test');
    const lead = await adminApi.post('/api/associates', details({ name: 'Lakshmi Lead', email: 'lead@sloka.test', employeeId: 'SLK-BD-001', role: 'bd_manager', designation: 'BD Manager' }));
    assert.equal(lead.status, 201);
    const leadId = lead.data.associate.id;
    const set = await adminApi.patch(`/api/associates/${bhavana.id}`, { reportingManagerId: leadId });
    assert.equal(set.status, 200);
    assert.equal(set.data.associate.reportingManager.name, 'Lakshmi Lead');
    assert.match((await adminApi.patch(`/api/associates/${leadId}`, { reportingManagerId: bhavana.id })).data.fields.reportingManagerId, /reports to this one/);
    assert.match((await adminApi.patch(`/api/associates/${leadId}`, { reportingManagerId: leadId })).data.fields.reportingManagerId, /themselves/);
  });

  test('deactivating revokes access at once and keeps the account; reset password emails a new temporary one', async () => {
    const u = await addUser(ctx.db, { name: 'Ops Person', email: 'ops@sloka.test', role: 'counsellor', password: 'ops-password-123' });
    const session = client(ctx.base, (await login(ctx.base, u.email, u.password)).cookie);
    assert.equal((await session.get('/api/auth/me')).status, 200);
    const off = await adminApi.patch(`/api/associates/${u.id}`, { active: false });
    assert.equal(off.status, 200);
    assert.equal(off.data.associate.active, false);
    assert.equal((await session.get('/api/auth/me')).status, 401, 'signed out everywhere');
    assert.equal((await login(ctx.base, u.email, u.password)).res.status, 401, 'cannot sign in');
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM users WHERE id = ?', [u.id])).n, 1, 'never deleted');
    assert.equal((await adminApi.patch(`/api/associates/${u.id}`, { active: true })).status, 200);

    const reset = await adminApi.post(`/api/associates/${u.id}/reset-password`);
    assert.deepEqual(reset.data.invite, { emailed: true });
    const mail = lastEmailTo('ops@sloka.test');
    assert.match(mail.subject, /password was reset/);
    assert.equal((await login(ctx.base, u.email, u.password)).res.status, 401, 'old password gone');
    const s = await login(ctx.base, u.email, tempPasswordIn(mail));
    assert.equal(s.body.user.mustChangePassword, true);

    // Without email the admin is shown the temporary password once.
    ctx.mail.fail = 'SMTP down';
    const offline = await adminApi.post(`/api/associates/${u.id}/reset-password`);
    ctx.mail.fail = null;
    assert.equal(offline.data.invite.emailed, false);
    assert.equal((await login(ctx.base, u.email, offline.data.invite.tempPassword)).res.status, 200);
  });

  test('only Super Admins create or manage Super Admins; one active Super Admin always remains', async () => {
    const r = await adminApi.post('/api/associates', details({ name: 'New Super', email: 'ns@sloka.test', employeeId: 'SA-2', role: 'super_admin', designation: 'Director' }));
    assert.equal(r.status, 403);
    assert.equal((await adminApi.patch(`/api/associates/${superAdmin.id}`, { name: 'Renamed' })).status, 403);
    assert.equal((await adminApi.post(`/api/associates/${superAdmin.id}/reset-password`)).status, 403);
    const made = await superApi.post('/api/associates', details({ name: 'New Super', email: 'ns@sloka.test', employeeId: 'SA-2', role: 'super_admin', designation: 'Director' }));
    assert.equal(made.status, 201);
    const second = made.data.associate.id;
    assert.equal((await superApi.patch(`/api/associates/${superAdmin.id}`, { active: false })).status, 400, 'not themselves');
    assert.equal((await superApi.patch(`/api/associates/${second}`, { active: false })).status, 200);
    const other = await addUser(ctx.db, { name: 'Other Super', email: 'os@sloka.test', role: 'super_admin', password: 'other-super-123' });
    const otherApi = client(ctx.base, (await login(ctx.base, other.email, other.password)).cookie);
    assert.equal((await otherApi.patch(`/api/associates/${superAdmin.id}`, { role: 'admin' })).status, 200, 'two active, so one may go');
    assert.equal((await otherApi.patch(`/api/associates/${superAdmin.id}`, { role: 'super_admin' })).status, 200);
    // Their role changed (and back), which signed them out: sign in again for the next tests.
    superApi = client(ctx.base, (await login(ctx.base, superAdmin.email, superAdmin.password)).cookie);
  });

  test('per-associate overrides grant and revoke on top of the role (Super Admin only), and are logged', async () => {
    const u = await addUser(ctx.db, { name: 'Acc Person', email: 'acc@sloka.test', role: 'accounts', password: 'acc-password-123' });
    const api = client(ctx.base, (await login(ctx.base, u.email, u.password)).cookie);
    assert.equal((await api.get('/api/registrations/export')).status, 200);
    assert.equal((await api.get('/api/inquiries')).status, 403);
    assert.equal((await adminApi.put(`/api/associates/${u.id}/permissions`, { overrides: { 'enquiries.view': true } })).status, 403);
    const r = await superApi.put(`/api/associates/${u.id}/permissions`, { overrides: { 'enquiries.view': true, 'registrations.export': false } });
    assert.equal(r.status, 200);
    assert.equal(r.data.associate.overrides, 2);
    assert.equal((await api.get('/api/inquiries')).status, 200, 'applies at once');
    assert.equal((await api.get('/api/registrations/export')).status, 403);
    assert.equal((await superApi.put(`/api/associates/${u.id}/permissions`, { overrides: { 'no.such': true } })).status, 400);
    const log = (await superApi.get('/api/audit?entity=permission_override')).data.items[0];
    assert.match(log.summary, /Acc Person/);
    assert.deepEqual(log.changes.map((c) => [c.field, c.from, c.to]), [['enquiries.view', 'from role', 'granted'], ['registrations.export', 'from role', 'revoked']]);
    assert.equal(log.actor.name, 'Sam Super');
  });

  test('associate changes are in the audit log', async () => {
    const items = (await adminApi.get('/api/audit?entity=associate')).data.items;
    assert.ok(items.some((i) => i.action === 'create' && /Bhavana Rao/.test(i.summary)));
    assert.ok(items.some((i) => i.action === 'deactivate' && i.changes.some((c) => c.field === 'Active' && c.from === true && c.to === false)));
    assert.ok(items.some((i) => i.action === 'reset_password'));
  });
});
