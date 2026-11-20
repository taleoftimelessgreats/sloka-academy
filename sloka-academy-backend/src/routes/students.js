'use strict';

const express = require('express');
const C = require('../constants');
const { parseStudentFilters } = require('../studentRepo');
const { validateStudentUpdate } = require('../validation');
const { toCsv, nationalPhone } = require('../csv');
const { localDate, localDateTime, validationError, HttpError, parseId, hasErrors } = require('../util');
const { diff } = require('../audit');

const LABELS = {
  name: 'Name', email: 'Email', phone: 'Mobile number', college: 'College', stream: 'Stream', yearOfStudy: 'Year of study', gender: 'Gender',
  dateOfBirth: 'Date of birth', qualification: 'Qualification', specialization: 'Specialization', graduationYear: 'Year of graduation', city: 'City', state: 'State',
};

/**
 * Staff: the master student database (career guidance + internship), permissions students.*. Edits are logged.
 * Within the user's data scope: students with registrations or enquiries it covers (see scope.js).
 */
function studentsRouter({ studentRepo, auth, verifications, audit }) {
  const router = express.Router();
  // Every route shows participant data, so each needs Participant (student) data → View as well as its own action.
  const may = (action) => (action === 'view' ? auth.requirePermission('students.view') : [auth.requirePermission('students.view'), auth.requirePermission(`students.${action}`)]);
  const notFound = () => new HttpError(404, { error: 'not_found' });
  // Enquiry details (a student's enquiries, their latest status) only for those with Enquiry data → View.
  const seesEnquiries = (req) => req.user.permissions.has('enquiries.view');
  const withoutEnquiryStatus = (req, s) => (seesEnquiries(req) ? s : { ...s, latestEnquiryStatus: undefined });

  async function filtersOrThrow(req) {
    const f = parseStudentFilters(req.query, { scopeIds: await auth.scopeUserIds(req.user) });
    if (hasErrors(f.errors)) throw validationError(f.errors);
    return f;
  }

  // The student's id, if they are in the user's scope.
  async function load(req) {
    const id = parseId(req.params.id);
    if (!(await studentRepo.inScope(id, await auth.scopeUserIds(req.user)))) throw notFound();
    return id;
  }
  const detail = async (req, id) => {
    const [d, pending] = await Promise.all([studentRepo.detail(id, await auth.scopeUserIds(req.user)), verifications.list({ status: 'open', studentId: id })]);
    if (!d) throw notFound();
    return { ...d, student: withoutEnquiryStatus(req, d.student), enquiries: seesEnquiries(req) ? d.enquiries : null, verifications: pending };
  };

  // pendingVerifications: registrations and enquiries waiting to be matched to a profile (not in the list yet).
  router.get('/', may('view'), async (req, res) => {
    const [list, pendingVerifications] = await Promise.all([studentRepo.list(await filtersOrThrow(req)), verifications.openCount()]);
    res.json({ ...list, items: list.items.map((s) => withoutEnquiryStatus(req, s)), pendingVerifications });
  });

  router.get('/export', may('export'), async (req, res) => {
    const rows = (await studentRepo.exportRows(await filtersOrThrow(req))).map((s) => withoutEnquiryStatus(req, s));
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
    res.json(await detail(req, await load(req)));
  });

  router.patch('/:id', may('edit'), async (req, res) => {
    const id = await load(req);
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
    res.json(await detail(req, id));
  });

  // Permanent erasure on request: the student and every registration, certificate and enquiry linked to them.
  router.delete('/:id', may('delete'), async (req, res) => {
    const id = await load(req);
    const student = await studentRepo.get(id);
    if (!student || !(await studentRepo.remove(id))) throw notFound();
    await audit.log({ actorId: req.user.id, entity: 'student', entityId: id, action: 'delete', summary: `Permanently erased ${student.name} (${student.studentCode}) and every record linked to them` });
    res.status(204).end();
  });

  return router;
}

module.exports = { studentsRouter };
