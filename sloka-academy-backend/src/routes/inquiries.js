'use strict';

const express = require('express');
const C = require('../constants');
const { parseFilters } = require('../inquiryRepo');
const { validateManualInquiry, validateInquiryUpdate, validateNote } = require('../validation');
const { toCsv, nationalPhone } = require('../csv');
const { localDate, localDateTime, validationError, HttpError } = require('../util');

const hasErrors = (o) => Object.keys(o).length > 0;

function parseId(raw) {
  if (!/^\d{1,12}$/.test(String(raw))) throw new HttpError(404, { error: 'not_found' });
  return Number(raw);
}

function inquiriesRouter({ db, repo, auth, verifications }) {
  const router = express.Router();

  async function checkAssignee(values, errors) {
    if (values.assignedTo != null && !errors.assignedTo) {
      const user = await db.get('SELECT id FROM users WHERE id = ? AND active = 1', [values.assignedTo]);
      if (!user) errors.assignedTo = 'Choose an active staff member.';
    }
  }

  function filtersOrThrow(req) {
    const f = parseFilters(req.query, { userId: req.user.id, today: localDate() });
    if (hasErrors(f.errors)) throw validationError(f.errors);
    return f;
  }

  router.get('/', async (req, res) => {
    res.json(await repo.list(filtersOrThrow(req)));
  });

  // Spreadsheet export (admins); respects the same filters as the list (no pagination).
  router.get('/export', auth.requirePermission('export'), async (req, res) => {
    const filters = filtersOrThrow(req);
    const { rows, notesByInquiry } = await repo.exportRows(filters);
    const header = [
      'ID', 'Created at', 'Name', 'Phone', 'Email', 'College', 'Stream', 'Year of study', 'Domain', 'Plan',
      'Source', 'Brochure', 'Message', 'Status', 'Assigned counsellor', 'Next follow-up', 'Consent at',
      'Created by', 'Updated at', 'Notes', 'Student ID', 'Referred by',
    ];
    const data = rows.map((r) => [
      r.id,
      localDateTime(r.createdAt),
      r.name,
      nationalPhone(r.phone),
      r.email,
      r.college,
      C.label('stream', r.stream),
      C.label('yearOfStudy', r.yearOfStudy),
      r.domain,
      C.label('plan', r.plan),
      C.label('source', r.source),
      r.brochure,
      r.message,
      C.label('status', r.status),
      r.assignedTo ? r.assignedTo.name : '',
      r.nextFollowUp,
      localDateTime(r.consentAt),
      r.createdBy ? r.createdBy.name : r.source === 'referral' ? 'Refer a friend' : 'Website form',
      localDateTime(r.updatedAt),
      (notesByInquiry.get(r.id) || [])
        .map((n) => `[${localDateTime(n.created_at)}] ${n.author_name || 'Unknown'}${n.kind === 'change' ? ' (change)' : ''}: ${n.body}`)
        .join('\n'),
      r.studentCode,
      r.referredBy ? `${r.referredBy.name} (${r.referredBy.certificateId})` : '',
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sloka-enquiries-${localDate()}.csv"`);
    res.send(toCsv(header, data));
  });

  // Manual enquiry (phone call / walk-in) entered by staff.
  router.post('/', async (req, res) => {
    const { values, errors } = validateManualInquiry(req.body);
    await checkAssignee(values, errors);
    if (hasErrors(errors)) throw validationError(errors);
    const { id } = await repo.create(values, { createdBy: req.user.id });
    const [inquiry, notes, verification] = await Promise.all([repo.get(id), repo.notes(id), verifications.forRecord({ inquiryId: id })]);
    res.status(201).json({ inquiry, notes, verification });
  });

  router.get('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const [inquiry, notes, verification] = await Promise.all([repo.get(id), repo.notes(id), verifications.forRecord({ inquiryId: id })]);
    if (!inquiry) throw new HttpError(404, { error: 'not_found' });
    res.json({ inquiry, notes, verification });
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const { values, errors } = validateInquiryUpdate(req.body);
    await checkAssignee(values, errors);
    if (hasErrors(errors)) throw validationError(errors);
    const updated = await repo.update(id, values, {
      userId: req.user.id,
      assigneeName: async (uid) => ((await db.get('SELECT name FROM users WHERE id = ?', [uid])) || { name: `#${uid}` }).name,
    });
    if (!updated) throw new HttpError(404, { error: 'not_found' });
    const [notes, verification] = await Promise.all([repo.notes(id), verifications.forRecord({ inquiryId: id })]);
    res.json({ inquiry: updated, notes, verification });
  });

  // Notes are append-only: there is no edit or delete endpoint.
  router.post('/:id/notes', async (req, res) => {
    const id = parseId(req.params.id);
    const { values, errors } = validateNote(req.body);
    if (hasErrors(errors)) throw validationError(errors);
    if (!(await repo.get(id))) throw new HttpError(404, { error: 'not_found' });
    res.status(201).json({ note: await repo.addNote(id, values.body, req.user.id) });
  });

  // Permanent erasure on request (enquiry + all notes). Admin only.
  router.delete('/:id', auth.requirePermission('deleteRecords'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await repo.remove(id))) throw new HttpError(404, { error: 'not_found' });
    console.log(`[audit] enquiry #${id} permanently deleted by user #${req.user.id}`);
    res.status(204).end();
  });

  return router;
}

module.exports = { inquiriesRouter };
