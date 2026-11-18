'use strict';

const express = require('express');
const C = require('../constants');
const { parseStudentFilters } = require('../studentRepo');
const { validateStudentUpdate } = require('../validation');
const { toCsv, nationalPhone } = require('../csv');
const { localDate, localDateTime, validationError, HttpError } = require('../util');
const { diff } = require('../audit');

const hasErrors = (o) => Object.keys(o).length > 0;

function parseId(raw) {
  if (!/^\d{1,12}$/.test(String(raw))) throw new HttpError(404, { error: 'not_found' });
  return Number(raw);
}

const LABELS = {
  name: 'Name', email: 'Email', phone: 'Mobile number', college: 'College', stream: 'Stream', yearOfStudy: 'Year of study', gender: 'Gender',
  dateOfBirth: 'Date of birth', qualification: 'Qualification', specialization: 'Specialization', graduationYear: 'Year of graduation', city: 'City', state: 'State',
};

/** Staff: the master student database (career guidance + internship), permissions students.*. Edits are logged. */
function studentsRouter({ studentRepo, auth, verifications, audit }) {
  const router = express.Router();
  const may = (action) => auth.requirePermission(`students.${action}`);

  function filtersOrThrow(query) {
    const f = parseStudentFilters(query);
    if (hasErrors(f.errors)) throw validationError(f.errors);
    return f;
  }

  // pendingVerifications: registrations and enquiries waiting to be matched to a profile (not in the list yet).
  router.get('/', may('view'), async (req, res) => {
    const [list, pendingVerifications] = await Promise.all([studentRepo.list(filtersOrThrow(req.query)), verifications.openCount()]);
    res.json({ ...list, pendingVerifications });
  });

  router.get('/export', may('export'), async (req, res) => {
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

  router.get('/:id', may('view'), async (req, res) => {
    const id = parseId(req.params.id);
    const [d, pending] = await Promise.all([studentRepo.detail(id), verifications.list({ status: 'open', studentId: id })]);
    if (!d) throw new HttpError(404, { error: 'not_found' });
    res.json({ ...d, verifications: pending });
  });

  router.patch('/:id', may('edit'), async (req, res) => {
    const id = parseId(req.params.id);
    const { values, errors } = validateStudentUpdate(req.body);
    if (hasErrors(errors)) throw validationError(errors);
    const before = await studentRepo.get(id);
    const result = await studentRepo.update(id, values);
    if (result === null) throw new HttpError(404, { error: 'not_found' });
    if (result === 'email_taken') throw validationError({ email: 'Another student record already uses this email.' });
    if (result === 'phone_taken') throw validationError({ phone: 'Another student record already uses this mobile number.' });
    const changes = diff(before, values, LABELS);
    if (changes.length) {
      await audit.log({ actorId: req.user.id, entity: 'student', entityId: id, action: 'update', summary: `Edited the master record of ${result.name} (${result.studentCode})`, changes });
    }
    const [d, pending] = await Promise.all([studentRepo.detail(id), verifications.list({ status: 'open', studentId: id })]);
    res.json({ ...d, verifications: pending });
  });

  // Permanent erasure on request: the student and every registration, certificate and enquiry linked to them.
  router.delete('/:id', may('delete'), async (req, res) => {
    const id = parseId(req.params.id);
    const student = await studentRepo.get(id);
    if (!student || !(await studentRepo.remove(id))) throw new HttpError(404, { error: 'not_found' });
    await audit.log({ actorId: req.user.id, entity: 'student', entityId: id, action: 'delete', summary: `Permanently erased ${student.name} (${student.studentCode}) and every record linked to them` });
    res.status(204).end();
  });

  return router;
}

module.exports = { studentsRouter };
