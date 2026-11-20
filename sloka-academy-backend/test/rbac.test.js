'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, addUser, login, client, referral, ALLOWED_ORIGIN } = require('./helpers');
const { localDate } = require('../src/util');
const { ALL_PERMISSIONS, SUPER_ADMIN_ONLY } = require('../src/permissions');

describe('roles & permissions', () => {
  let ctx, superApi, adminApi;
  before(async () => {
    ctx = await startApp();
    const s = await addUser(ctx.db, { name: 'Sam Super', email: 'super@sloka.test', role: 'super_admin', password: 'super-password-123' });
    const a = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
    superApi = client(ctx.base, (await login(ctx.base, s.email, s.password)).cookie);
    adminApi = client(ctx.base, (await login(ctx.base, a.email, a.password)).cookie);
  });
  after(() => ctx.close());

  test('the grid: modules x actions, every role with its permissions and data scope (Super Admin only)', async () => {
    assert.equal((await adminApi.get('/api/roles')).status, 403);
    const r = (await superApi.get('/api/roles')).data;
    assert.deepEqual(r.actions.map((a) => a.id), ['view', 'create', 'edit', 'delete', 'export']);
    assert.ok(r.modules.some((m) => m.id === 'registrations' && m.actions.length === 5));
    assert.deepEqual(r.scopes.map((s) => s.id), ['own', 'team', 'all']);
    const byKey = Object.fromEntries(r.roles.map((x) => [x.key, x]));
    assert.equal(byKey.super_admin.locked, true);
    assert.equal(byKey.super_admin.permissions.length, ALL_PERMISSIONS.length);
    assert.equal(byKey.bd_associate.scope, 'own');
    assert.equal(byKey.bd_manager.scope, 'team');
    // The requirements' default matrix.
    const has = (role, p) => byKey[role].permissions.includes(p);
    assert.ok(has('bd_associate', 'registrations.create') && !has('bd_associate', 'registrations.export') && !has('bd_associate', 'payments.create'));
    assert.ok(has('bd_manager', 'registrations.export') && !has('bd_manager', 'registrations.edit'));
    assert.ok(has('accounts', 'payments.create') && has('accounts', 'registrations.edit') && !has('accounts', 'registrations.create') && !has('accounts', 'offerLetters.create'));
    assert.ok(has('admin', 'offerTemplates.edit') && has('admin', 'associates.create') && !has('admin', 'roles.edit'));
  });

  test('a custom role: its permissions and scope apply at once, at the API', async () => {
    assert.equal((await adminApi.post('/api/roles', { name: 'Sneaky', scope: 'all', permissions: [] })).status, 403);
    const bad = await superApi.post('/api/roles', { name: 'X', scope: 'galaxy', permissions: ['made.up'] });
    assert.ok(bad.data.fields.scope && bad.data.fields.permissions && bad.data.fields.name);
    const r = await superApi.post('/api/roles', { name: 'Marketing Intern', description: 'Reads enquiries', scope: 'own', permissions: ['enquiries.view'] });
    assert.equal(r.status, 201);
    assert.equal(r.data.role.key, 'marketing_intern');
    assert.equal((await superApi.post('/api/roles', { name: 'marketing intern', scope: 'own', permissions: [] })).status, 400, 'names are unique');

    const u = await addUser(ctx.db, { name: 'Ira Intern', email: 'ira@sloka.test', role: 'marketing_intern', password: 'ira-password-123' });
    const ira = client(ctx.base, (await login(ctx.base, u.email, u.password)).cookie);
    assert.equal((await ira.get('/api/inquiries')).status, 200);
    assert.equal((await ira.patch('/api/inquiries/1', { status: 'contacted' })).status, 403, 'hiding a button is not enough: the API refuses');
    assert.equal((await ira.get('/api/students')).status, 403);

    const changed = await superApi.patch('/api/roles/marketing_intern', { permissions: ['enquiries.view', 'students.view'], scope: 'team' });
    assert.equal(changed.status, 200);
    assert.equal((await ira.get('/api/students')).status, 200, 'no new sign-in needed');
    assert.equal((await ira.get('/api/auth/me')).data.user.scope, 'team');

    const entry = (await superApi.get('/api/audit?entity=role&entityId=marketing_intern')).data.items[0];
    assert.deepEqual(entry.changes.map((c) => [c.field, c.from, c.to]), [['Data scope', 'own', 'team'], ['students.view', 'no', 'yes']]);
  });

  test('Super Admin cannot be restricted; built-in roles and roles in use cannot be deleted', async () => {
    assert.equal((await superApi.patch('/api/roles/super_admin', { permissions: ['enquiries.view'] })).status, 400);
    assert.equal((await superApi.patch('/api/roles/super_admin', { description: 'Owner of everything' })).status, 200);
    assert.equal((await superApi.del('/api/roles/bd_manager')).status, 409);
    assert.equal((await superApi.del('/api/roles/marketing_intern')).status, 409, 'Ira has it');
    await ctx.db.run("UPDATE users SET role = 'counsellor' WHERE email = 'ira@sloka.test'");
    assert.equal((await superApi.del('/api/roles/marketing_intern')).status, 204);
    assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM role_permissions WHERE role_key = 'marketing_intern'")).n, 0);
  });

  test('the audit log is for those allowed to see it, filterable', async () => {
    const bd = await addUser(ctx.db, { name: 'B D', email: 'bd@sloka.test', role: 'bd_associate', password: 'bd-password-1234' });
    assert.equal((await client(ctx.base, (await login(ctx.base, bd.email, bd.password)).cookie).get('/api/audit')).status, 403);
    const all = (await adminApi.get('/api/audit')).data;
    assert.ok(all.total >= 3);
    assert.ok(all.items.every((i) => i.entity === 'role'));
    assert.equal((await adminApi.get('/api/audit?entity=nope')).status, 400);
    assert.equal((await adminApi.get('/api/audit?from=2001-01-01&to=2001-12-31')).data.total, 0);
  });

  test('only Super Admins delete records: no role or per-associate grant gives it to anyone else', async () => {
    assert.deepEqual(SUPER_ADMIN_ONLY, [
      'registrations.delete', 'payments.delete', 'offerTemplates.delete', 'students.delete', 'enquiries.delete', 'sessions.delete', 'certificates.delete', 'certTemplates.delete',
    ]);
    const grid = (await superApi.get('/api/roles')).data;
    const flagged = grid.modules.flatMap((m) => m.actions.filter((a) => a.superAdminOnly).map((a) => `${m.id}.${a.id}`));
    assert.deepEqual(flagged, SUPER_ADMIN_ONLY, 'the grid marks them');
    for (const r of grid.roles.filter((x) => !x.locked)) assert.ok(!r.permissions.some((p) => SUPER_ADMIN_ONLY.includes(p)), r.key);

    // Not on the Admin role, nor on anyone signed in who is not a Super Admin.
    const admin = (await adminApi.get('/api/auth/me')).data.user;
    assert.ok(!admin.permissions.some((p) => SUPER_ADMIN_ONLY.includes(p)));
    assert.ok(admin.permissions.includes('associates.delete'), 'deactivating associates is not deleting a record');
    const me = (await superApi.get('/api/auth/me')).data.user;
    assert.ok(SUPER_ADMIN_ONLY.every((p) => me.permissions.includes(p)));

    // A role cannot be given one, new or changed.
    const made = await superApi.post('/api/roles', { name: 'Cleaner', scope: 'all', permissions: ['enquiries.view', 'enquiries.delete'] });
    assert.equal(made.status, 400);
    assert.match(made.data.fields.permissions, /Only Super Admins can delete records/);
    assert.equal((await superApi.patch('/api/roles/admin', { permissions: [...grid.roles.find((x) => x.key === 'admin').permissions, 'students.delete'] })).status, 400);

    // Nor an associate, by an override.
    const u = await addUser(ctx.db, { name: 'Ola Override', email: 'ola@sloka.test', role: 'admin', password: 'ola-password-1234' });
    const put = await superApi.put(`/api/associates/${u.id}/permissions`, { overrides: { 'payments.delete': true } });
    assert.equal(put.status, 400);
    assert.equal((await superApi.put(`/api/associates/${u.id}/permissions`, { overrides: { 'enquiries.export': false } })).status, 200, 'other overrides still work');

    // Even a grant written straight into the database gives nothing.
    await ctx.db.run("INSERT INTO role_permissions (role_key, permission) VALUES ('admin', 'enquiries.delete')");
    await ctx.db.run("INSERT INTO user_permission_overrides (user_id, permission, granted) VALUES (?, 'students.delete', 1)", [u.id]);
    const ola = client(ctx.base, (await login(ctx.base, u.email, u.password)).cookie);
    const olaMe = (await ola.get('/api/auth/me')).data.user;
    assert.ok(!olaMe.permissions.includes('enquiries.delete') && !olaMe.permissions.includes('students.delete'));
    assert.equal((await ola.del('/api/students/999999')).status, 403);
    assert.equal((await ola.del('/api/inquiries/999999')).status, 403);
    await ctx.db.run("DELETE FROM role_permissions WHERE role_key = 'admin' AND permission = 'enquiries.delete'");
  });

  test('enquiry and participant data need their View permissions wherever they appear', async () => {
    const grid = (await superApi.get('/api/roles')).data;
    const label = (id) => grid.modules.find((m) => m.id === id).label;
    assert.equal(label('enquiries'), 'Enquiry data');
    assert.equal(label('students'), 'Participant (student) data');

    // A participant (with a referred friend, who becomes an enquiry) and an enquiry of their own.
    const s = (await superApi.post('/api/sessions', { title: 'Careers in VLSI', sessionDate: localDate(), mode: 'online' })).data.session;
    const reg = await fetch(`${ctx.base}/api/public/certificate-registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ sessionId: s.id, code: s.code, name: 'Asha Kumar', email: 'asha@example.com', phone: '9876543210', college: 'JNTU', consent: true, ...referral() }),
    });
    assert.equal(reg.status, 201);
    assert.equal((await superApi.post('/api/inquiries', { source: 'phone-call', name: 'Asha Kumar', phone: '9876543210', consent: true })).status, 201);
    const certId = (await superApi.get('/api/certificates')).data.items[0].id;
    const studentId = (await superApi.get('/api/students')).data.items.find((x) => x.name === 'Asha Kumar').id;

    // Someone with a role made of chosen permissions.
    let n = 0;
    const as = async (permissions) => {
      n += 1;
      const role = (await superApi.post('/api/roles', { name: `Data test ${n}`, scope: 'all', permissions })).data.role;
      const u = await addUser(ctx.db, { name: `Tester ${n}`, email: `tester${n}@sloka.test`, role: role.key, password: 'tester-password-123' });
      return client(ctx.base, (await login(ctx.base, u.email, u.password)).cookie);
    };

    // Certificates list participants: without Participant (student) data -> View, no certificate route answers.
    const certsOnly = await as(['certificates.view', 'certificates.export', 'sessions.view', 'sessions.export']);
    for (const path of ['/api/certificates', `/api/certificates/${certId}`, `/api/certificates/${certId}/pdf`, '/api/certificates/export', `/api/sessions/${s.id}/export`]) {
      assert.equal((await certsOnly.get(path)).status, 403, path);
    }
    assert.equal((await certsOnly.get(`/api/sessions/${s.id}`)).status, 200, 'the session itself is not participant data');
    assert.equal((await certsOnly.get('/api/stats')).data.recentRegistrations, undefined, 'nor the latest participants on the overview');

    // With it (and no Enquiry data -> View): participants, but not the enquiries (referred friends, a student's enquiries).
    const participants = await as(['certificates.view', 'students.view', 'students.export']);
    const cert = await participants.get(`/api/certificates/${certId}`);
    assert.equal(cert.status, 200);
    assert.equal(cert.data.referrals, null);
    const profile = (await participants.get(`/api/students/${studentId}`)).data;
    assert.equal(profile.enquiries, null);
    assert.equal(profile.student.latestEnquiryStatus, undefined);
    assert.equal(profile.student.enquiries, 1, 'counts only');
    assert.ok((await participants.get('/api/stats')).data.recentRegistrations.length);
    assert.equal((await participants.get('/api/inquiries')).status, 403);

    // Every enquiry route needs Enquiry data -> View, even the export.
    const exportOnly = await as(['enquiries.export', 'enquiries.create']);
    assert.equal((await exportOnly.get('/api/inquiries/export')).status, 403);
    assert.equal((await exportOnly.post('/api/inquiries', { source: 'phone-call', name: 'X Y', phone: '9123456780', consent: true })).status, 403);
    const both = await as(['students.view', 'enquiries.view', 'certificates.view']);
    assert.equal((await both.get(`/api/students/${studentId}`)).data.enquiries.length, 1);
    assert.equal((await both.get(`/api/certificates/${certId}`)).data.referrals.length, 1);

    // Student routes need Participant (student) data -> View too.
    const studentExportOnly = await as(['students.export']);
    assert.equal((await studentExportOnly.get('/api/students/export')).status, 403);
  });
});
