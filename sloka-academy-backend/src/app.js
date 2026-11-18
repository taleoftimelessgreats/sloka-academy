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
const { associatesRouter } = require('./routes/associates');
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
const { createAudit } = require('./audit');
const { createRegistrationRepo, RegistrationError } = require('./registrationRepo');
const { createOfferTemplateRepo, createOfferLetters } = require('./offerLetters');
const { registrationsRouter } = require('./routes/registrations');
const { coursesRouter } = require('./routes/courses');
const { offerTemplatesRouter } = require('./routes/offerTemplates');
const { rolesRouter, auditRouter } = require('./routes/roles');

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' blob:", // certificate and offer letter previews (PDF)
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
  const audit = createAudit(db);
  const offerTemplates = createOfferTemplateRepo(db);
  const offerLetters = createOfferLetters({ db, config, templates: offerTemplates, settings, notifier });
  const registrations = createRegistrationRepo(db, config, { offerLetters, audit });
  app.locals.services = { delivery, sheetSync, studentRepo, templateRepo, certRepo, verifications, quota, audit, registrations, offerLetters, offerTemplates };

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

  // Labels for the portal: enumerations, roles, enquiry domains.
  app.get('/api/meta', auth.authenticate, async (req, res) => {
    const roles = await db.all('SELECT role_key, name FROM roles ORDER BY is_system DESC, created_at, name');
    res.json({
      ...C.meta(),
      roles: roles.map((r) => ({ id: r.role_key, label: r.name })),
      domains: await repo.distinctDomains(),
      today: localDate(),
      emailEnabled: delivery.enabled(), // whether offer letters and certificates can be emailed
    });
  });

  // Associate directory for assignee and BD Associate pickers and filters (any signed-in user; names only).
  // inScope: within the user's data scope (themselves, and for team scope everyone reporting to them).
  app.get('/api/staff', auth.authenticate, async (req, res) => {
    const [users, scopeIds] = await Promise.all([
      db.all('SELECT id, name, role, active, reporting_manager_id FROM users ORDER BY active DESC, name'),
      auth.scopeUserIds(req.user),
    ]);
    res.json({
      staff: users.map((u) => ({
        id: u.id, name: u.name, role: u.role, active: u.active === 1, reportingManagerId: u.reporting_manager_id, inScope: !scopeIds || scopeIds.includes(u.id),
      })),
      scope: req.user.scope,
    });
  });

  // The overview: each section only for those who may see it (registrations, enquiries and students within
  // their data scope).
  app.get('/api/stats', auth.authenticate, async (req, res) => {
    const today = localDate();
    const has = (p) => req.user.permissions.has(p);
    const out = { today };
    const jobs = [];
    const scopeIds = await auth.scopeUserIds(req.user);
    if (has('enquiries.view')) jobs.push(repo.stats(today, scopeIds).then((s) => Object.assign(out, s)));
    if (has('students.view')) {
      jobs.push(studentRepo.count(scopeIds).then((n) => (out.students = n)));
      jobs.push(verifications.openCount().then((n) => (out.pendingVerifications = n)));
    }
    if (has('certificates.view')) {
      jobs.push(certRepo.stats(today).then((c) => (out.certificates = c)));
      if (has('students.view')) jobs.push(certRepo.listRegs({ where: '', params: [], page: 1, pageSize: 8 }).then((r) => (out.recentRegistrations = r.items)));
    }
    if (has('sessions.view')) jobs.push(certRepo.listSessions().then((list) => (out.sessions = list.slice(0, 6))));
    if (has('registrations.view')) jobs.push(registrations.stats(scopeIds, today).then((r) => (out.registrations = r)));
    if (has('students.edit')) jobs.push(registrations.flags.openCount().then((n) => (out.openRegistrationFlags = n)));
    if (has('settings.view')) {
      jobs.push(
        Promise.all([sheetSync.status(), templateRepo.defaultId()]).then(async ([sheet, defaultId]) => {
          out.system = {
            emailEnabled: delivery.enabled(),
            emailDailyLimit: quota.limit,
            sheet: { configured: sheet.configured, pending: sheet.pending, lastSyncAt: sheet.lastSyncAt, lastError: sheet.lastError },
            defaultTemplate: defaultId ? (await templateRepo.get(defaultId)).name : null,
          };
        }),
      );
    }
    await Promise.all(jobs);
    res.json(out);
  });

  app.use('/api/inquiries', auth.authenticate, inquiriesRouter({ db, repo, auth, verifications, audit }));
  app.use('/api/students', auth.authenticate, studentsRouter({ studentRepo, auth, verifications, audit }));
  app.use('/api/verifications', auth.authenticate, verificationsRouter({ verifications, auth, audit }));
  app.use('/api/sessions', auth.authenticate, sessionsRouter({ config, certRepo, templateRepo, auth }));
  app.use('/api/certificates', auth.authenticate, certificatesRouter({ config, certRepo, delivery, auth, verifications, audit }));
  app.use('/api/templates', auth.authenticate, templatesRouter({ config, templateRepo, auth, audit }));
  app.use('/api/settings', auth.authenticate, auth.requirePermission('settings.view'), settingsRouter({ config, sheetSync, delivery, auth, audit }));
  app.use('/api/registrations', auth.authenticate, registrationsRouter({ db, auth, registrations, offerLetters }));
  app.use('/api/courses', auth.authenticate, coursesRouter({ db, auth, registrations, audit }));
  app.use('/api/offer-templates', auth.authenticate, offerTemplatesRouter({ config, auth, templates: offerTemplates, offerLetters, settings, audit }));
  app.use('/api/associates', auth.authenticate, associatesRouter({ db, config, auth, audit, notifier }));
  app.use('/api/roles', auth.authenticate, rolesRouter({ db, auth, audit }));
  app.use('/api/audit', auth.authenticate, auditRouter({ auth, audit }));

  // API only: the staff dashboard is part of the website (sloka-academy-frontend/public/admin).
  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) return res.status(err.status).json(err.body);
    if (err instanceof RegistrationError) return res.status(err.status).json(err.body || { error: 'validation', fields: err.fields });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    if (err.type === 'charset.unsupported' || err.type === 'encoding.unsupported') {
      return res.status(415).json({ error: 'unsupported_media_type' });
    }
    if (isDuplicate(err, 'uq_users_email')) {
      return res.status(400).json({ error: 'validation', fields: { email: 'An associate with this email already exists.' } });
    }
    if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'bad_request' });
    console.error('[error]', err);
    return res.status(500).json({ error: 'server_error' });
  });

  return app;
}

module.exports = { createApp };
