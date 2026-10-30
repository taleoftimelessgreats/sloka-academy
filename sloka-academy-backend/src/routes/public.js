'use strict';

const express = require('express');
const { validatePublicInquiry } = require('../validation');
const { RateLimiter } = require('../util');
const { createPublicCors } = require('../publicCors');

/**
 * POST /api/public/inquiries — called cross-origin by the static public website.
 */
function publicRouter({ config, repo, notifier, verifications }) {
  const router = express.Router();
  const { cors, preflight, rejectForeignOrigin, requireJson } = createPublicCors(config);
  const limiter = new RateLimiter(config.publicRateLimit);
  const jsonBody = express.json({ limit: '10kb', type: 'application/json', strict: true });

  router.options('/inquiries', cors, preflight);

  router.post('/inquiries', cors, rejectForeignOrigin, requireJson, jsonBody, async (req, res) => {
    const key = req.ip || 'unknown';
    if (limiter.isLimited(key)) {
      res.setHeader('Retry-After', String(limiter.retryAfterSeconds(key)));
      return res.status(429).json({ error: 'rate_limited' });
    }
    limiter.hit(key);

    const body = req.body === undefined ? {} : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'invalid_json' });
    }

    // Honeypot: pretend success, store nothing, notify nobody.
    const hp = body.website;
    if (hp !== undefined && hp !== null && hp !== false && String(hp).trim() !== '') {
      return res.status(201).json({ ok: true });
    }

    const { values, errors } = validatePublicInquiry(body);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'validation', fields: errors });

    const { id, verification } = await repo.create({ ...values, status: 'new' });
    try {
      notifier.inquiryCreated({ id, ...values });
    } catch (err) {
      console.error(`[notify] unexpected error: ${err.message}`);
    }
    // The email or number belongs to a profile with other details: the student confirms with a code.
    if (verification) return res.status(201).json({ ok: true, verification: await verifications.sendCode(verification.id) });
    return res.status(201).json({ ok: true });
  });

  return router;
}

module.exports = { publicRouter };
