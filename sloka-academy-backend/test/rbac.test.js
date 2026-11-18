'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, addUser, login, client } = require('./helpers');
const { ALL_PERMISSIONS } = require('../src/permissions');

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
});
