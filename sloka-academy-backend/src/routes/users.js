'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { validateNewUser, validateUserUpdate, validatePassword } = require('../validation');
const { validationError, HttpError } = require('../util');
const { can } = require('../constants');

const hasErrors = (o) => Object.keys(o).length > 0;

const userToApi = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active === 1,
  createdAt: u.created_at,
  lastLoginAt: u.last_login_at,
});

function parseId(raw) {
  if (!/^\d{1,12}$/.test(String(raw))) throw new HttpError(404, { error: 'not_found' });
  return Number(raw);
}

async function createUser(db, { name, email, role, password }, rounds = 12) {
  const hash = await bcrypt.hash(password, rounds);
  const now = new Date().toISOString();
  const r = await db.run('INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', [
    name,
    email.toLowerCase(),
    hash,
    role,
    now,
    now,
  ]);
  return r.insertId;
}

// User management for managers and admins. Users are never hard-deleted (notes keep their author);
// deactivating is the admin-only equivalent. Only admins can create, change or reset admin accounts.
function usersRouter({ db, config, auth }) {
  const router = express.Router();
  const byId = (id) => db.get('SELECT * FROM users WHERE id = ?', [id]);
  const forbidden = () => new HttpError(403, { error: 'forbidden' });
  const may = (req, permission) => can(req.user.role, permission);

  router.get('/', async (req, res) => {
    res.json({ users: (await db.all('SELECT * FROM users ORDER BY active DESC, name')).map(userToApi) });
  });

  router.post('/', async (req, res) => {
    const { values, errors } = validateNewUser(req.body);
    if (values.role === 'admin' && !may(req, 'manageAdmins')) throw forbidden();
    if (!errors.email && (await db.get('SELECT id FROM users WHERE email = ?', [values.email]))) {
      errors.email = 'A user with this email already exists.';
    }
    if (hasErrors(errors)) throw validationError(errors);
    const id = await createUser(db, values, config.bcryptRounds);
    res.status(201).json({ user: userToApi(await byId(id)) });
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const { values, errors } = validateUserUpdate(req.body);
    if (hasErrors(errors)) throw validationError(errors);
    if (values.active !== undefined && !may(req, 'deactivateUsers')) throw forbidden();
    if (values.role === 'admin' && !may(req, 'manageAdmins')) throw forbidden();
    const result = await db.transaction(async () => {
      const user = await db.get('SELECT * FROM users WHERE id = ? FOR UPDATE', [id]);
      if (!user) throw new HttpError(404, { error: 'not_found' });
      if (user.role === 'admin' && !may(req, 'manageAdmins')) throw forbidden();
      const changingRole = values.role !== undefined && values.role !== user.role;
      const demoting = changingRole && user.role === 'admin';
      const deactivating = values.active === false && user.active === 1;
      if (id === req.user.id && (changingRole || deactivating)) {
        throw validationError({ [changingRole ? 'role' : 'active']: 'You cannot change the role of, or deactivate, your own account.' });
      }
      if (demoting || deactivating) {
        // Locks the other admins too, so two admins cannot remove each other at the same moment.
        const others = await db.all("SELECT id FROM users WHERE role = 'admin' AND active = 1 AND id <> ? FOR UPDATE", [id]);
        if (user.role === 'admin' && others.length === 0) {
          throw validationError({ [demoting ? 'role' : 'active']: 'At least one active admin is required.' });
        }
      }
      const name = values.name ?? user.name;
      const role = values.role ?? user.role;
      const active = values.active === undefined ? user.active : values.active ? 1 : 0;
      // Role change or deactivation invalidates existing sessions immediately.
      const bump = role !== user.role || active !== user.active ? 1 : 0;
      await db.run('UPDATE users SET name = ?, role = ?, active = ?, token_version = token_version + ?, updated_at = ? WHERE id = ?', [
        name,
        role,
        active,
        bump,
        new Date().toISOString(),
        id,
      ]);
      return byId(id);
    });
    res.json({ user: userToApi(result) });
  });

  router.post('/:id/password', async (req, res) => {
    const id = parseId(req.params.id);
    const { values, errors } = validatePassword(req.body);
    if (hasErrors(errors)) throw validationError(errors);
    const target = await byId(id);
    if (!target) throw new HttpError(404, { error: 'not_found' });
    if (target.role === 'admin' && !may(req, 'manageAdmins')) throw forbidden();
    const hash = await bcrypt.hash(values.password, config.bcryptRounds);
    await db.run('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?', [
      hash,
      new Date().toISOString(),
      id,
    ]);
    if (id === req.user.id) auth.issueSession(res, await byId(id)); // keep the admin's own session alive
    res.status(204).end();
  });

  return router;
}

module.exports = { usersRouter, createUser, userToApi };
