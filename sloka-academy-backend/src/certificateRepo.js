'use strict';

const { isDuplicate } = require('./db');
const { linkStudent, pruneStudent: pruneProfile } = require('./studentMatch');
const { openVerification, closeForRecord } = require('./profileVerification');
const { generateSessionCode, generateCertificateId, newDownloadToken } = require('./certIds');
const { localDate } = require('./util');

const EVENT_TYPES = [
  'registered', 'downloaded', 'name_corrected', 'revoked', 'reinstated', 'emailed', 'link_rotated', 'email_failed', 'details_corrected',
];
const EMAIL_STATUSES = ['pending', 'sent', 'failed', 'off'];

const sessionToApi = (s) =>
  s && {
    id: s.id,
    title: s.title,
    sessionDate: s.session_date,
    venue: s.venue,
    mode: s.mode,
    description: s.description,
    code: s.code,
    registrationOpen: s.registration_open === 1,
    closesAt: s.closes_at,
    createdBy: s.created_by ? { id: s.created_by, name: s.created_by_name } : null,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    registrations: s.registrations ?? undefined,
    templateId: s.template_id ?? null,
    acceptingNow: s.registration_open === 1 && (!s.closes_at || s.closes_at > new Date().toISOString()),
  };

const regToApi = (r) =>
  r && {
    id: r.id,
    certificateId: r.certificate_id,
    status: r.status,
    revokedReason: r.revoked_reason,
    name: r.name,
    email: r.email,
    phone: r.phone,
    college: r.college,
    stream: r.stream,
    yearOfStudy: r.year_of_study,
    consentAt: r.consent_at,
    issuedAt: r.issued_at,
    downloadCount: r.download_count,
    lastDownloadedAt: r.last_downloaded_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    studentId: r.student_id ?? null,
    studentCode: r.student_code ?? null,
    template: r.template_id ? { id: r.template_id, name: r.template_name ?? null } : null,
    emailStatus: r.email_status ?? null,
    emailError: r.email_error ?? null,
    emailedAt: r.emailed_at ?? null,
    session: { id: r.session_id, title: r.session_title, sessionDate: r.session_date, venue: r.session_venue, mode: r.session_mode },
  };

const eventToApi = (e) => ({
  id: e.id,
  type: e.type,
  detail: e.detail,
  createdAt: e.created_at,
  actor: e.actor_id ? { id: e.actor_id, name: e.actor_name } : null,
});

const REG_SELECT = `
  SELECT r.*, s.title AS session_title, s.session_date, s.venue AS session_venue, s.mode AS session_mode, t.name AS template_name,
    stu.student_code
  FROM certificate_registrations r JOIN sessions s ON s.id = r.session_id
  LEFT JOIN certificate_templates t ON t.id = r.template_id
  LEFT JOIN students stu ON stu.id = r.student_id`;

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Parse list/export filters for registrations. Returns { errors, where, params, page, pageSize }. */
function parseRegFilters(query) {
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
  const sessionId = str('sessionId');
  if (sessionId !== undefined) {
    if (/^\d{1,12}$/.test(sessionId)) {
      clauses.push('r.session_id = ?');
      params.push(Number(sessionId));
    } else errors.sessionId = 'Invalid value.';
  }
  const status = str('status');
  if (status !== undefined) {
    if (status === 'issued' || status === 'revoked') {
      clauses.push('r.status = ?');
      params.push(status);
    } else errors.status = 'Invalid value.';
  }
  const emailStatus = str('emailStatus');
  if (emailStatus !== undefined) {
    if (EMAIL_STATUSES.includes(emailStatus)) {
      clauses.push('r.email_status = ?');
      params.push(emailStatus);
    } else errors.emailStatus = 'Invalid value.';
  }
  const studentId = str('studentId');
  if (studentId !== undefined) {
    if (/^\d{1,12}$/.test(studentId)) {
      clauses.push('r.student_id = ?');
      params.push(Number(studentId));
    } else errors.studentId = 'Invalid value.';
  }
  const q = str('q');
  if (q !== undefined) {
    if (q.length > 100) errors.q = 'Search must be at most 100 characters.';
    else {
      const like = `%${escapeLike(q)}%`;
      let digits = q.replace(/\D/g, '');
      if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
      const phoneLike = digits.length >= 3 && !/[A-Za-z]/.test(q) ? `%${digits}%` : like;
      clauses.push('(r.name LIKE ? OR r.email LIKE ? OR r.college LIKE ? OR r.certificate_id LIKE ? OR r.phone LIKE ?)');
      params.push(like, like, like, like, phoneLike);
    }
  }
  const pageRaw = str('page');
  const sizeRaw = str('pageSize');
  const page = pageRaw === undefined ? 1 : Number(pageRaw);
  const pageSize = sizeRaw === undefined ? 25 : Number(sizeRaw);
  if (!Number.isInteger(page) || page < 1 || page > 100000) errors.page = 'Invalid page.';
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) errors.pageSize = 'Page size must be 1-100.';
  return { errors, where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params, page, pageSize };
}

const SESSION_SELECT = `SELECT s.*, u.name AS created_by_name,
    (SELECT COUNT(*) FROM certificate_registrations r WHERE r.session_id = s.id) AS registrations
  FROM sessions s LEFT JOIN users u ON u.id = s.created_by`;

function createCertificateRepo(db, config) {
  const now = () => new Date().toISOString();
  const regRow = (id) => db.get(`${REG_SELECT} WHERE r.id = ?`, [id]);
  const regBySessionEmail = (sessionId, email) =>
    db.get('SELECT * FROM certificate_registrations WHERE session_id = ? AND email = ?', [sessionId, email]);
  const recordsOf = async (studentId) =>
    (
      await db.get(
        `SELECT (SELECT COUNT(*) FROM certificate_registrations WHERE student_id = ?)
          + (SELECT COUNT(*) FROM inquiries WHERE student_id = ?) AS n`,
        [studentId, studentId],
      )
    ).n;
  const pruneStudent = (studentId) => pruneProfile(db, studentId);
  function logEvent(regId, type, detail, actorId) {
    if (!EVENT_TYPES.includes(type)) throw new Error(`unknown event type ${type}`);
    return db.run('INSERT INTO certificate_events (registration_id, type, detail, actor_id, created_at) VALUES (?, ?, ?, ?, ?)', [
      regId,
      type,
      detail ?? null,
      actorId ?? null,
      now(),
    ]);
  }
  // Lock a registration for a read-then-write change; resolves to its REG_SELECT row or undefined.
  async function lockReg(regId) {
    if (!(await db.get('SELECT id FROM certificate_registrations WHERE id = ? FOR UPDATE', [regId]))) return undefined;
    return regRow(regId);
  }

  // ---- sessions
  const getSession = async (id) => sessionToApi(await db.get(`${SESSION_SELECT} WHERE s.id = ?`, [id]));
  const listSessions = async () => (await db.all(`${SESSION_SELECT} ORDER BY s.session_date DESC, s.id DESC`)).map(sessionToApi);
  async function publicSessions() {
    const rows = await db.all(
      `SELECT id, title, session_date, venue, mode FROM sessions
      WHERE registration_open = 1 AND (closes_at IS NULL OR closes_at > ?) ORDER BY session_date DESC, id DESC`,
      [now()],
    );
    return rows.map((s) => ({ id: s.id, title: s.title, date: s.session_date, venue: s.venue || '', mode: s.mode }));
  }

  /** Raw row incl. code, only if the session is currently accepting registrations. */
  async function openSessionRow(id) {
    const s = await db.get('SELECT * FROM sessions WHERE id = ?', [id]);
    if (!s || s.registration_open !== 1) return null;
    if (s.closes_at && s.closes_at <= now()) return null;
    return s;
  }

  async function createSession(v, userId) {
    const t = now();
    const r = await db.run(
      `INSERT INTO sessions (title, session_date, venue, mode, description, code, registration_open, closes_at, template_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        v.title,
        v.sessionDate,
        v.venue ?? null,
        v.mode,
        v.description ?? null,
        v.code || generateSessionCode(),
        v.registrationOpen === false ? 0 : 1,
        v.closesAt ?? null,
        v.templateId ?? null,
        userId,
        t,
        t,
      ],
    );
    return getSession(r.insertId);
  }

  const SESSION_COLS = {
    title: 'title',
    sessionDate: 'session_date',
    venue: 'venue',
    mode: 'mode',
    description: 'description',
    code: 'code',
    registrationOpen: 'registration_open',
    closesAt: 'closes_at',
    templateId: 'template_id',
  };
  async function updateSession(id, values) {
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(values)) {
      if (!Object.hasOwn(SESSION_COLS, k)) continue;
      sets.push(`${SESSION_COLS[k]} = ?`);
      params.push(k === 'registrationOpen' ? (v ? 1 : 0) : (v ?? null));
    }
    if (sets.length) await db.run(`UPDATE sessions SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now(), id]);
    return getSession(id);
  }

  function deleteSession(id) {
    return db.transaction(async () => {
      if (!(await db.get('SELECT id FROM sessions WHERE id = ? FOR UPDATE', [id]))) return 'not_found';
      const { n } = await db.get('SELECT COUNT(*) AS n FROM certificate_registrations WHERE session_id = ?', [id]);
      if (n > 0) return 'has_registrations';
      return (await db.run('DELETE FROM sessions WHERE id = ?', [id])).changes > 0 ? 'deleted' : 'not_found';
    });
  }

  // ---- registrations
  const getReg = async (id) => regToApi(await regRow(id));
  const getRegRow = (id) => regRow(id);
  const findByCertificateId = (certId) => db.get(`${REG_SELECT} WHERE r.certificate_id = ?`, [certId]);
  const findBySessionEmail = (sessionId, email) => regBySessionEmail(sessionId, email);
  // One certificate per person per session: the same email, or the same mobile number under another email.
  async function findExistingRegistration(sessionId, email, phone) {
    const rows = await db.all(
      'SELECT * FROM certificate_registrations WHERE session_id = ? AND (email = ? OR phone = ?) ORDER BY id',
      [sessionId, email, phone || null],
    );
    return rows.find((r) => r.email.toLowerCase() === String(email).toLowerCase()) || rows[0];
  }
  const events = async (regId) =>
    (
      await db.all(
        `SELECT e.*, u.name AS actor_name FROM certificate_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.registration_id = ? ORDER BY e.created_at ASC, e.id ASC`,
        [regId],
      )
    ).map(eventToApi);

  /**
   * Create + issue. Resolves to { row, token, verification }. When the email or mobile number belongs
   * to a profile with different details, the registration is not linked to it yet and `verification`
   * ({ id, token }) is the profile verification opened for it. Rejects with a duplicate-key error on
   * (session_id, email).
   */
  function register(sessionId, v) {
    return db.transaction(async () => {
      const t = now();
      const link = await linkStudent(db, v, { now: t, idPrefix: config.studentIdPrefix });
      const { studentId } = link;
      const tpl = await db.get(
        `SELECT (SELECT template_id FROM sessions WHERE id = ?) AS session_template,
          (SELECT id FROM certificate_templates WHERE is_default = 1 AND archived = 0 ORDER BY id LIMIT 1) AS default_template`,
        [sessionId],
      );
      const templateId = tpl.session_template || tpl.default_template || null;
      const year = new Date().getFullYear();
      const { token, hash } = newDownloadToken();
      let id;
      // A clash of random certificate IDs is very unlikely; the unique key catches it and we draw again.
      for (let i = 0; !id; i++) {
        const certId = generateCertificateId(config.certIdPrefix, year);
        try {
          id = (
            await db.run(
              `INSERT INTO certificate_registrations (session_id, name, email, phone, college, stream, year_of_study,
                consent_at, certificate_id, download_token_hash, status, issued_at, created_at, updated_at, student_id, template_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?)`,
              [sessionId, v.name, v.email, v.phone, v.college, v.stream ?? null, v.yearOfStudy ?? null, t, certId, hash, t, t, t, studentId, templateId],
            )
          ).insertId;
        } catch (err) {
          if (!isDuplicate(err, 'uq_certreg_certificate_id') || i >= 9) throw err;
        }
      }
      await logEvent(id, 'registered', 'Registered and certificate issued', null);
      await addReferrals(id, v.referrals || [], t);
      const verification = link.conflict
        ? await openVerification(db, { registrationId: id }, link.conflict.student.id, v, link.conflict.conflicts, t)
        : null;
      return { row: await regRow(id), token, verification };
    });
  }

  // Friends named under "Refer a friend" become new enquiries for the admissions team. They have not filled
  // in a form themselves, so no student profile is created or changed from these details.
  async function addReferrals(regId, friends, t) {
    for (const f of friends) {
      await db.run(
        `INSERT INTO inquiries (name, phone, college, source, status, consent_at, created_at, updated_at, referred_by)
        VALUES (?, ?, ?, 'referral', 'new', ?, ?, ?, ?)`,
        [f.name, f.phone, f.college, t, t, t, regId],
      );
    }
  }

  /** The friends a registration referred, as their enquiries. */
  async function referrals(regId) {
    const rows = await db.all(
      `SELECT i.id, i.name, i.phone, i.college, i.status, i.created_at, u.name AS assigned_name
      FROM inquiries i LEFT JOIN users u ON u.id = i.assigned_to
      WHERE i.referred_by = ? ORDER BY i.id`,
      [regId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      college: r.college,
      status: r.status,
      assignedTo: r.assigned_name ?? null,
      createdAt: r.created_at,
    }));
  }

  /** Replace the download token (old links stop working). Resolves to the new token. */
  function rotateToken(regId, actorId) {
    return db.transaction(async () => {
      const { token, hash } = newDownloadToken();
      await db.run('UPDATE certificate_registrations SET download_token_hash = ?, updated_at = ? WHERE id = ?', [hash, now(), regId]);
      await logEvent(regId, 'link_rotated', 'New download link created; previous link disabled', actorId);
      return token;
    });
  }

  async function recordEmailed(regId, detail, actorId) {
    await logEvent(regId, 'emailed', detail, actorId);
  }

  /** Delivery state of the certificate email: pending | sent | failed | off (email not configured). */
  async function setEmailStatus(regId, status, { error = null, actorId = null, detail = null } = {}) {
    if (!EMAIL_STATUSES.includes(status)) throw new Error(`unknown email status ${status}`);
    await db.transaction(async () => {
      await db.run('UPDATE certificate_registrations SET email_status = ?, email_error = ?, emailed_at = COALESCE(?, emailed_at) WHERE id = ?', [
        status,
        error,
        status === 'sent' ? now() : null,
        regId,
      ]);
      if (status === 'sent') await logEvent(regId, 'emailed', detail, actorId);
      if (status === 'failed') await logEvent(regId, 'email_failed', error, actorId);
    });
  }

  async function lastEventAt(regId, type) {
    const r = await db.get('SELECT created_at FROM certificate_events WHERE registration_id = ? AND type = ? ORDER BY id DESC LIMIT 1', [regId, type]);
    return r ? r.created_at : null;
  }

  async function recordDownload(regId, previousCount) {
    await db.transaction(async () => {
      await db.run('UPDATE certificate_registrations SET download_count = download_count + 1, last_downloaded_at = ? WHERE id = ?', [now(), regId]);
      if (previousCount === 0) await logEvent(regId, 'downloaded', 'First downloaded by the student', null);
    });
  }

  /**
   * Correct the printed name and/or the email the certificate is sent to (an admin action). A new email
   * re-links the registration to that student's master record, which is not changed (an admin edits
   * profiles directly), and settles any pending profile verification. Resolves to the registration,
   * null if missing, or 'email_taken' when the session already has a registration with that email.
   */
  function correctDetails(regId, { name, email }, actorId) {
    return db.transaction(async () => {
      const row = await lockReg(regId);
      if (!row) return null;
      if (email && row.email !== email) {
        const clash = await regBySessionEmail(row.session_id, email);
        if (clash && clash.id !== regId) return 'email_taken';
        const t = now();
        const previous = row.student_id;
        let studentId;
        if (previous && (await recordsOf(previous)) === 1 && !(await db.get('SELECT id FROM students WHERE email = ?', [email]))) {
          // The old address was only ever used here (e.g. a typo): fix the master record too.
          await db.run('UPDATE students SET email = ?, updated_at = ? WHERE id = ?', [email, t, previous]);
          studentId = previous;
        } else {
          ({ studentId } = await linkStudent(
            db,
            { name: name || row.name, email, phone: row.phone, college: row.college, stream: row.stream, yearOfStudy: row.year_of_study },
            { now: t, idPrefix: config.studentIdPrefix, onConflict: 'keep' },
          ));
        }
        await closeForRecord(db, { registrationId: regId }, actorId, t);
        await db.run('UPDATE certificate_registrations SET email = ?, student_id = ?, updated_at = ? WHERE id = ?', [email, studentId, t, regId]);
        await logEvent(regId, 'details_corrected', `Email: ${row.email} → ${email}`, actorId);
        if (previous !== studentId) await pruneStudent(previous);
      }
      if (name && row.name !== name) {
        await db.run('UPDATE certificate_registrations SET name = ?, updated_at = ? WHERE id = ?', [name, now(), regId]);
        await logEvent(regId, 'name_corrected', `${row.name} → ${name}`, actorId);
      }
      return getReg(regId);
    });
  }

  const setStatus = (regId, status, reason) =>
    db.run('UPDATE certificate_registrations SET status = ?, revoked_reason = ?, updated_at = ? WHERE id = ?', [status, reason, now(), regId]);

  function revoke(regId, reason, actorId) {
    return db.transaction(async () => {
      const row = await lockReg(regId);
      if (!row) return null;
      if (row.status !== 'revoked') {
        await setStatus(regId, 'revoked', reason);
        await logEvent(regId, 'revoked', reason, actorId);
      }
      return getReg(regId);
    });
  }

  function reinstate(regId, actorId) {
    return db.transaction(async () => {
      const row = await lockReg(regId);
      if (!row) return null;
      if (row.status !== 'issued') {
        await setStatus(regId, 'issued', null);
        await logEvent(regId, 'reinstated', null, actorId);
      }
      return getReg(regId);
    });
  }

  /** Permanent erasure: registration + its activity log (and the student record if nothing else uses it). */
  function deleteReg(regId) {
    return db.transaction(async () => {
      const row = await regRow(regId);
      await db.run('DELETE FROM certificate_events WHERE registration_id = ?', [regId]);
      // The friends it referred stay as enquiries of their own; only the link to the erased student goes.
      await db.run('UPDATE inquiries SET referred_by = NULL WHERE referred_by = ?', [regId]);
      const deleted = (await db.run('DELETE FROM certificate_registrations WHERE id = ?', [regId])).changes > 0;
      if (deleted && row) await pruneStudent(row.student_id);
      return deleted;
    });
  }

  async function listRegs(f) {
    const [count, rows] = await Promise.all([
      db.get(`SELECT COUNT(*) AS n FROM certificate_registrations r ${f.where}`, f.params),
      db.all(`${REG_SELECT} ${f.where} ORDER BY r.issued_at DESC, r.id DESC LIMIT ? OFFSET ?`, [...f.params, f.pageSize, (f.page - 1) * f.pageSize]),
    ]);
    return { items: rows.map(regToApi), total: count.n, page: f.page, pageSize: f.pageSize };
  }

  async function exportRegs(f) {
    return (await db.all(`${REG_SELECT} ${f.where} ORDER BY s.session_date DESC, r.issued_at ASC, r.id ASC`, f.params)).map(regToApi);
  }

  async function stats(today = localDate()) {
    // Monday 00:00 (server local time) of the current week.
    const [y, m, d] = today.split('-').map(Number);
    const local = new Date(y, m - 1, d);
    const monday = new Date(y, m - 1, d - ((local.getDay() + 6) % 7));
    const one = async (sql, p = []) => (await db.get(sql, p)).n;
    const [recent, openSessions, registrationsThisWeek, issuedTotal, revoked, emailed, emailFailed, emailPending] = await Promise.all([
      db.all(`
        SELECT e.id, e.type, e.detail, e.created_at, e.actor_id, u.name AS actor_name,
          r.id AS registration_id, r.name, r.certificate_id, s.title AS session_title
        FROM certificate_events e
        JOIN certificate_registrations r ON r.id = e.registration_id
        JOIN sessions s ON s.id = r.session_id
        LEFT JOIN users u ON u.id = e.actor_id
        ORDER BY e.created_at DESC, e.id DESC LIMIT 10`),
      one('SELECT COUNT(*) AS n FROM sessions WHERE registration_open = 1 AND (closes_at IS NULL OR closes_at > ?)', [now()]),
      one('SELECT COUNT(*) AS n FROM certificate_registrations WHERE created_at >= ?', [monday.toISOString()]),
      one('SELECT COUNT(*) AS n FROM certificate_registrations'),
      one("SELECT COUNT(*) AS n FROM certificate_registrations WHERE status = 'revoked'"),
      one("SELECT COUNT(*) AS n FROM certificate_registrations WHERE email_status = 'sent'"),
      one("SELECT COUNT(*) AS n FROM certificate_registrations WHERE email_status = 'failed' AND status = 'issued'"),
      one("SELECT COUNT(*) AS n FROM certificate_registrations WHERE email_status = 'pending'"),
    ]);
    return {
      openSessions,
      registrationsThisWeek,
      issuedTotal,
      revoked,
      emailed,
      emailFailed,
      emailPending,
      recent: recent.map((e) => ({
        id: e.id,
        type: e.type,
        detail: e.type === 'name_corrected' ? null : e.detail,
        createdAt: e.created_at,
        actor: e.actor_id ? { id: e.actor_id, name: e.actor_name } : null,
        registrationId: e.registration_id,
        name: e.name,
        certificateId: e.certificate_id,
        sessionTitle: e.session_title,
      })),
    };
  }

  return {
    getSession,
    listSessions,
    publicSessions,
    openSessionRow,
    createSession,
    updateSession,
    deleteSession,
    getReg,
    getRegRow,
    findByCertificateId,
    findBySessionEmail,
    findExistingRegistration,
    events,
    register,
    referrals,
    rotateToken,
    recordEmailed,
    setEmailStatus,
    lastEventAt,
    recordDownload,
    correctDetails,
    revoke,
    reinstate,
    deleteReg,
    listRegs,
    exportRegs,
    stats,
  };
}

module.exports = { createCertificateRepo, parseRegFilters, regToApi, sessionToApi, REG_SELECT, EMAIL_STATUSES };
