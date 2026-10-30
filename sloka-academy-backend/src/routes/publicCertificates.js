'use strict';

const express = require('express');
const { RateLimiter } = require('../util');
const { createPublicCors } = require('../publicCors');
const { validateCertificateRegistration, SESSION_CLOSED_MSG, WRONG_CODE_MSG } = require('../validation');
const { codesMatch, normalizeCertificateId, tokenMatches } = require('../certIds');
const { downloadPath } = require('../certificateDelivery');
const { isDuplicate } = require('../db');

const NOT_FOUND_TEXT = 'Certificate not found, or this download link is no longer valid. Request a new link from Sloka Academy.';
const REVOKED_TEXT = 'This certificate has been revoked by Sloka Academy. If you think this is a mistake, please contact us.';

/**
 * Website-facing certificate routes (cross-origin, same CORS policy as the enquiry form):
 *   GET  /api/public/sessions
 *   POST /api/public/certificate-registrations
 *   GET  /api/public/certificates/:id/verify
 *   GET  /api/public/certificates/:id/pdf?token=...
 */
function publicCertificatesRouter({ config, certRepo, delivery, sheetSync, verifications, quota = null }) {
  const router = express.Router();
  const { cors, preflight, rejectForeignOrigin, requireJson } = createPublicCors(config);
  const jsonBody = express.json({ limit: '10kb', type: 'application/json', strict: true });
  const registerLimiter = new RateLimiter(config.certRegisterRateLimit);
  const codeFailLimiter = new RateLimiter(config.certCodeFailLimit);
  const verifyLimiter = new RateLimiter(config.certVerifyRateLimit);
  const pdfLimiter = new RateLimiter(config.certPdfRateLimit);

  const limited = (limiter, key, res, asText = false) => {
    if (!limiter.isLimited(key)) return false;
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds(key)));
    if (asText) res.status(429).type('text/plain').send('Too many requests. Please try again in a few minutes.');
    else res.status(429).json({ error: 'rate_limited' });
    return true;
  };

  for (const p of ['/sessions', '/certificate-registrations', '/certificates/:id/verify', '/certificates/:id/pdf']) {
    router.options(p, cors, preflight);
  }

  router.get('/sessions', cors, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ sessions: await certRepo.publicSessions() });
  });

  router.post('/certificate-registrations', cors, rejectForeignOrigin, requireJson, jsonBody, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ip = req.ip || 'unknown';
    if (limited(registerLimiter, ip, res) || limited(codeFailLimiter, ip, res)) return undefined;
    registerLimiter.hit(ip);

    const body = req.body === undefined ? {} : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'invalid_json' });

    // Honeypot: generic success, nothing stored, nothing sent.
    const hp = body.website;
    if (hp !== undefined && hp !== null && hp !== false && String(hp).trim() !== '') {
      return res.status(201).json({ ok: true });
    }

    const { values, errors } = validateCertificateRegistration(body);
    let session = null;
    if (!errors.sessionId) {
      session = await certRepo.openSessionRow(values.sessionId);
      if (!session) errors.sessionId = SESSION_CLOSED_MSG;
    }
    if (session && !errors.code && !codesMatch(values.code, session.code)) {
      errors.code = WRONG_CODE_MSG;
      codeFailLimiter.hit(ip);
    }
    if (Object.keys(errors).length) return res.status(400).json({ error: 'validation', fields: errors });

    const existing = await certRepo.findExistingRegistration(session.id, values.email, values.phone);
    if (existing) return alreadyRegistered(existing, res);

    let issued;
    try {
      issued = await certRepo.register(session.id, values);
    } catch (err) {
      // The same email registered for this session at the same moment.
      if (isDuplicate(err, 'uq_certreg_session_email')) {
        return alreadyRegistered(await certRepo.findBySessionEmail(session.id, values.email), res);
      }
      throw err;
    }
    const { row, token } = issued;
    // The email or number belongs to a profile with other details: the student confirms with a code
    // (sent before the certificate, so it is not held back by the PDF).
    const verification = issued.verification ? await verifications.sendCode(issued.verification.id) : undefined;
    // Email the PDF and copy the registration to the Google Sheet in the background.
    delivery.deliver(row.id, { token });
    sheetSync.schedule();
    return res.status(201).json({
      verification,
      certificate: {
        id: row.certificate_id,
        name: row.name,
        sessionTitle: row.session_title,
        sessionDate: row.session_date,
        issuedAt: row.issued_at,
        downloadPath: downloadPath(row.certificate_id, token),
        studentId: row.student_code ?? null,
      },
      emailing: delivery.enabled(),
    });
  });

  // Never reveals the existing certificate. If email is configured, the student is sent the certificate
  // again at the address on file (with a fresh link), at most once per cooldown window and only while
  // that address is under its daily email limit.
  async function alreadyRegistered(existing, res) {
    let emailed = false;
    if (existing && existing.status === 'issued' && delivery.enabled() && (!quota || (await quota.remaining(existing.email)) > 0)) {
      const last = await certRepo.lastEventAt(existing.id, 'emailed');
      emailed = true;
      const sending = existing.email_status === 'pending';
      if (!sending && (!last || Date.now() - Date.parse(last) >= config.certResendCooldownMs)) {
        delivery.deliver(existing.id, { resent: true });
      }
    }
    return res.status(409).json({ error: 'already_registered', emailed });
  }

  router.get('/certificates/:id/verify', cors, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (limited(verifyLimiter, req.ip || 'unknown', res)) return undefined;
    verifyLimiter.hit(req.ip || 'unknown');
    const row = await certRepo.findByCertificateId(normalizeCertificateId(req.params.id));
    if (!row) return res.status(404).json({ error: 'not_found' });
    return res.json({
      id: row.certificate_id,
      status: row.status === 'revoked' ? 'revoked' : 'valid',
      name: row.name,
      sessionTitle: row.session_title,
      sessionDate: row.session_date,
      issuedAt: row.issued_at,
    });
  });

  router.get('/certificates/:id/pdf', cors, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ip = req.ip || 'unknown';
    if (limited(pdfLimiter, ip, res, true)) return undefined;
    pdfLimiter.hit(ip);
    const row = await certRepo.findByCertificateId(normalizeCertificateId(req.params.id));
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!tokenMatches(token, row ? row.download_token_hash : null) || !row) {
      return res.status(404).type('text/plain').send(NOT_FOUND_TEXT);
    }
    if (row.status === 'revoked') return res.status(410).type('text/plain').send(REVOKED_TEXT);
    const pdf = await delivery.render(row);
    await certRepo.recordDownload(row.id, row.download_count);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Sloka-Academy-Certificate-${row.certificate_id}.pdf"`);
    return res.send(pdf);
  });

  return router;
}

module.exports = { publicCertificatesRouter, downloadPath };
