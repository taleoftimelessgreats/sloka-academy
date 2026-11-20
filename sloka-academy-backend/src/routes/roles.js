'use strict';

const express = require('express');
const { validateRole } = require('../validation');
const { validationError, HttpError, hasErrors } = require('../util');
const { catalogue, SUPER_ADMIN, ALL_PERMISSIONS } = require('../permissions');
const { isDuplicate } = require('../db');
const { ENTITIES } = require('../audit');

const roleToApi = (r, permissions) => ({
  key: r.role_key,
  name: r.name,
  description: r.description ?? null,
  scope: r.role_key === SUPER_ADMIN ? 'all' : r.scope,
  system: r.is_system === 1,
  locked: r.role_key === SUPER_ADMIN, // always every permission
  permissions: r.role_key === SUPER_ADMIN ? ALL_PERMISSIONS : permissions,
  associates: r.user_count ?? 0,
});

/** Roles & permissions (Super Admin): the grid of modules x actions per role, data scope, custom roles. */
function rolesRouter({ db, auth, audit }) {
  const router = express.Router();
  const SELECT = 'SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role = r.role_key) AS user_count FROM roles r';

  async function list() {
    const [roles, perms] = await Promise.all([
      db.all(`${SELECT} ORDER BY r.is_system DESC, r.created_at, r.name`),
      db.all('SELECT role_key, permission FROM role_permissions ORDER BY permission'),
    ]);
    return roles.map((r) => roleToApi(r, perms.filter((p) => p.role_key === r.role_key).map((p) => p.permission)));
  }
  const one = async (key) => (await list()).find((r) => r.key === key);

  async function setPermissions(key, permissions) {
    await db.run('DELETE FROM role_permissions WHERE role_key = ?', [key]);
    for (const p of permissions) await db.run('INSERT INTO role_permissions (role_key, permission) VALUES (?, ?)', [key, p]);
  }

  const duplicateName = (err) => {
    if (isDuplicate(err, 'uq_roles_name')) throw validationError({ name: 'A role with this name already exists.' });
    throw err;
  };

  router.get('/', auth.requirePermission('roles.view'), async (req, res) => {
    res.json({ ...catalogue(), roles: await list() });
  });

  // { name, description?, scope, permissions: ['module.action', ...] }
  router.post('/', auth.requirePermission('roles.edit'), async (req, res) => {
    const { values, errors } = validateRole(req.body);
    if (hasErrors(errors)) throw validationError(errors);
    const base = values.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'role';
    const key = await db
      .transaction(async () => {
        let k = /^[a-z]/.test(base) ? base : `role_${base}`;
        for (let i = 2; await db.get('SELECT role_key FROM roles WHERE role_key = ?', [k]); i++) k = `${base}_${i}`;
        const t = new Date().toISOString();
        await db.run('INSERT INTO roles (role_key, name, description, scope, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)', [
          k, values.name, values.description ?? null, values.scope, t, t,
        ]);
        await setPermissions(k, values.permissions);
        await audit.log({
          actorId: req.user.id, entity: 'role', entityId: k, action: 'create', summary: `Created role "${values.name}" (${values.scope} records)`,
          changes: [{ field: 'Permissions', from: null, to: values.permissions.join(', ') || 'none' }],
        });
        return k;
      })
      .catch(duplicateName);
    res.status(201).json({ role: await one(key) });
  });

  // { name?, description?, scope?, permissions? } (Super Admin's permissions and scope cannot change).
  router.patch('/:key', auth.requirePermission('roles.edit'), async (req, res) => {
    const key = String(req.params.key);
    const before = await one(key);
    if (!before) throw new HttpError(404, { error: 'not_found' });
    const { values, errors } = validateRole(req.body, { partial: true });
    if (before.locked && (values.permissions !== undefined || (values.scope !== undefined && values.scope !== 'all'))) {
      errors.permissions = 'The Super Admin role always has every permission.';
    }
    if (hasErrors(errors)) throw validationError(errors);
    await db
      .transaction(async () => {
        const sets = [];
        const params = [];
        for (const k of ['name', 'description', 'scope']) {
          if (values[k] === undefined) continue;
          sets.push(`${k} = ?`);
          params.push(values[k]);
        }
        if (sets.length) await db.run(`UPDATE roles SET ${sets.join(', ')}, updated_at = ? WHERE role_key = ?`, [...params, new Date().toISOString(), key]);
        const changes = [];
        for (const [k, label] of [['name', 'Name'], ['description', 'Description'], ['scope', 'Data scope']]) {
          if (values[k] !== undefined && values[k] !== before[k]) changes.push({ field: label, from: before[k], to: values[k] });
        }
        if (values.permissions !== undefined) {
          await setPermissions(key, values.permissions);
          const added = values.permissions.filter((p) => !before.permissions.includes(p));
          const removed = before.permissions.filter((p) => !values.permissions.includes(p));
          for (const p of added) changes.push({ field: p, from: 'no', to: 'yes' });
          for (const p of removed) changes.push({ field: p, from: 'yes', to: 'no' });
        }
        if (changes.length) await audit.log({ actorId: req.user.id, entity: 'role', entityId: key, action: 'update', summary: `Changed role "${values.name ?? before.name}"`, changes });
      })
      .catch(duplicateName);
    res.json({ role: await one(key) });
  });

  // Custom roles that nobody has can be deleted.
  router.delete('/:key', auth.requirePermission('roles.edit'), async (req, res) => {
    const key = String(req.params.key);
    const role = await one(key);
    if (!role) throw new HttpError(404, { error: 'not_found' });
    if (role.system) return res.status(409).json({ error: 'system_role', message: 'This role is one of the built-in roles and cannot be deleted.' });
    if (role.associates) return res.status(409).json({ error: 'in_use', message: 'Associates have this role. Give them another role first.' });
    await db.transaction(async () => {
      await db.run('DELETE FROM roles WHERE role_key = ?', [key]); // its permissions go with it
      await audit.log({ actorId: req.user.id, entity: 'role', entityId: key, action: 'delete', summary: `Deleted role "${role.name}"` });
    });
    return res.status(204).end();
  });

  return router;
}

/** The audit log (read only). */
function auditRouter({ auth, audit }) {
  const router = express.Router();
  router.get('/', auth.requirePermission('audit.view'), async (req, res) => {
    const r = await audit.list(req.query);
    if (r.errors) throw validationError(r.errors);
    res.json({ ...r, entities: ENTITIES.map(([id, label]) => ({ id, label })) });
  });
  return router;
}

module.exports = { rolesRouter, auditRouter };
