'use strict';

const express = require('express');
const { RateLimiter } = require('../util');
const { createPublicCors } = require('../publicCors');

const STATUS = { not_found: 404, wrong_code: 400, expired: 410, locked: 409, closed: 409, resend_limit: 409, too_soon: 429 };

/**
 * Website: the student confirms changed profile details with the code emailed to their profile's address.
 *   POST /api/public/profile-verifications/:token/verify  { code }
 *   POST /api/public/profile-verifications/:token/resend
 */
function publicVerificationRouter({ config, verifications }) {
  const router = express.Router();
  const { cors, preflight, rejectForeignOrigin, requireJson } = createPublicCors(config);
  const jsonBody = express.json({ limit: '2kb', type: 'application/json', strict: true });
  const limiter = new RateLimiter(config.verificationRateLimit);

  const limited = (req, res) => {
    const ip = req.ip || 'unknown';
    if (limiter.isLimited(ip)) {
      res.setHeader('Retry-After', String(limiter.retryAfterSeconds(ip)));
      res.status(429).json({ error: 'rate_limited' });
      return true;
    }
    limiter.hit(ip);
    return false;
  };
  const token = (req) => (/^[0-9a-f]{32}$/.test(req.params.token) ? req.params.token : null);
  const fail = (res, result) => res.status(STATUS[result.error] || 400).json(result);

  for (const p of ['/profile-verifications/:token/verify', '/profile-verifications/:token/resend']) {
    router.options(p, cors, preflight);
  }

  router.post('/profile-verifications/:token/verify', cors, rejectForeignOrigin, requireJson, jsonBody, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (limited(req, res)) return undefined;
    if (!token(req)) return res.status(404).json({ error: 'not_found' });
    const code = req.body && typeof req.body.code === 'string' ? req.body.code.replace(/\s+/g, '') : '';
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'validation', fields: { code: 'Enter the 6-digit code from the email.' } });
    const result = await verifications.verify(token(req), code);
    return result.error ? fail(res, result) : res.json(result);
  });

  router.post('/profile-verifications/:token/resend', cors, rejectForeignOrigin, requireJson, jsonBody, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (limited(req, res)) return undefined;
    if (!token(req)) return res.status(404).json({ error: 'not_found' });
    const result = await verifications.resend(token(req));
    if (result.retryAfter) res.setHeader('Retry-After', String(result.retryAfter));
    return result.error ? fail(res, result) : res.json(result);
  });

  return router;
}

module.exports = { publicVerificationRouter };
