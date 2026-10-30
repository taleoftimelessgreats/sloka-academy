'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { RateLimiter } = require('../util');
const { validatePassword, asObject } = require('../validation');
const { permissionsFor } = require('../constants');

// The signed-in user as the dashboard sees it; `permissions` decides which controls it shows.
const sessionUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, permissions: permissionsFor(u.role) });

function authRouter({ db, config, auth }) {
  const router = express.Router();
  const perAccount = new RateLimiter(config.loginRateLimit); // failed logins per email+IP
  const perIp = new RateLimiter(config.loginIpRateLimit); // failed logins per IP (credential stuffing)
  const findByEmail = (email) => db.get('SELECT * FROM users WHERE email = ?', [email]);
  const getById = (id) => db.get('SELECT * FROM users WHERE id = ?', [id]);

  // Compare against a dummy hash when the email is unknown so response timing does not reveal accounts.
  let dummyHash;
  const getDummyHash = () => (dummyHash ||= bcrypt.hash('not-a-real-password-placeholder', config.bcryptRounds));

  router.post('/login', async (req, res) => {
    const body = asObject(req.body);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = req.ip || 'unknown';
    const key = `${email}|${ip}`;

    if (perAccount.isLimited(key) || perIp.isLimited(ip)) {
      res.setHeader('Retry-After', String(Math.max(perAccount.retryAfterSeconds(key), perIp.retryAfterSeconds(ip))));
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (!email || !password || Buffer.byteLength(password, 'utf8') > 72) {
      perAccount.hit(key);
      perIp.hit(ip);
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const user = await findByEmail(email);
    const ok = await bcrypt.compare(password, user ? user.password_hash : await getDummyHash());
    if (!user || !ok || user.active !== 1) {
      perAccount.hit(key);
      perIp.hit(ip);
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    perAccount.reset(key);
    await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), user.id]);
    auth.issueSession(res, user);
    return res.json({ user: sessionUser(user) });
  });

  router.post('/logout', (req, res) => {
    auth.clearSession(res);
    res.status(204).end();
  });

  router.get('/me', auth.authenticate, (req, res) => {
    res.json({ user: sessionUser(req.user) });
  });

  // Change own password (requires the current password). Invalidates other sessions.
  router.post('/password', auth.authenticate, async (req, res) => {
    const body = asObject(req.body);
    const user = await getById(req.user.id);
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const { values, errors } = validatePassword(body, 'newPassword');
    if (!current || !(await bcrypt.compare(current, user.password_hash))) {
      errors.currentPassword = 'Current password is incorrect.';
    }
    if (Object.keys(errors).length) return res.status(400).json({ error: 'validation', fields: errors });
    const hash = await bcrypt.hash(values.newPassword, config.bcryptRounds);
    await db.run('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?', [
      hash,
      new Date().toISOString(),
      user.id,
    ]);
    auth.issueSession(res, await getById(user.id));
    return res.status(204).end();
  });

  return router;
}

module.exports = { authRouter };
