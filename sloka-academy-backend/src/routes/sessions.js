'use strict';

const express = require('express');
const { validateSession } = require('../validation');
const { generateSessionCode } = require('../certIds');
const { parseRegFilters } = require('../certificateRepo');
const { validationError, HttpError } = require('../util');
const { certificatesCsv } = require('./certificates');

const hasErrors = (o) => Object.keys(o).length > 0;

function parseId(raw) {
  if (!/^\d{1,12}$/.test(String(raw))) throw new HttpError(404, { error: 'not_found' });
  return Number(raw);
}

/** Staff: career guidance sessions. Counsellors read; managers and admins manage. */
function sessionsRouter({ config, certRepo, templateRepo, auth }) {
  const router = express.Router();
  const manage = auth.requirePermission('manage');

  // A session may pick an uploaded design; archived ones can only be kept, not newly chosen.
  async function checkTemplate(values, errors, currentId = null) {
    if (!values.templateId || values.templateId === currentId) return;
    const t = await templateRepo.get(values.templateId);
    if (!t || t.archived) errors.templateId = 'Choose an available certificate design.';
  }
  const withLink = (s) => s && { ...s, studentLink: `${config.siteUrl}/certificate/?session=${s.id}` };

  async function load(id) {
    const s = await certRepo.getSession(id);
    if (!s) throw new HttpError(404, { error: 'not_found' });
    return s;
  }

  router.get('/', async (req, res) => {
    res.json({ sessions: (await certRepo.listSessions()).map(withLink) });
  });

  router.post('/', manage, async (req, res) => {
    const { values, errors } = validateSession(req.body);
    if (values.mode === 'in-person' && !values.venue && !errors.venue) errors.venue = 'Venue is required for in-person sessions.';
    await checkTemplate(values, errors);
    if (hasErrors(errors)) throw validationError(errors);
    res.status(201).json({ session: withLink(await certRepo.createSession(values, req.user.id)) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ session: withLink(await load(parseId(req.params.id))) });
  });

  router.patch('/:id', manage, async (req, res) => {
    const id = parseId(req.params.id);
    const current = await load(id);
    const { values, errors } = validateSession(req.body, { partial: true });
    if (values.code === null) delete values.code; // blank = keep the current code
    const mode = values.mode ?? current.mode;
    const venue = values.venue !== undefined ? values.venue : current.venue;
    if (mode === 'in-person' && !venue && !errors.venue) errors.venue = 'Venue is required for in-person sessions.';
    await checkTemplate(values, errors, current.templateId);
    if (hasErrors(errors)) throw validationError(errors);
    res.json({ session: withLink(await certRepo.updateSession(id, values)) });
  });

  router.post('/:id/regenerate-code', manage, async (req, res) => {
    const id = parseId(req.params.id);
    await load(id);
    res.json({ session: withLink(await certRepo.updateSession(id, { code: generateSessionCode() })) });
  });

  // Only sessions without registrations can be deleted (certificates must stay verifiable).
  router.delete('/:id', auth.requirePermission('deleteRecords'), async (req, res) => {
    const result = await certRepo.deleteSession(parseId(req.params.id));
    if (result === 'not_found') throw new HttpError(404, { error: 'not_found' });
    if (result === 'has_registrations') {
      return res.status(409).json({ error: 'has_registrations', message: 'This session has registrations and cannot be deleted. Close registration instead.' });
    }
    return res.status(204).end();
  });

  router.get('/:id/export', auth.requirePermission('export'), async (req, res) => {
    const s = await load(parseId(req.params.id));
    const f = parseRegFilters({ sessionId: String(s.id) });
    const slug = s.sessionDate;
    certificatesCsv(res, await certRepo.exportRegs(f), `sloka-session-${s.id}-${slug}-certificates.csv`);
  });

  return router;
}

module.exports = { sessionsRouter };
