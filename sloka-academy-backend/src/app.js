'use strict';

const express = require('express');
const C = require('./constants');
const { createAuth } = require('./auth');
const { createInquiryRepo } = require('./inquiryRepo');
const { createNotifier } = require('./notify');
const { HttpError, localDate } = require('./util');
const { publicRouter } = require('./routes/public');
const { authRouter } = require('./routes/auth');
const { inquiriesRouter } = require('./routes/inquiries');
const { usersRouter } = require('./routes/users');
const { createCertificateRepo } = require('./certificateRepo');
const { publicCertificatesRouter } = require('./routes/publicCertificates');
const { sessionsRouter } = require('./routes/sessions');
const { certificatesRouter } = require('./routes/certificates');
const { createStudentRepo } = require('./studentRepo');
const { isDuplicate } = require('./db');
const { studentsRouter } = require('./routes/students');
const { createTemplateRepo } = require('./certificateTemplates');
const { templatesRouter } = require('./routes/templates');
const { createCertificateDelivery } = require('./certificateDelivery');
const { createSheetSync, createSettings } = require('./sheetSync');
const { settingsRouter } = require('./routes/settings');
const { createEmailQuota } = require('./emailQuota');
const { createProfileVerification } = require('./profileVerification');
const { verificationsRouter } = require('./routes/verifications');
const { publicVerificationRouter } = require('./routes/publicVerification');

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' blob:", // certificate template preview (PDF)
  "font-src 'self'",
  "manifest-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Build the Express app. `db` is an open, migrated database from db.js's openDatabase().
 * `notifier` is optional (tests pass one built with a fake mail transport, or a fake); when given, it
 * must enforce `emailQuota` itself. `sheetsFetch` replaces fetch for Google Sheets calls in tests.
 */
/**
 * background: receives promises for work that continues after a response has been sent (emails,
 * Sheets sync). A long-running server can ignore them; serverless.js passes Vercel's waitUntil.
 */
function createApp({ db, config, notifier, emailQuota, sheetsFetch, background = null } = {}) {
  if (!db) throw new Error('createApp: db is required');
  if (!config || typeof config.jwtSecret !== 'string' || config.jwtSecret.length < 32) {
    throw new Error('createApp: config.jwtSecret must be at least 32 characters');
  }
  // Every email the server sends counts towards the recipient's daily limit.
  const quota = emailQuota || createEmailQuota(db, { limit: config.emailDailyLimit });
  notifier = notifier || createNotifier(config, { quota, background });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ?? false);
  app.set('query parser', 'simple');

  const auth = createAuth({ db, config });
  const repo = createInquiryRepo(db, config);
  const certRepo = createCertificateRepo(db, config);
  const studentRepo = createStudentRepo(db, config);
  const templateRepo = createTemplateRepo(db);
  const delivery = createCertificateDelivery({ config, certRepo, templateRepo, notifier, background });
  const settings = createSettings(db);
  const sheetSync = createSheetSync({ db, config, settings, fetchImpl: sheetsFetch, background });
  const verifications = createProfileVerification({ db, config, notifier, quota });
  app.locals.services = { delivery, sheetSync, studentRepo, templateRepo, certRepo, verifications, quota };

  // Security headers on every response (no helmet dependency needed).
  app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (!req.path.startsWith('/api/public/')) res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });

  // Public, cross-origin endpoint (has its own CORS, body limit and rate limit).
  app.use('/api/public', publicRouter({ config, repo, notifier, verifications }));
  app.use('/api/public', publicCertificatesRouter({ config, certRepo, delivery, sheetSync, verifications, quota }));
  app.use('/api/public', publicVerificationRouter({ config, verifications }));

  // Staff API: same-origin only, never cached, JSON bodies.
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', auth.sameOriginOnly);
  app.use('/api', express.json({ limit: '100kb', type: 'application/json' }));

  app.use('/api/auth', authRouter({ db, config, auth }));

  app.get('/api/meta', auth.authenticate, async (req, res) => {
    res.json({ ...C.meta(), domains: await repo.distinctDomains(), today: localDate() });
  });

  // Staff directory for assignee pickers/filters (any signed-in user).
  app.get('/api/staff', auth.authenticate, async (req, res) => {
    const users = await db.all('SELECT id, name, role, active FROM users ORDER BY active DESC, name');
    res.json({ staff: users.map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active === 1 })) });
  });

  app.get('/api/stats', auth.authenticate, async (req, res) => {
    const today = localDate();
    const [inquiryStats, students, certificates, sessions, recent, sheet, defaultId, pendingVerifications] = await Promise.all([
      repo.stats(today),
      studentRepo.count(),
      certRepo.stats(today),
      certRepo.listSessions(),
      certRepo.listRegs({ where: '', params: [], page: 1, pageSize: 8 }),
      sheetSync.status(),
      templateRepo.defaultId(),
      verifications.openCount(),
    ]);
    res.json({
      ...inquiryStats,
      students,
      pendingVerifications,
      certificates,
      sessions: sessions.slice(0, 6),
      recentRegistrations: recent.items,
      system: {
        emailEnabled: delivery.enabled(),
        emailDailyLimit: quota.limit,
        sheet: {
          connected: sheet.connected,
          configured: Boolean(sheet.sheetId),
          pending: sheet.pending,
          lastSyncAt: sheet.lastSyncAt,
          lastError: sheet.lastError,
        },
        defaultTemplate: defaultId ? (await templateRepo.get(defaultId)).name : null,
      },
    });
  });

  app.use('/api/inquiries', auth.authenticate, inquiriesRouter({ db, repo, auth, verifications }));
  app.use('/api/students', auth.authenticate, studentsRouter({ studentRepo, auth, verifications }));
  app.use('/api/verifications', auth.authenticate, verificationsRouter({ verifications, auth }));
  app.use('/api/sessions', auth.authenticate, sessionsRouter({ config, certRepo, templateRepo, auth }));
  app.use('/api/certificates', auth.authenticate, certificatesRouter({ config, certRepo, delivery, auth, verifications }));
  app.use('/api/templates', auth.authenticate, templatesRouter({ config, templateRepo, auth }));
  app.use('/api/settings', auth.authenticate, auth.requirePermission('manage'), settingsRouter({ config, sheetSync, delivery, auth }));
  app.use('/api/users', auth.authenticate, auth.requirePermission('manage'), usersRouter({ db, config, auth }));

  // API only: the staff dashboard is part of the website (sloka-academy-frontend/public/admin).
  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) return res.status(err.status).json(err.body);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    if (err.type === 'charset.unsupported' || err.type === 'encoding.unsupported') {
      return res.status(415).json({ error: 'unsupported_media_type' });
    }
    if (isDuplicate(err, 'uq_users_email')) {
      return res.status(400).json({ error: 'validation', fields: { email: 'A user with this email already exists.' } });
    }
    if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'bad_request' });
    console.error('[error]', err);
    return res.status(500).json({ error: 'server_error' });
  });

  return app;
}

module.exports = { createApp };
