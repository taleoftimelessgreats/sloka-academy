'use strict';

const express = require('express');
const C = require('../constants');
const { parseRegFilters } = require('../certificateRepo');
const { validateCertCorrection, validateRevoke } = require('../validation');
const { verifyLink } = require('../certificatePdf');
const { toCsv, nationalPhone } = require('../csv');
const { localDate, localDateTime, validationError, HttpError } = require('../util');

const hasErrors = (o) => Object.keys(o).length > 0;

function parseId(raw) {
  if (!/^\d{1,12}$/.test(String(raw))) throw new HttpError(404, { error: 'not_found' });
  return Number(raw);
}

const EMAIL_LABELS = { pending: 'Sending', sent: 'Sent', failed: 'Failed', off: 'Email not set up' };

/** Send registrations as an Excel-friendly CSV (formula-escaped, phone as 10-digit national number). */
function certificatesCsv(res, rows, filename) {
  const header = [
    'Certificate ID', 'Status', 'Name', 'Email', 'Phone', 'College', 'Stream', 'Year of study', 'Session', 'Session date',
    'Venue', 'Mode', 'Issued at', 'Consent at', 'Certificate email', 'Downloads', 'Last downloaded', 'Revoked reason', 'Student ID',
  ];
  const data = rows.map((r) => [
    r.certificateId,
    r.status === 'revoked' ? 'Revoked' : 'Issued',
    r.name,
    r.email,
    nationalPhone(r.phone),
    r.college,
    C.label('stream', r.stream),
    C.label('yearOfStudy', r.yearOfStudy),
    r.session.title,
    r.session.sessionDate,
    r.session.venue,
    r.session.mode === 'online' ? 'Online' : 'In person',
    localDateTime(r.issuedAt),
    localDateTime(r.consentAt),
    EMAIL_LABELS[r.emailStatus] || '',
    r.downloadCount,
    localDateTime(r.lastDownloadedAt),
    r.revokedReason,
    r.studentCode,
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(header, data));
}

/** Staff: certificate registrations. Everyone views/searches/downloads/resends; managers and admins manage. */
function certificatesRouter({ config, certRepo, delivery, auth, verifications }) {
  const router = express.Router();
  const manage = auth.requirePermission('manage');
  const canEmail = () => delivery.enabled();

  async function load(id) {
    const r = await certRepo.getReg(id);
    if (!r) throw new HttpError(404, { error: 'not_found' });
    return r;
  }
  const detail = async (id) => {
    const [certificate, events, verification] = await Promise.all([load(id), certRepo.events(id), verifications.forRecord({ registrationId: id })]);
    return { certificate, events, verification, verifyUrl: verifyLink(config.certVerifyUrl, certificate.certificateId), emailEnabled: canEmail() };
  };

  function filtersOrThrow(query) {
    const f = parseRegFilters(query);
    if (hasErrors(f.errors)) throw validationError(f.errors);
    return f;
  }

  router.get('/', async (req, res) => {
    res.json(await certRepo.listRegs(filtersOrThrow(req.query)));
  });

  router.get('/export', auth.requirePermission('export'), async (req, res) => {
    certificatesCsv(res, await certRepo.exportRegs(filtersOrThrow(req.query)), `sloka-certificates-${localDate()}.csv`);
  });

  // Try again for every valid certificate whose email failed. Runs in the background.
  router.post('/retry-emails', manage, async (req, res) => {
    if (!canEmail()) return res.status(400).json({ error: 'email_not_configured', message: 'Email is not configured on the server.' });
    const ids = (await certRepo.exportRegs(filtersOrThrow({ emailStatus: 'failed', status: 'issued' }))).map((r) => r.id);
    (async () => {
      for (const id of ids) await delivery.deliver(id, { actorId: req.user.id });
    })();
    return res.status(202).json({ queued: ids.length });
  });

  router.get('/:id', async (req, res) => {
    res.json(await detail(parseId(req.params.id)));
  });

  // Staff copy of the PDF (does not count as a student download). Revoked ones are watermarked.
  router.get('/:id/pdf', async (req, res) => {
    const id = parseId(req.params.id);
    const r = await load(id);
    const pdf = await delivery.render(await certRepo.getRegRow(id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Sloka-Academy-Certificate-${r.certificateId}.pdf"`);
    res.send(pdf);
  });

  // Email the certificate PDF again, with a fresh download link (the old link stops working).
  router.post('/:id/resend', async (req, res) => {
    const id = parseId(req.params.id);
    const r = await load(id);
    if (!canEmail()) return res.status(400).json({ error: 'email_not_configured', message: 'Email is not configured on the server.' });
    if (r.status === 'revoked') return res.status(409).json({ error: 'revoked', message: 'Reinstate the certificate before sending it.' });
    const result = await delivery.deliver(id, { actorId: req.user.id, resent: true });
    return res.json({ ...(await detail(id)), result });
  });

  // Correct the printed name and/or the email address the certificate is sent to.
  router.patch('/:id', auth.requirePermission('editRecords'), async (req, res) => {
    const id = parseId(req.params.id);
    await load(id);
    const { values, errors } = validateCertCorrection(req.body);
    if (hasErrors(errors)) throw validationError(errors);
    const result = await certRepo.correctDetails(id, values, req.user.id);
    if (result === 'email_taken') throw validationError({ email: 'Another registration for this session already uses this email.' });
    res.json(await detail(id));
  });

  router.post('/:id/revoke', manage, async (req, res) => {
    const id = parseId(req.params.id);
    await load(id);
    const { values, errors } = validateRevoke(req.body);
    if (hasErrors(errors)) throw validationError(errors);
    await certRepo.revoke(id, values.reason, req.user.id);
    res.json(await detail(id));
  });

  router.post('/:id/reinstate', manage, async (req, res) => {
    const id = parseId(req.params.id);
    await load(id);
    await certRepo.reinstate(id, req.user.id);
    res.json(await detail(id));
  });

  // Permanent erasure on request: registration + its activity log.
  router.delete('/:id', auth.requirePermission('deleteRecords'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await certRepo.deleteReg(id))) throw new HttpError(404, { error: 'not_found' });
    console.log(`[audit] certificate registration #${id} permanently deleted by user #${req.user.id}`);
    res.status(204).end();
  });

  return router;
}

module.exports = { certificatesRouter, certificatesCsv };
