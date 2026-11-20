'use strict';

const C = require('./constants');
const { nextStudentCode } = require('./studentIds');
const { localDate, isValidDateString, escapeLike } = require('./util');
const { registrationScope } = require('./scope');

/**
 * Internship registrations made by the BD team: the course master, one enrollment per registration (linked to
 * the student master), and the payment ledger behind each enrollment's balance and payment status.
 * Amounts are stored in paise and given to the API in rupees.
 */

const rupees = (paise) => (paise == null ? null : Math.round(paise) / 100);
/** For people (audit log, messages): 1499900 -> "₹14,999". */
const inr = (paise) => `₹${rupees(paise).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Payment status from the committed fee, the total paid and whether any later instalment was paid. */
function paymentStatus(feePaise, paidPaise, instalments) {
  if (paidPaise >= feePaise) return 'fully-paid';
  return instalments > 0 ? 'partially-paid' : 'slot-confirmed';
}

/** +919876543210 -> 98XXXXX210 */
const maskPhone = (p) => (p ? `${p.slice(-10, -8)}XXXXX${p.slice(-3)}` : null);

const courseToApi = (c) =>
  c && {
    id: c.id,
    name: c.name,
    duration: c.duration,
    active: c.active === 1,
    offerTemplate: c.offer_template_id ? { id: c.offer_template_id, name: c.template_name ?? null } : null,
    enrollments: c.enrollment_count ?? 0,
  };

const studentToApi = (s) => ({
  id: s.id,
  studentCode: s.student_code ?? null,
  name: s.name,
  phone: s.phone,
  email: s.email,
  gender: s.gender ?? null,
  dateOfBirth: s.date_of_birth ?? null,
  college: s.college,
  qualification: s.qualification ?? null,
  specialization: s.specialization ?? null,
  stream: s.stream ?? null,
  yearOfStudy: s.year_of_study ?? null,
  graduationYear: s.graduation_year ?? null,
  city: s.city ?? null,
  state: s.state ?? null,
  createdAt: s.created_at,
  updatedAt: s.updated_at,
});

const paymentToApi = (p) => ({
  id: p.id,
  kind: p.kind,
  amount: rupees(p.amount_paise),
  paymentMode: p.mode,
  transactionReference: p.reference ?? null,
  paidOn: p.paid_on,
  recordedBy: p.recorded_by ? { id: p.recorded_by, name: p.recorded_by_name ?? null } : null,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});

function enrollmentToApi(e, today = localDate()) {
  const balance = e.fee_paise - e.paid_paise;
  return {
    id: e.id,
    student: { id: e.student_id, studentCode: e.student_code ?? null, name: e.student_name, phone: e.student_phone, email: e.student_email, college: e.student_college },
    course: { id: e.course_id, name: e.course_name, duration: e.course_duration },
    // Entered when the offer letter is issued. Registrations from before that kept a batch start date instead.
    internshipStartDate: e.offer_start_date ?? null,
    batchStartDate: e.batch_start_date ?? null,
    fee: rupees(e.fee_paise),
    paid: rupees(e.paid_paise),
    balance: rupees(balance),
    paymentStatus: e.payment_status,
    overdue: balance > 0 && Boolean(e.balance_due_date) && e.balance_due_date < today,
    balanceDueDate: e.balance_due_date ?? null,
    bdAssociate: e.bd_associate_id ? { id: e.bd_associate_id, name: e.bd_name ?? null } : null,
    registrationDate: e.registration_date,
    remarks: e.remarks ?? null,
    offerLetter: e.offer_code ? { offerLetterId: e.offer_code, status: e.offer_status } : null,
    // The last email of the invoice: status 'sent' | 'failed' | null (not emailed yet).
    invoice: e.invoice_code ? { invoiceNumber: e.invoice_code, status: e.invoice_status ?? null, sentAt: e.invoice_sent_at ?? null, error: e.invoice_error ?? null } : null,
    createdBy: e.created_by ? { id: e.created_by, name: e.created_by_name ?? null } : null,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}

const SELECT = `
  SELECT e.*, st.student_code, st.name AS student_name, st.phone AS student_phone, st.email AS student_email, st.college AS student_college,
    c.name AS course_name, c.duration AS course_duration, b.name AS bd_name, cb.name AS created_by_name,
    l.offer_code, l.status AS offer_status, l.internship_start_date AS offer_start_date
  FROM enrollments e
  JOIN students st ON st.id = e.student_id
  JOIN courses c ON c.id = e.course_id
  LEFT JOIN users b ON b.id = e.bd_associate_id
  LEFT JOIN users cb ON cb.id = e.created_by
  LEFT JOIN offer_letters l ON l.enrollment_id = e.id`;

const SORTS = {
  recent: 'e.registration_date DESC, e.id DESC',
  due: 'e.balance_due_date IS NULL, e.balance_due_date ASC, e.id ASC',
  name: 'st.name ASC, e.id ASC',
  balance: '(e.fee_paise - e.paid_paise) DESC, e.id DESC',
};

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Parse list/export filters: q (name, mobile, email, Student ID), courseId, bdAssociateId, status
 * (a payment status or 'overdue'), view ('due-week' | 'overdue'), regFrom/regTo, dueFrom/dueTo, sort, page.
 * scopeIds: the BD Associates whose registrations the user may see (null = all).
 */
function parseRegistrationFilters(query, { scopeIds = null, today = localDate() } = {}) {
  const errors = {};
  const clauses = [];
  const params = [];
  const str = (key) => {
    const v = query[key];
    if (v === undefined || v === '') return undefined;
    if (typeof v !== 'string') {
      errors[key] = 'Invalid value.';
      return undefined;
    }
    return v.trim();
  };
  const scope = registrationScope(scopeIds);
  if (scope.sql) {
    clauses.push(scope.sql);
    params.push(...scope.params);
  }
  const q = str('q');
  if (q !== undefined) {
    if (q.length > 100) errors.q = 'Search must be at most 100 characters.';
    else {
      const like = `%${escapeLike(q)}%`;
      let digits = q.replace(/\D/g, '');
      if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
      const phoneLike = digits.length >= 3 && !/[A-Za-z]/.test(q) ? `%${digits}%` : like;
      clauses.push('(st.name LIKE ? OR st.email LIKE ? OR st.phone LIKE ? OR st.student_code LIKE ?)');
      params.push(like, like, phoneLike, like);
    }
  }
  for (const [key, column] of [['courseId', 'e.course_id'], ['bdAssociateId', 'e.bd_associate_id']]) {
    const v = str(key);
    if (v === undefined) continue;
    if (/^\d{1,12}$/.test(v)) {
      clauses.push(`${column} = ?`);
      params.push(Number(v));
    } else errors[key] = 'Invalid value.';
  }
  const status = str('status');
  if (status !== undefined) {
    if (status === 'overdue') {
      clauses.push('e.paid_paise < e.fee_paise AND e.balance_due_date < ?');
      params.push(today);
    } else if (C.PAYMENT_STATUS_IDS.includes(status)) {
      clauses.push('e.payment_status = ?');
      params.push(status);
    } else errors.status = 'Invalid value.';
  }
  const view = str('view');
  if (view === 'due-week') {
    clauses.push('e.paid_paise < e.fee_paise AND e.balance_due_date BETWEEN ? AND ?');
    params.push(today, addDays(today, 6));
  } else if (view === 'overdue') {
    clauses.push('e.paid_paise < e.fee_paise AND e.balance_due_date < ?');
    params.push(today);
  } else if (view !== undefined && view !== 'all') errors.view = 'Invalid value.';
  for (const [key, column, op] of [
    ['regFrom', 'e.registration_date', '>='],
    ['regTo', 'e.registration_date', '<='],
    ['dueFrom', 'e.balance_due_date', '>='],
    ['dueTo', 'e.balance_due_date', '<='],
  ]) {
    const v = str(key);
    if (v === undefined) continue;
    if (isValidDateString(v)) {
      clauses.push(`${column} ${op} ?`);
      params.push(v);
    } else errors[key] = 'Enter a valid date.';
  }
  const sort = str('sort') || (view === 'due-week' || view === 'overdue' ? 'due' : 'recent');
  if (!Object.hasOwn(SORTS, sort)) errors.sort = 'Invalid sort.';
  const page = str('page') === undefined ? 1 : Number(str('page'));
  const pageSize = str('pageSize') === undefined ? 25 : Number(str('pageSize'));
  if (!Number.isInteger(page) || page < 1 || page > 100000) errors.page = 'Invalid page.';
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) errors.pageSize = 'Page size must be 1-100.';
  return { errors, where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params, order: `ORDER BY ${SORTS[sort] || SORTS.recent}`, page, pageSize, today };
}

/** Thrown inside a transaction to answer the request with a validation error (and roll back). */
class RegistrationError extends Error {
  constructor(fields, status = 400, body = null) {
    super('registration');
    this.fields = fields;
    this.status = status;
    this.body = body;
  }
}

function createRegistrationRepo(db, config, { offerLetters, audit } = {}) {
  const now = () => new Date().toISOString();

  // ---- course master

  const COURSE_SELECT = `SELECT c.*, t.name AS template_name, (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS enrollment_count
    FROM courses c LEFT JOIN offer_templates t ON t.id = c.offer_template_id`;
  const courses = {
    list: async () => (await db.all(`${COURSE_SELECT} ORDER BY c.active DESC, c.name`)).map(courseToApi),
    get: async (id) => courseToApi(await db.get(`${COURSE_SELECT} WHERE c.id = ?`, [id])),
    async create(v) {
      const t = now();
      const r = await db.run('INSERT INTO courses (name, duration, active, offer_template_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
        v.name, v.duration, v.active === false ? 0 : 1, v.offerTemplateId ?? null, t, t,
      ]);
      return courses.get(r.insertId);
    },
    async update(id, v) {
      const cols = { name: 'name', duration: 'duration', active: 'active', offerTemplateId: 'offer_template_id' };
      const sets = [];
      const params = [];
      for (const [k, col] of Object.entries(cols)) {
        if (v[k] === undefined) continue;
        sets.push(`${col} = ?`);
        params.push(k === 'active' ? (v[k] ? 1 : 0) : v[k]);
      }
      if (sets.length) await db.run(`UPDATE courses SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now(), id]);
      return courses.get(id);
    },
  };

  // ---- student master lookup (duplicate check)

  /**
   * Students whose mobile number or email is the one entered, for the "Is this the same student?" check.
   * Resolves to [{ id, studentCode, name, phoneMasked, email, college, matchedBy, enrollments, details }]:
   * details are the other master fields, which the form fills in (and locks) once the associate confirms.
   */
  async function lookup({ phone, email }) {
    if (!phone && !email) return [];
    const rows = await db.all('SELECT * FROM students WHERE phone = ? OR email = ? ORDER BY id', [phone || null, email || null]);
    const out = [];
    for (const s of rows) {
      const enrollments = await db.all(
        `SELECT e.id, e.registration_date, e.payment_status, c.name AS course_name FROM enrollments e JOIN courses c ON c.id = e.course_id
        WHERE e.student_id = ? ORDER BY e.registration_date DESC, e.id DESC`,
        [s.id],
      );
      out.push({
        id: s.id,
        studentCode: s.student_code ?? null,
        name: s.name,
        phoneMasked: maskPhone(s.phone),
        email: s.email,
        college: s.college,
        matchedBy: [phone && s.phone === phone && 'phone', email && s.email === email && 'email'].filter(Boolean),
        enrollments: enrollments.map((e) => ({ id: e.id, course: e.course_name, registrationDate: e.registration_date, paymentStatus: e.payment_status })),
        details: {
          gender: s.gender ?? null,
          dateOfBirth: s.date_of_birth ?? null,
          qualification: s.qualification ?? null,
          specialization: s.specialization ?? null,
          yearOfStudy: s.year_of_study ?? null,
          graduationYear: s.graduation_year ?? null,
          city: s.city ?? null,
          state: s.state ?? null,
        },
      });
    }
    return out;
  }

  // ---- enrollments

  const getRow = (id) => db.get(`${SELECT} WHERE e.id = ?`, [id]);
  const inScope = (row, scopeIds) => Boolean(row) && (!scopeIds || scopeIds.includes(row.bd_associate_id));

  async function payments(enrollmentId) {
    return (
      await db.all(
        `SELECT p.*, u.name AS recorded_by_name FROM payments p LEFT JOIN users u ON u.id = p.recorded_by
        WHERE p.enrollment_id = ? ORDER BY p.paid_on, p.id`,
        [enrollmentId],
      )
    ).map(paymentToApi);
  }

  /** Bring paid_paise and payment_status up to date with the payments. */
  async function recalculate(enrollmentId) {
    const e = await db.get('SELECT fee_paise FROM enrollments WHERE id = ?', [enrollmentId]);
    const t = await db.get(
      "SELECT COALESCE(SUM(amount_paise), 0) AS paid, COALESCE(SUM(CASE WHEN kind = 'instalment' THEN 1 ELSE 0 END), 0) AS instalments FROM payments WHERE enrollment_id = ?",
      [enrollmentId],
    );
    await db.run('UPDATE enrollments SET paid_paise = ?, payment_status = ?, updated_at = ? WHERE id = ?', [
      t.paid, paymentStatus(e.fee_paise, t.paid, t.instalments), now(), enrollmentId,
    ]);
  }

  /** The due date rule: needed while a balance remains, and not before the registration date. */
  function checkDueDate(balancePaise, dueDate, registrationDate, errors) {
    if (balancePaise > 0 && !dueDate) errors.balanceDueDate = 'A balance remains: enter the date it is due.';
    else if (dueDate && dueDate < registrationDate) errors.balanceDueDate = 'The balance due date cannot be before the registration date.';
  }

  /**
   * Register a student for a course. student: validated details of a new student, or { id } of the existing
   * student the associate confirmed. Throws RegistrationError (400 fields, or 409 with the matching students).
   * Resolves to the new enrollment's id.
   */
  function create({ student, studentId, enrollment: v, actorId, bdAssociateId }) {
    return db.transaction(async () => {
      const today = localDate();
      const errors = {};
      if (v.tokenAmount > v.fee) errors.tokenAmount = 'The token amount cannot be more than the committed fee.';
      const paidOn = v.paidOn || today;
      if (paidOn > today) errors.paidOn = 'The payment date cannot be in the future.';
      checkDueDate(v.fee - v.tokenAmount, v.balanceDueDate, today, errors);
      const course = await db.get('SELECT id, active FROM courses WHERE id = ?', [v.courseId]);
      if (!course || course.active !== 1) errors.courseId = 'Choose an active course domain.';
      if (Object.keys(errors).length) throw new RegistrationError(errors);

      const t = now();
      let sid = studentId;
      if (sid) {
        // The associate confirmed it is this student: their master details stay as they are (blanks are filled).
        const s = await db.get('SELECT * FROM students WHERE id = ? FOR UPDATE', [sid]);
        if (!s) throw new RegistrationError({ studentId: 'That student record no longer exists.' });
        if (s.phone !== student.phone && s.email !== student.email) {
          throw new RegistrationError({ studentId: 'The mobile number and email entered do not belong to this student.' });
        }
        const fill = {};
        if (!s.phone && student.phone && !(await db.get('SELECT id FROM students WHERE phone = ?', [student.phone]))) fill.phone = student.phone;
        if (!s.email && student.email && !(await db.get('SELECT id FROM students WHERE email = ?', [student.email]))) fill.email = student.email;
        const keys = Object.keys(fill);
        if (keys.length) await db.run(`UPDATE students SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((k) => fill[k]), t, sid]);
      } else {
        // Mobile number and email each identify one student: if either is known, the associate must confirm.
        const matches = await lookup({ phone: student.phone, email: student.email });
        if (matches.length) throw new RegistrationError({}, 409, { error: 'student_exists', matches });
        const code = await nextStudentCode(db, config.studentIdPrefix, t);
        sid = (
          await db.run(
            `INSERT INTO students (student_code, name, email, phone, college, stream, year_of_study, gender, date_of_birth, qualification,
              specialization, graduation_year, city, state, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              code, student.name, student.email, student.phone, student.college, student.stream ?? null, student.yearOfStudy ?? null,
              student.gender ?? null, student.dateOfBirth ?? null, student.qualification ?? null, student.specialization ?? null,
              student.graduationYear ?? null, student.city ?? null, student.state ?? null, t, t,
            ],
          )
        ).insertId;
        await audit.log({ actorId, entity: 'student', entityId: sid, action: 'create', summary: `Added ${student.name} (${code}) to the student master` });
      }

      const id = (
        await db.run(
          `INSERT INTO enrollments (student_id, course_id, fee_paise, paid_paise, payment_status, balance_due_date,
            bd_associate_id, registration_date, remarks, created_by, created_at, updated_at)
          VALUES (?, ?, ?, 0, 'slot-confirmed', ?, ?, ?, ?, ?, ?, ?)`,
          [sid, v.courseId, v.fee, v.balanceDueDate ?? null, bdAssociateId, today, v.remarks ?? null, actorId, t, t],
        )
      ).insertId;
      await db.run(
        "INSERT INTO payments (enrollment_id, kind, amount_paise, mode, reference, paid_on, recorded_by, created_at, updated_at) VALUES (?, 'token', ?, ?, ?, ?, ?, ?, ?)",
        [id, v.tokenAmount, v.paymentMode, v.transactionReference ?? null, paidOn, actorId, t, t],
      );
      await recalculate(id);
      const row = await getRow(id);
      await audit.log({
        actorId, entity: 'enrollment', entityId: id, action: 'create',
        summary: `Registered ${row.student_name} for ${row.course_name}: fee ${inr(v.fee)}, token ${inr(v.tokenAmount)}`,
      });
      // The offer letter is issued later, once the fee is fully paid (see routes/registrations.js).
      return id;
    });
  }

  async function get(id, scopeIds = null) {
    const row = await getRow(id);
    return inScope(row, scopeIds) ? enrollmentToApi(row) : null;
  }

  async function list(f) {
    const [count, rows] = await Promise.all([
      db.get(`SELECT COUNT(*) AS n FROM enrollments e JOIN students st ON st.id = e.student_id ${f.where}`, f.params),
      db.all(`${SELECT} ${f.where} ${f.order} LIMIT ? OFFSET ?`, [...f.params, f.pageSize, (f.page - 1) * f.pageSize]),
    ]);
    return { items: rows.map((r) => enrollmentToApi(r, f.today)), total: count.n, page: f.page, pageSize: f.pageSize };
  }

  const exportRows = async (f) => (await db.all(`${SELECT} ${f.where} ${f.order}`, f.params)).map((r) => enrollmentToApi(r, f.today));

  // Totals over a set of enrollments (alias e, offer letters l); the ? are the dates of insightDates().
  const TOTALS = `COUNT(*) AS registrations,
    COALESCE(SUM(e.fee_paise), 0) AS committed,
    COALESCE(SUM(e.paid_paise), 0) AS collected,
    COALESCE(SUM(CASE WHEN e.payment_status = 'fully-paid' THEN 1 ELSE 0 END), 0) AS fully_paid,
    COALESCE(SUM(CASE WHEN e.payment_status = 'partially-paid' THEN 1 ELSE 0 END), 0) AS partially_paid,
    COALESCE(SUM(CASE WHEN e.payment_status = 'slot-confirmed' THEN 1 ELSE 0 END), 0) AS slot_confirmed,
    COALESCE(SUM(CASE WHEN e.paid_paise < e.fee_paise AND e.balance_due_date BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS due_week,
    COALESCE(SUM(CASE WHEN e.paid_paise < e.fee_paise AND e.balance_due_date < ? THEN 1 ELSE 0 END), 0) AS overdue,
    COALESCE(SUM(CASE WHEN e.paid_paise < e.fee_paise AND e.balance_due_date < ? THEN e.fee_paise - e.paid_paise ELSE 0 END), 0) AS overdue_amount,
    COALESCE(SUM(CASE WHEN l.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS offer_letters,
    COALESCE(SUM(CASE WHEN e.paid_paise >= e.fee_paise AND l.id IS NULL THEN 1 ELSE 0 END), 0) AS awaiting_offer`;
  const insightDates = (today) => [today, addDays(today, 6), today, today];
  const totalsToApi = (r) => ({
    registrations: r.registrations,
    committed: rupees(r.committed),
    collected: rupees(r.collected),
    outstanding: rupees(r.committed - r.collected),
    collectionRate: r.committed ? Math.round((r.collected / r.committed) * 1000) / 10 : 0,
    fullyPaid: r.fully_paid,
    partiallyPaid: r.partially_paid,
    slotConfirmed: r.slot_confirmed,
    dueThisWeek: r.due_week,
    overdue: r.overdue,
    overdueAmount: rupees(r.overdue_amount),
    offerLetters: r.offer_letters,
    awaitingOfferLetter: r.awaiting_offer, // fully paid, no offer letter yet
  });

  /**
   * Insights for the registrations that filters select (parseRegistrationFilters: the list's filters and the
   * data scope), in total and per BD Associate, so they always match the list.
   */
  async function insights(f) {
    const from = (joins) => `FROM enrollments e JOIN students st ON st.id = e.student_id LEFT JOIN offer_letters l ON l.enrollment_id = e.id ${joins} ${f.where}`;
    const params = [...insightDates(f.today), ...f.params];
    const [total, rows] = await Promise.all([
      db.get(`SELECT ${TOTALS} ${from('')}`, params),
      db.all(`SELECT e.bd_associate_id AS associate_id, b.name AS associate_name, ${TOTALS} ${from('LEFT JOIN users b ON b.id = e.bd_associate_id')}
        GROUP BY e.bd_associate_id, b.name ORDER BY collected DESC, registrations DESC, b.name`, params),
    ]);
    return {
      ...totalsToApi(total),
      byAssociate: rows.map((r) => ({ associate: r.associate_id ? { id: r.associate_id, name: r.associate_name } : null, ...totalsToApi(r) })),
    };
  }

  /** Payments received between two dates (inclusive) on the registrations that filters select. */
  async function received(f, fromDate, toDate) {
    const clauses = [fromDate && 'p.paid_on >= ?', toDate && 'p.paid_on <= ?'].filter(Boolean);
    const r = await db.get(
      `SELECT COALESCE(SUM(p.amount_paise), 0) AS amount, COUNT(*) AS payments
      FROM payments p JOIN enrollments e ON e.id = p.enrollment_id JOIN students st ON st.id = e.student_id
      ${f.where ? `${f.where} AND` : 'WHERE'} ${clauses.join(' AND ')}`,
      [...f.params, ...[fromDate, toDate].filter(Boolean)],
    );
    return { amount: rupees(r.amount), payments: r.payments };
  }

  /** Totals for the overview, within the scope. */
  async function stats(scopeIds, today = localDate()) {
    const scope = registrationScope(scopeIds);
    const where = scope.sql ? `WHERE ${scope.sql}` : '';
    const params = scope.params;
    const r = await db.get(
      `SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN e.registration_date >= ? THEN 1 ELSE 0 END), 0) AS this_month,
        COALESCE(SUM(e.fee_paise), 0) AS committed,
        COALESCE(SUM(e.paid_paise), 0) AS collected,
        COALESCE(SUM(CASE WHEN e.paid_paise < e.fee_paise AND e.balance_due_date BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS due_week,
        COALESCE(SUM(CASE WHEN e.paid_paise < e.fee_paise AND e.balance_due_date < ? THEN 1 ELSE 0 END), 0) AS overdue
      FROM enrollments e ${where}`,
      [`${today.slice(0, 7)}-01`, today, addDays(today, 6), today, ...params],
    );
    return {
      total: r.total,
      thisMonth: r.this_month,
      committed: rupees(r.committed),
      collected: rupees(r.collected),
      outstanding: rupees(r.committed - r.collected),
      dueThisWeek: r.due_week,
      overdue: r.overdue,
    };
  }

  /** A student's master details with their enrollments in scope (each with its payments and offer letter); null if none. */
  async function studentProfile(studentId, scopeIds = null) {
    const s = await db.get('SELECT * FROM students WHERE id = ?', [studentId]);
    if (!s) return null;
    const rows = (await db.all(`${SELECT} WHERE e.student_id = ? ORDER BY e.registration_date DESC, e.id DESC`, [studentId])).filter((r) => inScope(r, scopeIds));
    if (!rows.length && scopeIds) return null;
    const enrollments = [];
    for (const r of rows) {
      enrollments.push({ ...enrollmentToApi(r), payments: await payments(r.id), offerLetterDetail: offerLetters ? await offerLetters.get(r.id) : null });
    }
    return { student: studentToApi(s), enrollments };
  }

  const FIELD_LABELS = { courseId: 'Course domain', fee: 'Committed fee (₹)', balanceDueDate: 'Balance due date', bdAssociateId: 'BD Associate', remarks: 'Remarks' };

  /** Change an enrollment after submission (validated partial values). Throws RegistrationError. */
  function update(id, v, actorId) {
    return db.transaction(async () => {
      const e = await db.get('SELECT * FROM enrollments WHERE id = ? FOR UPDATE', [id]);
      if (!e) return null;
      const errors = {};
      const fee = v.fee ?? e.fee_paise;
      if (fee < e.paid_paise) errors.fee = `The fee cannot be less than what has been paid (${inr(e.paid_paise)}).`;
      const due = v.balanceDueDate === undefined ? e.balance_due_date : v.balanceDueDate;
      checkDueDate(fee - e.paid_paise, due, e.registration_date, errors);
      if (v.courseId !== undefined && v.courseId !== e.course_id) {
        const course = await db.get('SELECT active FROM courses WHERE id = ?', [v.courseId]);
        if (!course || course.active !== 1) errors.courseId = 'Choose an active course domain.';
      }
      if (Object.keys(errors).length) throw new RegistrationError(errors);
      const cols = { courseId: 'course_id', fee: 'fee_paise', balanceDueDate: 'balance_due_date', bdAssociateId: 'bd_associate_id', remarks: 'remarks' };
      const sets = [];
      const params = [];
      const changes = [];
      const names = async (table, ids) => Object.fromEntries((await db.all(`SELECT id, name FROM ${table} WHERE id IN (?)`, [ids.filter(Boolean).length ? ids.filter(Boolean) : [0]])).map((r) => [r.id, r.name]));
      const courseNames = await names('courses', [e.course_id, v.courseId]);
      const userNames = await names('users', [e.bd_associate_id, v.bdAssociateId]);
      const shown = (k, value) => (value == null ? null : k === 'fee' ? rupees(value) : k === 'courseId' ? courseNames[value] : k === 'bdAssociateId' ? userNames[value] : value);
      for (const [k, col] of Object.entries(cols)) {
        if (v[k] === undefined || v[k] === e[col]) continue;
        sets.push(`${col} = ?`);
        params.push(v[k]);
        changes.push({ field: FIELD_LABELS[k], from: shown(k, e[col]), to: shown(k, v[k]) });
      }
      if (!sets.length) return get(id);
      await db.run(`UPDATE enrollments SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now(), id]);
      await recalculate(id);
      const st = await db.get('SELECT name FROM students WHERE id = ?', [e.student_id]);
      await audit.log({ actorId, entity: 'enrollment', entityId: id, action: 'update', summary: `Changed the registration of ${st.name}`, changes });
      return get(id);
    });
  }

  /** Record a later payment. v: validated payment (paise). Throws RegistrationError. */
  function addPayment(id, v, actorId) {
    return db.transaction(async () => {
      const e = await db.get('SELECT * FROM enrollments WHERE id = ? FOR UPDATE', [id]);
      if (!e) return null;
      const errors = {};
      const balance = e.fee_paise - e.paid_paise;
      if (balance <= 0) errors.amount = 'This registration is fully paid.';
      else if (v.amount > balance) errors.amount = `The balance is ${inr(balance)}; the payment cannot be more.`;
      const today = localDate();
      const paidOn = v.paidOn || today;
      if (paidOn > today) errors.paidOn = 'The payment date cannot be in the future.';
      else if (paidOn < e.registration_date) errors.paidOn = 'The payment date cannot be before the registration date.';
      const due = v.balanceDueDate ?? e.balance_due_date;
      if (!errors.amount) checkDueDate(balance - v.amount, due, e.registration_date, errors);
      if (Object.keys(errors).length) throw new RegistrationError(errors);
      const t = now();
      const r = await db.run(
        "INSERT INTO payments (enrollment_id, kind, amount_paise, mode, reference, paid_on, recorded_by, created_at, updated_at) VALUES (?, 'instalment', ?, ?, ?, ?, ?, ?, ?)",
        [id, v.amount, v.paymentMode, v.transactionReference ?? null, paidOn, actorId, t, t],
      );
      if (v.balanceDueDate && v.balanceDueDate !== e.balance_due_date) await db.run('UPDATE enrollments SET balance_due_date = ? WHERE id = ?', [v.balanceDueDate, id]);
      await recalculate(id);
      const st = await db.get('SELECT name FROM students WHERE id = ?', [e.student_id]);
      await audit.log({
        actorId, entity: 'payment', entityId: r.insertId, action: 'create',
        summary: `Recorded a payment of ${inr(v.amount)} (${C.label('paymentMode', v.paymentMode)}) from ${st.name}`,
        changes: v.balanceDueDate && v.balanceDueDate !== e.balance_due_date ? [{ field: 'Balance due date', from: e.balance_due_date, to: v.balanceDueDate }] : [],
      });
      return get(id);
    });
  }

  /** Correct a payment (partial). Throws RegistrationError. Resolves to the enrollment, or null if the payment is not this enrollment's. */
  function updatePayment(id, paymentId, v, actorId) {
    return db.transaction(async () => {
      const e = await db.get('SELECT * FROM enrollments WHERE id = ? FOR UPDATE', [id]);
      const p = e && (await db.get('SELECT * FROM payments WHERE id = ? AND enrollment_id = ?', [paymentId, id]));
      if (!p) return null;
      const errors = {};
      const amount = v.amount ?? p.amount_paise;
      if (e.paid_paise - p.amount_paise + amount > e.fee_paise) errors.amount = 'Payments cannot add up to more than the committed fee.';
      if (v.paidOn !== undefined) {
        if (v.paidOn === null) errors.paidOn = 'Enter the payment date.';
        else if (v.paidOn > localDate()) errors.paidOn = 'The payment date cannot be in the future.';
      }
      if (!errors.amount) checkDueDate(e.fee_paise - (e.paid_paise - p.amount_paise + amount), e.balance_due_date, e.registration_date, errors);
      if (Object.keys(errors).length) throw new RegistrationError(errors);
      const cols = { amount: 'amount_paise', paymentMode: 'mode', transactionReference: 'reference', paidOn: 'paid_on' };
      const labels = { amount: 'Amount (₹)', paymentMode: 'Payment mode', transactionReference: 'Transaction reference', paidOn: 'Paid on' };
      const sets = [];
      const params = [];
      const changes = [];
      for (const [k, col] of Object.entries(cols)) {
        if (v[k] === undefined || v[k] === p[col]) continue;
        sets.push(`${col} = ?`);
        params.push(v[k]);
        changes.push({ field: labels[k], from: k === 'amount' ? rupees(p[col]) : p[col], to: k === 'amount' ? rupees(v[k]) : v[k] });
      }
      if (sets.length) {
        await db.run(`UPDATE payments SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now(), paymentId]);
        await recalculate(id);
        await audit.log({ actorId, entity: 'payment', entityId: paymentId, action: 'update', summary: `Corrected a ${p.kind === 'token' ? 'token' : 'later'} payment (registration #${id})`, changes });
      }
      return get(id);
    });
  }

  /** Remove a later payment recorded by mistake (the token payment stays). */
  function removePayment(id, paymentId, actorId) {
    return db.transaction(async () => {
      const e = await db.get('SELECT * FROM enrollments WHERE id = ? FOR UPDATE', [id]);
      const p = e && (await db.get('SELECT * FROM payments WHERE id = ? AND enrollment_id = ?', [paymentId, id]));
      if (!p) return null;
      if (p.kind === 'token') throw new RegistrationError({ payment: 'The token payment cannot be removed; correct it instead.' });
      const errors = {};
      checkDueDate(e.fee_paise - (e.paid_paise - p.amount_paise), e.balance_due_date, e.registration_date, errors);
      if (Object.keys(errors).length) throw new RegistrationError({ payment: 'Set a balance due date before removing this payment (a balance would remain).' });
      await db.run('DELETE FROM payments WHERE id = ?', [paymentId]);
      await recalculate(id);
      await audit.log({
        actorId, entity: 'payment', entityId: paymentId, action: 'delete',
        summary: `Removed a payment of ${inr(p.amount_paise)} paid on ${p.paid_on} (registration #${id})`,
        changes: [{ field: 'Amount (₹)', from: rupees(p.amount_paise), to: null }],
      });
      return get(id);
    });
  }

  /** Delete an enrollment with its payments and offer letter. */
  function remove(id, actorId) {
    return db.transaction(async () => {
      const row = await getRow(id);
      if (!row) return false;
      await db.run('DELETE FROM enrollments WHERE id = ?', [id]); // payments and the offer letter go with it
      await audit.log({
        actorId, entity: 'enrollment', entityId: id, action: 'delete',
        summary: `Deleted the registration of ${row.student_name} for ${row.course_name} (fee ${inr(row.fee_paise)}, paid ${inr(row.paid_paise)})`,
      });
      return true;
    });
  }

  // ---- conflicts flagged for admin review ("No, this is not the same student")

  const flagToApi = (f) => ({
    id: f.id,
    entered: JSON.parse(f.entered),
    matched: JSON.parse(f.matched),
    note: f.note ?? null,
    status: f.status,
    raisedBy: f.raised_by ? { id: f.raised_by, name: f.raised_by_name ?? null } : null,
    resolvedBy: f.resolved_by ? { id: f.resolved_by, name: f.resolved_by_name ?? null } : null,
    resolutionNote: f.resolution_note ?? null,
    resolvedAt: f.resolved_at ?? null,
    createdAt: f.created_at,
  });
  const FLAG_SELECT = `SELECT f.*, r.name AS raised_by_name, s.name AS resolved_by_name
    FROM registration_flags f LEFT JOIN users r ON r.id = f.raised_by LEFT JOIN users s ON s.id = f.resolved_by`;

  const flags = {
    async create({ entered, note }, actorId) {
      const matched = (await lookup({ phone: entered.phone, email: entered.email })).map((m) => ({ id: m.id, studentCode: m.studentCode, name: m.name, matchedBy: m.matchedBy }));
      return db.transaction(async () => {
        const r = await db.run('INSERT INTO registration_flags (entered, matched, note, raised_by, created_at) VALUES (?, ?, ?, ?, ?)', [
          JSON.stringify(entered), JSON.stringify(matched), note ?? null, actorId, now(),
        ]);
        await audit.log({ actorId, entity: 'registration_flag', entityId: r.insertId, action: 'create', summary: `Flagged a mobile/email conflict for ${entered.name || 'a registration'} for admin review` });
        return flagToApi(await db.get(`${FLAG_SELECT} WHERE f.id = ?`, [r.insertId]));
      });
    },
    list: async (status) =>
      (await db.all(`${FLAG_SELECT} ${status === 'all' ? '' : 'WHERE f.status = ?'} ORDER BY f.created_at DESC, f.id DESC LIMIT 200`, status === 'all' ? [] : [status])).map(flagToApi),
    openCount: async () => (await db.get("SELECT COUNT(*) AS n FROM registration_flags WHERE status = 'open'")).n,
    resolve(id, note, actorId) {
      return db.transaction(async () => {
        const f = await db.get('SELECT * FROM registration_flags WHERE id = ? FOR UPDATE', [id]);
        if (!f) return null;
        if (f.status !== 'open') return 'closed';
        await db.run("UPDATE registration_flags SET status = 'resolved', resolved_by = ?, resolution_note = ?, resolved_at = ? WHERE id = ?", [actorId, note ?? null, now(), id]);
        await audit.log({ actorId, entity: 'registration_flag', entityId: id, action: 'resolve', summary: `Resolved registration conflict #${id}${note ? `: ${note}` : ''}` });
        return flagToApi(await db.get(`${FLAG_SELECT} WHERE f.id = ?`, [id]));
      });
    },
  };

  return { courses, lookup, create, get, list, exportRows, stats, insights, received, studentProfile, update, addPayment, updatePayment, removePayment, remove, payments, flags };
}

module.exports = { createRegistrationRepo, parseRegistrationFilters, RegistrationError, paymentStatus, rupees };
