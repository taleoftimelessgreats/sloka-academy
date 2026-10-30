'use strict';

/**
 * CORS for the public (website-facing) routes only: reflect allow-listed origins,
 * methods GET/POST/OPTIONS, header Content-Type, never credentials.
 */
function createPublicCors(config) {
  const allowed = new Set(config.allowedOrigins);

  function cors(req, res, next) {
    res.vary('Origin');
    const origin = req.headers.origin;
    req.originAllowed = !origin || allowed.has(origin);
    if (origin && allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    next();
  }

  function preflight(req, res) {
    if (req.headers.origin && req.originAllowed) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    res.status(204).end();
  }

  // For POSTs: a browser Origin that is present but not allow-listed is refused outright.
  function rejectForeignOrigin(req, res, next) {
    if (!req.originAllowed) return res.status(403).json({ error: 'origin_not_allowed' });
    return next();
  }

  function requireJson(req, res, next) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return res.status(415).json({ error: 'unsupported_media_type' });
    return next();
  }

  return { cors, preflight, rejectForeignOrigin, requireJson };
}

module.exports = { createPublicCors };
