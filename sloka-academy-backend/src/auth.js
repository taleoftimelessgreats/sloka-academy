'use strict';

const jwt = require('jsonwebtoken');
const { SUPER_ADMIN, effectivePermissions, isPermission } = require('./permissions');

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
  const getUser = (id) => db.get('SELECT id, name, email, role, active, token_version, must_change_password FROM users WHERE id = ?', [id]);

  /**
   * What a user may do: their role's permissions with their own overrides, and the role's data scope.
   * Read on every request, so changes to roles and overrides apply at once.
   */
  async function access(user) {
    const [rows, overrides, role] = await Promise.all([
      db.all('SELECT permission FROM role_permissions WHERE role_key = ?', [user.role]),
      db.all('SELECT permission, granted FROM user_permission_overrides WHERE user_id = ?', [user.id]),
      db.get('SELECT name, scope FROM roles WHERE role_key = ?', [user.role]),
    ]);
    const permissions = effectivePermissions(
      user.role,
      rows.map((r) => r.permission),
      Object.fromEntries(overrides.map((o) => [o.permission, o.granted === 1])),
    );
    return {
      permissions,
      scope: user.role === SUPER_ADMIN ? 'all' : role ? role.scope : 'own',
      roleName: role ? role.name : user.role,
    };
  }

  /** The signed-in user as req.user: id, name, email, role, roleName, permissions (Set), scope, mustChangePassword. */
  async function sessionUser(user) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.must_change_password === 1,
      ...(await access(user)),
    };
  }

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
    req.user = await sessionUser(user);
    // A temporary password (new associate, or reset by an admin) must be changed before anything else.
    if (req.user.mustChangePassword && !req.originalUrl.startsWith('/api/auth/')) {
      return res.status(403).json({ error: 'password_change_required' });
    }
    return next();
  }

  // Middleware: the signed-in user needs `permission` ('<module>.<action>', see permissions.js).
  function requirePermission(permission) {
    if (!isPermission(permission)) throw new Error(`unknown permission ${permission}`);
    return (req, res, next) => (req.user && req.user.permissions.has(permission) ? next() : res.status(403).json({ error: 'forbidden' }));
  }

  // Middleware: any one of the permissions will do.
  function requireAny(...permissions) {
    for (const p of permissions) if (!isPermission(p)) throw new Error(`unknown permission ${p}`);
    return (req, res, next) => (req.user && permissions.some((p) => req.user.permissions.has(p)) ? next() : res.status(403).json({ error: 'forbidden' }));
  }

  /**
   * The associates whose records the user's data scope covers: null for every record (scope 'all'),
   * otherwise their own id, plus (scope 'team') everyone who reports to them, directly or indirectly.
   */
  async function scopeUserIds(user) {
    if (user.scope === 'all') return null;
    const ids = new Set([user.id]);
    if (user.scope === 'team') {
      let frontier = [user.id];
      while (frontier.length && ids.size < 10000) {
        const rows = await db.all('SELECT id FROM users WHERE reporting_manager_id IN (?)', [frontier]);
        frontier = rows.map((r) => r.id).filter((id) => !ids.has(id));
        for (const id of frontier) ids.add(id);
      }
    }
    return [...ids];
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

  return { cookieName, issueSession, clearSession, authenticate, requirePermission, requireAny, scopeUserIds, sessionUser, sameOriginOnly };
}

module.exports = { createAuth };
