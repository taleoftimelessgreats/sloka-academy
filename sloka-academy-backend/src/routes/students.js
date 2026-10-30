'use strict';

const express = require('express');
const C = require('../constants');
const { parseStudentFilters } = require('../studentRepo');
const { validateStudentUpdate } = require('../validation');
const { toCsv, nationalPhone } = require('../csv');
const { localDate, localDateTime, validationError, HttpError } = require('../util');

const hasErrors = (o) => Object.keys(o).length > 0;

function parseId(raw) {
  if (!/^\d{1,12}$/.test(String(raw))) throw new HttpError(404, { error: 'not_found' });
  return Number(raw);
}

/** Staff: the master student database (career guidance + internship). Everyone reads; admins export/edit/erase. */
function studentsRouter({ studentRepo, auth, verifications }) {
  const router = express.Router();

  function filtersOrThrow(query) {
    const f = parseStudentFilters(query);
    if (hasErrors(f.errors)) throw validationError(f.errors);
    return f;
  }

  // pendingVerifications: registrations and enquiries waiting to be matched to a profile (not in the list yet).
  router.get('/', async (req, res) => {
    const [list, pendingVerifications] = await Promise.all([studentRepo.list(filtersOrThrow(req.query)), verifications.openCount()]);
    res.json({ ...list, pendingVerifications });
  });

  router.get('/export', auth.requirePermission('export'), async (req, res) => {
    const rows = await studentRepo.exportRows(filtersOrThrow(req.query));
    const header = [
      'Student ID', 'Name', 'Email', 'Phone', 'College', 'Stream', 'Year of study',
      'Career guidance certificates', 'Internship enquiries', 'Latest internship status', 'First seen', 'Last activity',
    ];
    const data = rows.map((s) => [
      s.studentCode,
      s.name,
      s.email,
      nationalPhone(s.phone),
      s.college,
      C.label('stream', s.stream),
      C.label('yearOfStudy', s.yearOfStudy),
      s.certificates,
      s.enquiries,
      C.label('status', s.latestEnquiryStatus),
      localDateTime(s.createdAt),
      localDateTime(s.lastActivityAt),
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sloka-students-${localDate()}.csv"`);
    res.send(toCsv(header, data));
  });

  router.get('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const [d, pending] = await Promise.all([studentRepo.detail(id), verifications.list({ status: 'open', studentId: id })]);
    if (!d) throw new HttpError(404, { error: 'not_found' });
    res.json({ ...d, verifications: pending });
  });

  router.patch('/:id', auth.requirePermission('editRecords'), async (req, res) => {
    const id = parseId(req.params.id);
    const { values, errors } = validateStudentUpdate(req.body);
    if (hasErrors(errors)) throw validationError(errors);
    const result = await studentRepo.update(id, values);
    if (result === null) throw new HttpError(404, { error: 'not_found' });
    if (result === 'email_taken') throw validationError({ email: 'Another student record already uses this email.' });
    if (result === 'phone_taken') throw validationError({ phone: 'Another student record already uses this mobile number.' });
    const [d, pending] = await Promise.all([studentRepo.detail(id), verifications.list({ status: 'open', studentId: id })]);
    res.json({ ...d, verifications: pending });
  });

  // Permanent erasure on request: the student and every registration, certificate and enquiry linked to them.
  router.delete('/:id', auth.requirePermission('deleteRecords'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await studentRepo.remove(id))) throw new HttpError(404, { error: 'not_found' });
    console.log(`[audit] student #${id} and all linked records permanently deleted by user #${req.user.id}`);
    res.status(204).end();
  });

  return router;
}

module.exports = { studentsRouter };
