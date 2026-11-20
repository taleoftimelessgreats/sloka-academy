'use strict';

const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { validateAssociate } = require('../validation');
const { validationError, HttpError, parseId, hasErrors } = require('../util');
const { SUPER_ADMIN, isPermission, isSuperAdminOnly, effectivePermissions } = require('../permissions');
const { diff } = require('../audit');

const associateToApi = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  employeeId: u.employee_id ?? null,
  mobile: u.mobile ?? null,
  department: u.department ?? null,
  designation: u.designation ?? null,
  role: u.role,
  roleName: u.role_name ?? u.role,
  reportingManager: u.reporting_manager_id ? { id: u.reporting_manager_id, name: u.manager_name ?? null } : null,
  dateOfJoining: u.date_of_joining ?? null,
  active: u.active === 1,
  mustChangePassword: u.must_change_password === 1,
  overrides: u.override_count ?? 0,
  createdAt: u.created_at,
  lastLoginAt: u.last_login_at,
});

const SELECT = `
  SELECT u.*, r.name AS role_name, m.name AS manager_name,
    (SELECT COUNT(*) FROM user_permission_overrides o WHERE o.user_id = u.id) AS override_count
  FROM users u LEFT JOIN roles r ON r.role_key = u.role LEFT JOIN users m ON m.id = u.reporting_manager_id`;

// Readable temporary passwords (no 0/O, 1/l/I): 12 characters, about 70 bits.
const TEMP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const tempPassword = () => Array.from({ length: 12 }, () => TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)]).join('');

const COLUMNS = {
  name: 'name',
  email: 'email',
  employeeId: 'employee_id',
  mobile: 'mobile',
  department: 'department',
  designation: 'designation',
  role: 'role',
  reportingManagerId: 'reporting_manager_id',
  dateOfJoining: 'date_of_joining',
};
const LABELS = {
  name: 'Name', email: 'Official email', employeeId: 'Employee ID', mobile: 'Mobile', department: 'Department', designation: 'Designation',
  role: 'Role', reportingManagerId: 'Reporting manager', dateOfJoining: 'Date of joining', active: 'Active',
};

/** Insert an account. Used by the portal, scripts/create-admin.js and the tests. Resolves to its id. */
async function createUser(db, { name, email, role, password, mustChangePassword = false, ...details }, rounds = 12) {
  const hash = await bcrypt.hash(password, rounds);
  const now = new Date().toISOString();
  const r = await db.run(
    `INSERT INTO users (name, email, password_hash, role, active, must_change_password, employee_id, mobile, department, designation,
      reporting_manager_id, date_of_joining, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name, email.toLowerCase(), hash, role, mustChangePassword ? 1 : 0, details.employeeId ?? null, details.mobile ?? null,
      details.department ?? null, details.designation ?? null, details.reportingManagerId ?? null, details.dateOfJoining ?? null, now, now,
    ],
  );
  return r.insertId;
}

/**
 * Associates: the people who can sign in to the portal. They are never deleted (their registrations and notes stay
 * tagged to them); deactivating one revokes access at once. Nobody can hand out, or manage someone with, more
 * power than they have: a role (or an associate) is only theirs to assign (or manage) if every permission of it is
 * one they hold. Super Admins manage everyone, and only they manage Super Admins.
 */
function associatesRouter({ db, config, auth, audit, notifier }) {
  const router = express.Router();
  const byId = async (id) => db.get(`${SELECT} WHERE u.id = ?`, [id]);
  const forbidden = () => new HttpError(403, { error: 'forbidden' });
  const isSuperAdmin = (req) => req.user.role === SUPER_ADMIN;
  const perm = (req, p) => req.user.permissions.has(p);

  const covers = (req, permissions) => [...permissions].every((p) => req.user.permissions.has(p));
  async function rolePermissions(roleKey) {
    return (await db.all('SELECT permission FROM role_permissions WHERE role_key = ?', [roleKey])).map((r) => r.permission);
  }
  /** May the user give someone this role? */
  async function mayAssign(req, roleKey) {
    if (isSuperAdmin(req)) return true;
    return roleKey !== SUPER_ADMIN && covers(req, await rolePermissions(roleKey));
  }
  /** May the user manage this associate (edit, reset, deactivate)? Their role and own grants count. */
  async function mayManage(req, user) {
    if (isSuperAdmin(req)) return true;
    if (user.role === SUPER_ADMIN) return false;
    const overrides = await db.all('SELECT permission, granted FROM user_permission_overrides WHERE user_id = ?', [user.id]);
    return covers(req, effectivePermissions(user.role, await rolePermissions(user.role), Object.fromEntries(overrides.map((o) => [o.permission, o.granted === 1]))));
  }

  /** Email the sign-in details. Resolves to { emailed, tempPassword? }: the password is returned only if it could not be sent. */
  async function deliver(user, password, kind) {
    const role = await db.get('SELECT name FROM roles WHERE role_key = ?', [user.role]);
    if (notifier && notifier.studentEmailEnabled && typeof notifier.sendAssociateInvite === 'function') {
      try {
        await notifier.sendAssociateInvite({ to: user.email, name: user.name, password, roleName: role ? role.name : user.role, loginUrl: config.dashboardUrl, kind });
        return { emailed: true };
      } catch (err) {
        return { emailed: false, error: err.message, tempPassword: password };
      }
    }
    return { emailed: false, error: 'Email is not configured on the server.', tempPassword: password };
  }

  async function checkRole(values, errors, req) {
    if (values.role === undefined || errors.role) return;
    if (!(await db.get('SELECT role_key FROM roles WHERE role_key = ?', [values.role]))) errors.role = 'Choose a role.';
    else if (!(await mayAssign(req, values.role))) throw forbidden();
  }

  /** The reporting manager must be another active associate, and not someone who reports to this one (no loops). */
  async function checkManager(values, errors, selfId = null) {
    const managerId = values.reportingManagerId;
    if (managerId == null || errors.reportingManagerId) return;
    if (managerId === selfId) {
      errors.reportingManagerId = 'An associate cannot report to themselves.';
      return;
    }
    if (!(await db.get('SELECT id FROM users WHERE id = ? AND active = 1', [managerId]))) {
      errors.reportingManagerId = 'Choose an active associate.';
      return;
    }
    if (selfId !== null) {
      for (let id = managerId, hops = 0; id && hops < 100; hops++) {
        const row = await db.get('SELECT reporting_manager_id FROM users WHERE id = ?', [id]);
        id = row ? row.reporting_manager_id : null;
        if (id === selfId) {
          errors.reportingManagerId = 'That associate reports to this one; choose someone else.';
          return;
        }
      }
    }
  }

  async function checkUnique(values, errors, selfId = null) {
    if (values.email && !errors.email) {
      const other = await db.get('SELECT id FROM users WHERE email = ?', [values.email]);
      if (other && other.id !== selfId) errors.email = 'An associate with this email already exists.';
    }
    if (values.employeeId && !errors.employeeId) {
      const other = await db.get('SELECT id FROM users WHERE employee_id = ?', [values.employeeId]);
      if (other && other.id !== selfId) errors.employeeId = 'Another associate has this employee ID.';
    }
  }

  router.get('/', auth.requirePermission('associates.view'), async (req, res) => {
    res.json({ associates: (await db.all(`${SELECT} ORDER BY u.active DESC, u.name`)).map(associateToApi) });
  });

  router.get('/:id', auth.requirePermission('associates.view'), async (req, res) => {
    const u = await byId(parseId(req.params.id));
    if (!u) throw new HttpError(404, { error: 'not_found' });
    const overrides = perm(req, 'roles.view')
      ? Object.fromEntries((await db.all('SELECT permission, granted FROM user_permission_overrides WHERE user_id = ?', [u.id])).map((o) => [o.permission, o.granted === 1]))
      : undefined;
    res.json({ associate: associateToApi(u), overrides });
  });

  // Add Associate: creates the login with a temporary password and emails the invite.
  router.post('/', auth.requirePermission('associates.create'), async (req, res) => {
    const { values, errors } = validateAssociate(req.body);
    await checkRole(values, errors, req);
    await checkManager(values, errors);
    await checkUnique(values, errors);
    if (hasErrors(errors)) throw validationError(errors);
    const password = tempPassword();
    const id = await db.transaction(async () => {
      const newId = await createUser(db, { ...values, password, mustChangePassword: true }, config.bcryptRounds);
      const role = await db.get('SELECT name FROM roles WHERE role_key = ?', [values.role]);
      await audit.log({
        actorId: req.user.id, entity: 'associate', entityId: newId, action: 'create',
        summary: `Added associate ${values.name} (${values.employeeId}) as ${role ? role.name : values.role}`,
      });
      return newId;
    });
    const user = await byId(id);
    res.status(201).json({ associate: associateToApi(user), invite: await deliver(user, password, 'invite') });
  });

  router.patch('/:id', auth.requirePermission('associates.edit'), async (req, res) => {
    const id = parseId(req.params.id);
    const { values, errors } = validateAssociate(req.body, { partial: true });
    if (values.active !== undefined && !perm(req, 'associates.delete')) throw forbidden();
    await checkRole(values, errors, req);
    await checkManager(values, errors, id);
    await checkUnique(values, errors, id);
    if (hasErrors(errors)) throw validationError(errors);
    const updated = await db.transaction(async () => {
      const user = await db.get('SELECT * FROM users WHERE id = ? FOR UPDATE', [id]);
      if (!user) throw new HttpError(404, { error: 'not_found' });
      if (id !== req.user.id && !(await mayManage(req, user))) throw forbidden();
      const changingRole = values.role !== undefined && values.role !== user.role;
      const deactivating = values.active === false && user.active === 1;
      if (id === req.user.id && (changingRole || deactivating)) {
        throw validationError({ [changingRole ? 'role' : 'active']: 'You cannot change the role of, or deactivate, your own account.' });
      }
      if (user.role === SUPER_ADMIN && (changingRole || deactivating)) {
        // Locks the other Super Admins too, so two cannot remove each other at the same moment.
        const others = await db.all('SELECT id FROM users WHERE role = ? AND active = 1 AND id <> ? FOR UPDATE', [SUPER_ADMIN, id]);
        if (!others.length) throw validationError({ [changingRole ? 'role' : 'active']: 'At least one active Super Admin is required.' });
      }
      const sets = [];
      const params = [];
      for (const [k, col] of Object.entries(COLUMNS)) {
        if (values[k] === undefined) continue;
        sets.push(`${col} = ?`);
        params.push(values[k]);
      }
      const active = values.active === undefined ? user.active : values.active ? 1 : 0;
      // A role change or deactivation signs them out everywhere at once.
      const bump = changingRole || active !== user.active ? 1 : 0;
      await db.run(`UPDATE users SET ${[...sets, 'active = ?'].join(', ')}, token_version = token_version + ?, updated_at = ? WHERE id = ?`, [
        ...params, active, bump, new Date().toISOString(), id,
      ]);
      const before = Object.fromEntries(Object.entries(COLUMNS).map(([k, col]) => [k, user[col]]));
      const changes = diff({ ...before, active: user.active === 1 }, { ...values, active: values.active }, LABELS);
      if (changes.length) {
        const action = deactivating ? 'deactivate' : values.active === true && user.active === 0 ? 'activate' : 'update';
        await audit.log({ actorId: req.user.id, entity: 'associate', entityId: id, action, summary: `${action === 'update' ? 'Updated' : action === 'activate' ? 'Reactivated' : 'Deactivated'} associate ${user.name}`, changes });
      }
      return byId(id);
    });
    res.json({ associate: associateToApi(updated) });
  });

  // New temporary password, emailed; they must change it when they next sign in. Signs them out everywhere.
  router.post('/:id/reset-password', auth.requirePermission('associates.edit'), async (req, res) => {
    const id = parseId(req.params.id);
    const target = await byId(id);
    if (!target) throw new HttpError(404, { error: 'not_found' });
    if (id === req.user.id) throw validationError({ password: 'Change your own password under Account.' });
    if (!(await mayManage(req, target))) throw forbidden();
    const password = tempPassword();
    const hash = await bcrypt.hash(password, config.bcryptRounds);
    await db.transaction(async () => {
      await db.run('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1, updated_at = ? WHERE id = ?', [
        hash, new Date().toISOString(), id,
      ]);
      await audit.log({ actorId: req.user.id, entity: 'associate', entityId: id, action: 'reset_password', summary: `Reset the password of ${target.name}` });
    });
    res.json({ invite: await deliver(target, password, 'reset') });
  });

  // Per-associate grants and revocations on top of their role. { overrides: { 'module.action': true | false } }
  router.put('/:id/permissions', auth.requirePermission('roles.edit'), async (req, res) => {
    const id = parseId(req.params.id);
    const target = await byId(id);
    if (!target) throw new HttpError(404, { error: 'not_found' });
    const raw = req.body && req.body.overrides;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.entries(raw).every(([p, g]) => isPermission(p) && typeof g === 'boolean')) {
      throw validationError({ overrides: 'Invalid permissions.' });
    }
    if (target.role === SUPER_ADMIN && Object.keys(raw).length) throw validationError({ overrides: 'Super Admins always have every permission.' });
    if (Object.keys(raw).some(isSuperAdminOnly)) throw validationError({ overrides: 'Only Super Admins can delete records; delete permissions cannot be granted or revoked.' });
    await db.transaction(async () => {
      const before = Object.fromEntries(
        (await db.all('SELECT permission, granted FROM user_permission_overrides WHERE user_id = ? FOR UPDATE', [id])).map((o) => [o.permission, o.granted === 1]),
      );
      await db.run('DELETE FROM user_permission_overrides WHERE user_id = ?', [id]);
      for (const [p, g] of Object.entries(raw)) await db.run('INSERT INTO user_permission_overrides (user_id, permission, granted) VALUES (?, ?, ?)', [id, p, g ? 1 : 0]);
      const word = (v) => (v === true ? 'granted' : v === false ? 'revoked' : 'from role');
      const keys = [...new Set([...Object.keys(before), ...Object.keys(raw)])].sort();
      const changes = keys.filter((p) => before[p] !== raw[p]).map((p) => ({ field: p, from: word(before[p]), to: word(raw[p]) }));
      if (changes.length) {
        await audit.log({ actorId: req.user.id, entity: 'permission_override', entityId: id, action: 'update', summary: `Changed the permission overrides of ${target.name}`, changes });
      }
    });
    res.json({ overrides: raw, associate: associateToApi(await byId(id)) });
  });

  return router;
}

module.exports = { associatesRouter, createUser };
