'use strict';

const jwt = require('jsonwebtoken');
const { PERMISSIONS, can } = require('./constants');

const ISSUER = 'sloka-dashboard';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key || key in out) continue;
    const raw = part.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

function createAuth({ db, config }) {
  // __Host- prefix (requires Secure, Path=/, no Domain) when served over HTTPS in production.
  const cookieName = config.production ? '__Host-sloka_session' : 'sloka_session';
  const maxAgeMs = config.sessionHours * 60 * 60 * 1000;
  const cookieOpts = { httpOnly: true, sameSite: 'strict', secure: config.production, path: '/' };
  const getUser = (id) => db.get('SELECT id, name, email, role, active, token_version FROM users WHERE id = ?', [id]);

  function issueSession(res, user) {
    const token = jwt.sign({ sub: String(user.id), tv: user.token_version }, config.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: `${config.sessionHours}h`,
      issuer: ISSUER,
    });
    res.cookie(cookieName, token, { ...cookieOpts, maxAge: maxAgeMs });
  }

  function clearSession(res) {
    res.clearCookie(cookieName, cookieOpts);
  }

  // Verifies the JWT, then re-loads the user so deactivation / role changes / password resets apply immediately.
  async function authenticate(req, res, next) {
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: ISSUER });
    } catch {
      clearSession(res);
      return res.status(401).json({ error: 'unauthorized' });
    }
    const user = /^\d+$/.test(String(payload.sub)) ? await getUser(Number(payload.sub)) : undefined;
    if (!user || user.active !== 1 || user.token_version !== payload.tv) {
      clearSession(res);
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    return next();
  }

  // `permission` is a key of PERMISSIONS in constants.js.
  function requirePermission(permission) {
    if (!Object.hasOwn(PERMISSIONS, permission)) throw new Error(`unknown permission ${permission}`);
    return (req, res, next) => (req.user && can(req.user.role, permission) ? next() : res.status(403).json({ error: 'forbidden' }));
  }

  // CSRF defence for the cookie-authenticated staff API (in addition to SameSite=Strict, which does not
  // protect against sibling subdomains). Unsafe methods must come from the dashboard's own origin.
  let dashboardOrigin = null;
  try {
    dashboardOrigin = new URL(config.dashboardUrl).origin;
  } catch {
    dashboardOrigin = null;
  }
  function sameOriginOnly(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const site = req.headers['sec-fetch-site'];
    if (site) {
      return site === 'same-origin' || site === 'none' ? next() : res.status(403).json({ error: 'cross_site_request' });
    }
    const origin = req.headers.origin;
    if (!origin) return next(); // non-browser client; still needs a valid session cookie
    let originUrl;
    try {
      originUrl = new URL(origin);
    } catch {
      return res.status(403).json({ error: 'cross_site_request' });
    }
    const ok = originUrl.host === req.headers.host || originUrl.host === req.host || originUrl.origin === dashboardOrigin;
    return ok ? next() : res.status(403).json({ error: 'cross_site_request' });
  }

  return { cookieName, issueSession, clearSession, authenticate, requirePermission, sameOriginOnly };
}

module.exports = { createAuth, parseCookies };
