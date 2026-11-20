'use strict';

const express = require('express');
const C = require('../constants');
const { parseRegistrationFilters, RegistrationError } = require('../registrationRepo');
const { validateRegistrationStudent, validateEnrollment, validatePayment, normalizePhone, asObject } = require('../validation');
const { toCsv, nationalPhone } = require('../csv');
const { localDate, isValidDateString, validationError, HttpError, parseId, hasErrors } = require('../util');

const OFFER_STATUS = { generated: 'Generated', sent: 'Sent', failed: 'Failed' };

/**
 * Staff: internship registrations made by the BD team. Every route keeps to the user's data scope
 * (own / team / all registrations, by BD Associate); a registration outside it is "not found".
 */
function registrationsRouter({ db, auth, registrations, offerLetters, invoices }) {
  const router = express.Router();
  const may = (p) => auth.requirePermission(p);
  const notFound = () => new HttpError(404, { error: 'not_found' });

  // The registration, if it is in the user's scope.
  async function load(req, id) {
    const e = await registrations.get(id, await auth.scopeUserIds(req.user));
    if (!e) throw notFound();
    return e;
  }

  async function filtersOrThrow(req, query = req.query) {
    const f = parseRegistrationFilters(query, { scopeIds: await auth.scopeUserIds(req.user) });
    if (hasErrors(f.errors)) throw validationError(f.errors);
    return f;
  }

  router.get('/', may('registrations.view'), async (req, res) => {
    res.json(await registrations.list(await filtersOrThrow(req)));
  });

  /**
   * Insights for the registrations the list's filters select (same query string, same data scope): totals,
   * payment status counts, and per BD Associate. views: the counts of the All / Due this week / Overdue tabs
   * under the other filters. received: payments received between regFrom and regTo (when either is set) on the
   * registrations the other filters select, whenever they were registered.
   */
  router.get('/insights', may('registrations.view'), async (req, res) => {
    const f = await filtersOrThrow(req);
    const { view, ...withoutView } = req.query;
    const all = await filtersOrThrow(req, withoutView);
    const { regFrom, regTo, ...withoutPeriod } = req.query;
    const period = Boolean((typeof regFrom === 'string' && regFrom) || (typeof regTo === 'string' && regTo)); // valid: f has checked them
    const [insights, views, received] = await Promise.all([
      registrations.insights(f),
      registrations.insights(all),
      period ? filtersOrThrow(req, withoutPeriod).then((g) => registrations.received(g, regFrom || null, regTo || null)) : null,
    ]);
    res.json({
      insights,
      views: { all: views.registrations, dueThisWeek: views.dueThisWeek, overdue: views.overdue },
      received: received && { ...received, from: regFrom || null, to: regTo || null },
    });
  });

  router.get('/export', may('registrations.export'), async (req, res) => {
    const rows = await registrations.exportRows(await filtersOrThrow(req));
    const header = [
      'Registration date', 'Student ID', 'Name', 'Mobile', 'Email', 'College', 'Course domain', 'Internship start date',
      'Committed fee (INR)', 'Paid (INR)', 'Balance (INR)', 'Balance due date', 'Payment status', 'Overdue', 'BD Associate',
      'Offer letter ID', 'Offer letter status', 'Remarks',
    ];
    const data = rows.map((e) => [
      e.registrationDate, e.student.studentCode, e.student.name, nationalPhone(e.student.phone), e.student.email, e.student.college,
      e.course.name, e.internshipStartDate || e.batchStartDate, e.fee, e.paid, e.balance, e.balanceDueDate, C.label('paymentStatus', e.paymentStatus),
      e.overdue ? 'Yes' : '', e.bdAssociate ? e.bdAssociate.name : '', e.offerLetter ? e.offerLetter.offerLetterId : '',
      e.offerLetter ? OFFER_STATUS[e.offerLetter.status] : '', e.remarks,
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sloka-registrations-${localDate()}.csv"`);
    res.send(toCsv(header, data));
  });

  // "Is this the same student?": the student master records with this mobile number or email.
  router.get('/lookup', may('registrations.create'), async (req, res) => {
    const phone = typeof req.query.phone === 'string' ? normalizePhone(req.query.phone) : null;
    const email = typeof req.query.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(req.query.email.trim()) ? req.query.email.trim().toLowerCase() : null;
    res.json({ matches: await registrations.lookup({ phone, email }) });
  });

  /**
   * Register a student. { studentId? (the existing student the associate confirmed), student: {...},
   * enrollment: {...} }. 409 student_exists (with the matches) if the mobile number or email is already in the
   * student master and no studentId was given. The offer letter follows once the fee is fully paid.
   */
  router.post('/', may('registrations.create'), async (req, res) => {
    const body = asObject(req.body);
    const studentId = body.studentId == null ? null : parseId(body.studentId);
    const s = validateRegistrationStudent(body.student);
    const e = validateEnrollment(body.enrollment);
    // Errors are keyed student.<field> / enrollment.<field>, as the form's sections are. A confirmed student's
    // details come from their master record: only the mobile number and email entered are checked.
    const errors = {};
    for (const [k, v] of Object.entries(s.errors)) if (!studentId || k === 'phone' || k === 'email') errors[`student.${k}`] = v;
    for (const [k, v] of Object.entries(e.errors)) errors[`enrollment.${k}`] = v;
    // The BD Associate is whoever registers; only those who may edit registrations can register on someone's behalf.
    let bdAssociateId = req.user.id;
    if (e.values.bdAssociateId && e.values.bdAssociateId !== req.user.id) {
      if (!req.user.permissions.has('registrations.edit')) throw new HttpError(403, { error: 'forbidden' });
      const scopeIds = await auth.scopeUserIds(req.user);
      const target = await db.get('SELECT id FROM users WHERE id = ? AND active = 1', [e.values.bdAssociateId]);
      if (!target || (scopeIds && !scopeIds.includes(target.id))) errors['enrollment.bdAssociateId'] = 'Choose an active associate.';
      else bdAssociateId = target.id;
    }
    if (hasErrors(errors)) throw validationError(errors);
    let id;
    try {
      id = await registrations.create({ student: s.values, studentId, enrollment: e.values, actorId: req.user.id, bdAssociateId });
    } catch (err) {
      if (!(err instanceof RegistrationError) || err.body) throw err;
      throw validationError(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k === 'studentId' ? k : `enrollment.${k}`, v])));
    }
    // The slot is confirmed: the invoice (with the registration amount) goes to the student.
    const invoiceEmail = await invoices.send(id);
    res.status(201).json({ registration: await registrations.get(id), invoiceEmail });
  });

  // ---- conflicts the associates flagged ("not the same student")

  router.get('/flags', may('students.edit'), async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'open';
    if (!['open', 'resolved', 'all'].includes(status)) throw validationError({ status: 'Invalid value.' });
    res.json({ flags: await registrations.flags.list(status) });
  });

  router.post('/flags', may('registrations.create'), async (req, res) => {
    const body = asObject(req.body);
    const entered = {
      name: typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '',
      phone: typeof body.phone === 'string' ? normalizePhone(body.phone) : null,
      email: typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : null,
    };
    if (!entered.phone && !entered.email) throw validationError({ phone: 'Enter the mobile number or email that matched.' });
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;
    res.status(201).json({ flag: await registrations.flags.create({ entered, note: note || null }, req.user.id) });
  });

  router.post('/flags/:id/resolve', may('students.edit'), async (req, res) => {
    const note = req.body && typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 500) : null;
    const flag = await registrations.flags.resolve(parseId(req.params.id), note || null, req.user.id);
    if (!flag) throw notFound();
    if (flag === 'closed') return res.status(409).json({ error: 'closed', message: 'This conflict has already been resolved.' });
    return res.json({ flag });
  });

  // ---- one student / one registration

  // Student profile: master details, enrollment history (in scope) and each enrollment's payment ledger.
  router.get('/students/:studentId', may('registrations.view'), async (req, res) => {
    const profile = await registrations.studentProfile(parseId(req.params.studentId), await auth.scopeUserIds(req.user));
    if (!profile) throw notFound();
    if (!req.user.permissions.has('offerLetters.view')) for (const e of profile.enrollments) e.offerLetterDetail = undefined;
    res.json(profile);
  });

  router.get('/:id', may('registrations.view'), async (req, res) => {
    const id = parseId(req.params.id);
    const registration = await load(req, id);
    res.json({ registration, payments: await registrations.payments(id) });
  });

  // Change fee, due date, course, BD Associate or remarks after submission (logged).
  router.patch('/:id', may('registrations.edit'), async (req, res) => {
    const id = parseId(req.params.id);
    await load(req, id);
    const { values, errors } = validateEnrollment(req.body, { partial: true });
    if (values.bdAssociateId != null && !errors.bdAssociateId) {
      const scopeIds = await auth.scopeUserIds(req.user);
      const target = await db.get('SELECT id FROM users WHERE id = ? AND active = 1', [values.bdAssociateId]);
      if (!target || (scopeIds && !scopeIds.includes(target.id))) errors.bdAssociateId = 'Choose an active associate.';
    }
    if (values.bdAssociateId === null) errors.bdAssociateId = 'Choose the BD Associate.';
    if (hasErrors(errors)) throw validationError(errors);
    res.json({ registration: await registrations.update(id, values, req.user.id), payments: await registrations.payments(id) });
  });

  router.delete('/:id', may('registrations.delete'), async (req, res) => {
    const id = parseId(req.params.id);
    await load(req, id);
    await registrations.remove(id, req.user.id);
    res.status(204).end();
  });

  // ---- payment ledger

  router.post('/:id/payments', may('payments.create'), async (req, res) => {
    const id = parseId(req.params.id);
    await load(req, id);
    const { values, errors } = validatePayment(req.body);
    if (hasErrors(errors)) throw validationError(errors);
    if (!(await registrations.addPayment(id, values, req.user.id))) throw notFound();
    // After every payment the updated invoice goes to the student: history, total paid and balance.
    const invoiceEmail = await invoices.send(id);
    res.status(201).json({ registration: await registrations.get(id), payments: await registrations.payments(id), invoiceEmail });
  });

  router.patch('/:id/payments/:paymentId', may('registrations.edit'), async (req, res) => {
    const id = parseId(req.params.id);
    await load(req, id);
    const { values, errors } = validatePayment(req.body, { partial: true });
    if (hasErrors(errors)) throw validationError(errors);
    const registration = await registrations.updatePayment(id, parseId(req.params.paymentId), values, req.user.id);
    if (!registration) throw notFound();
    res.json({ registration, payments: await registrations.payments(id) });
  });

  router.delete('/:id/payments/:paymentId', may('payments.delete'), async (req, res) => {
    const id = parseId(req.params.id);
    await load(req, id);
    const registration = await registrations.removePayment(id, parseId(req.params.paymentId), req.user.id);
    if (!registration) throw notFound();
    res.json({ registration, payments: await registrations.payments(id) });
  });

  // ---- invoice (always drawn from the payment ledger: every payment, the total paid and the balance)

  router.get('/:id/invoice/pdf', may('registrations.view'), async (req, res) => {
    const id = parseId(req.params.id);
    await load(req, id);
    const invoice = await invoices.render(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="Invoice-${invoice.code.replace(/\//g, '-')}.pdf"`);
    res.send(invoice.pdf);
  });

  // Email the up-to-date invoice again (it is sent by itself after a payment; after a correction, send it from here).
  router.post('/:id/invoice/send', auth.requireAny('payments.create', 'registrations.create', 'registrations.edit'), may('registrations.view'), async (req, res) => {
    const id = parseId(req.params.id);
    await load(req, id);
    if (!invoices.emailEnabled()) return res.status(400).json({ error: 'email_not_configured', message: 'Email is not configured on the server. Download the invoice and send it yourself.' });
    const invoiceEmail = await invoices.send(id);
    return res.json({ registration: await registrations.get(id), invoiceEmail });
  });

  // ---- offer letter

  router.get('/:id/offer-letter', may('offerLetters.view'), async (req, res) => {
    const id = parseId(req.params.id);
    await load(req, id);
    res.json({ offerLetter: await offerLetters.get(id), emailEnabled: offerLetters.emailEnabled() });
  });

  router.get('/:id/offer-letter/pdf', may('offerLetters.view'), async (req, res) => {
    const id = parseId(req.params.id);
    await load(req, id);
    const letter = await offerLetters.render(id);
    if (!letter) throw notFound();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="Offer-Letter-${letter.code.replace(/\//g, '-')}.pdf"`);
    res.send(letter.pdf);
  });

  // Offer letters are issued only once the fee is fully paid, and always with the internship start date the
  // associate enters ({ startDate: 'YYYY-MM-DD' }, not before the registration date).
  async function issuable(req) {
    const id = parseId(req.params.id);
    const registration = await load(req, id);
    if (registration.balance > 0) {
      throw new HttpError(409, {
        error: 'balance_due',
        message: `The offer letter can be issued once the fee is fully paid. ₹${registration.balance.toLocaleString('en-IN')} is still due.`,
      });
    }
    const raw = req.body && typeof req.body.startDate === 'string' ? req.body.startDate.trim() : '';
    if (!raw) throw validationError({ startDate: 'Enter the internship start date.' });
    if (!isValidDateString(raw)) throw validationError({ startDate: 'Enter a valid date.' });
    if (raw < registration.registrationDate) throw validationError({ startDate: 'The internship cannot start before the registration date.' });
    return { id, startDate: raw };
  }

  // Generate the letter, or regenerate it (same ID) with the current details, template and the date entered.
  router.post('/:id/offer-letter/generate', may('offerLetters.create'), async (req, res) => {
    const { id, startDate } = await issuable(req);
    res.json({ offerLetter: await offerLetters.generate(id, req.user.id, { startDate }) });
  });

  // Email the letter to the student; it is generated first if there is none or the start date changed.
  router.post('/:id/offer-letter/send', may('offerLetters.create'), async (req, res) => {
    const { id, startDate } = await issuable(req);
    const letter = await offerLetters.get(id);
    if (!letter || letter.internshipStartDate !== startDate) await offerLetters.generate(id, req.user.id, { startDate });
    res.json({ offerLetter: await offerLetters.send(id, req.user.id) });
  });

  return router;
}

module.exports = { registrationsRouter };
