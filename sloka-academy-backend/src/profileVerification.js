'use strict';

const crypto = require('node:crypto');
const { attachToProfile, createProfile, profileOf } = require('./studentMatch');

const OPEN = ['pending', 'failed'];
const RESOLUTIONS = ['link', 'update', 'new_profile'];

// "ravi.teja@gmail.com" -> "r•••@gmail.com"
function maskEmail(address) {
  if (!address) return null;
  const at = address.lastIndexOf('@');
  return at < 1 ? '•••' : `${address[0]}•••${address.slice(at)}`;
}

/**
 * Record a submission that matched a profile with different details (joins the caller's transaction).
 * record: { registrationId } or { inquiryId }. Resolves to { id, token }.
 */
async function openVerification(db, record, studentId, submitted, conflicts, now = new Date().toISOString()) {
  const token = crypto.randomBytes(16).toString('hex');
  const r = await db.run(
    `INSERT INTO profile_verifications (token, registration_id, inquiry_id, student_id, proposed, conflicts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [token, record.registrationId ?? null, record.inquiryId ?? null, studentId, JSON.stringify(profileOf(submitted)), JSON.stringify(conflicts), now, now],
  );
  return { id: r.insertId, token };
}

/** Close a record's open verification because staff changed the record itself. */
async function closeForRecord(db, record, userId = null, now = new Date().toISOString()) {
  const [column, id] = record.registrationId ? ['registration_id', record.registrationId] : ['inquiry_id', record.inquiryId];
  await db.run(
    `UPDATE profile_verifications SET status = 'resolved', resolution = 'edited', resolved_by = ?, resolved_at = ?, code_hash = NULL, updated_at = ?
      WHERE ${column} = ? AND status IN ('pending', 'failed')`,
    [userId, now, now, id],
  );
}

const SELECT = `
  SELECT pv.*, s.student_code, s.name AS s_name, s.email AS s_email, s.phone AS s_phone, s.college AS s_college,
    s.stream AS s_stream, s.year_of_study AS s_year, u.name AS resolved_by_name,
    r.certificate_id, ses.title AS session_title, ses.session_date, i.source AS inquiry_source,
    COALESCE(r.created_at, i.created_at) AS record_created_at
  FROM profile_verifications pv
  JOIN students s ON s.id = pv.student_id
  LEFT JOIN users u ON u.id = pv.resolved_by
  LEFT JOIN certificate_registrations r ON r.id = pv.registration_id
  LEFT JOIN sessions ses ON ses.id = r.session_id
  LEFT JOIN inquiries i ON i.id = pv.inquiry_id`;

// Staff view. The proposed details are what the student submitted; the profile is unchanged until resolved.
const toApi = (v) =>
  v && {
    id: v.id,
    status: v.status,
    record: v.registration_id
      ? { type: 'certificate', id: v.registration_id, program: 'career-guidance', certificateId: v.certificate_id, title: v.session_title, date: v.session_date, createdAt: v.record_created_at }
      : { type: 'enquiry', id: v.inquiry_id, program: 'internship', source: v.inquiry_source, createdAt: v.record_created_at },
    student: {
      id: v.student_id,
      studentCode: v.student_code,
      name: v.s_name,
      email: v.s_email,
      phone: v.s_phone,
      college: v.s_college,
      stream: v.s_stream,
      yearOfStudy: v.s_year,
    },
    proposed: JSON.parse(v.proposed),
    conflicts: JSON.parse(v.conflicts),
    codeSentTo: v.sent_to,
    codesSent: v.sends,
    lastSentAt: v.last_sent_at,
    wrongCodes: v.attempts,
    resolution: v.resolution,
    resolvedBy: v.resolved_by ? { id: v.resolved_by, name: v.resolved_by_name } : null,
    resolvedAt: v.resolved_at,
    createdAt: v.created_at,
  };

/**
 * Verifying changed details: a one-time code goes to the email already on the profile; entering it on
 * the website updates the profile and links the record. Otherwise the record stays "pending verification"
 * until a staff member decides.
 */
function createProfileVerification({ db, config, notifier, quota = null, logger = console }) {
  const minutes = config.verificationCodeMinutes ?? 10;
  const maxWrong = config.verificationMaxWrongCodes ?? 5;
  const maxSends = config.verificationMaxCodes ?? 3;
  const resendAfterMs = config.verificationResendAfterMs ?? 60 * 1000;
  const now = () => new Date().toISOString();
  const hash = (token, code) => crypto.createHmac('sha256', config.jwtSecret).update(`${token}:${code}`).digest('hex');
  const canEmail = () => Boolean(notifier && notifier.studentEmailEnabled && typeof notifier.sendVerificationCode === 'function');

  const rowByToken = (token) => db.get(`${SELECT} WHERE pv.token = ?`, [token]);
  const publicView = (v, codeSent, reason = null) => ({
    token: v.token,
    codeSent,
    sentTo: codeSent ? maskEmail(v.sent_to) : null,
    expiresAt: codeSent ? v.code_expires_at : null,
    reason: codeSent ? null : reason,
  });

  /** Email a new code to the profile's address. Resolves to what the website may show. */
  async function sendCode(id) {
    const v = await db.get(`${SELECT} WHERE pv.id = ?`, [id]);
    if (!v || !OPEN.includes(v.status)) throw new Error(`verification #${id} is not open`);
    if (!v.s_email) return publicView(v, false, 'no_email');
    if (!canEmail()) return publicView(v, false, 'email_off');
    if (quota && (await quota.remaining(v.s_email)) === 0) return publicView(v, false, 'email_limit');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const expires = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    try {
      await notifier.sendVerificationCode({
        to: v.s_email,
        name: v.s_name,
        code,
        minutes,
        what: v.registration_id ? 'a Career Guidance registration' : 'an Internship Course Program enquiry',
      });
    } catch (err) {
      if (err.code === 'EMAIL_DAILY_LIMIT') return publicView(v, false, 'email_limit');
      logger.error(`[verification] code email for #${id} failed: ${err.message}`);
      return publicView(v, false, 'email_failed');
    }
    const t = now();
    await db.run(
      `UPDATE profile_verifications SET sent_to = ?, code_hash = ?, code_expires_at = ?, attempts = 0, sends = sends + 1,
        last_sent_at = ?, updated_at = ? WHERE id = ?`,
      [v.s_email, hash(v.token, code), expires, t, t, id],
    );
    return publicView({ ...v, sent_to: v.s_email, code_expires_at: expires }, true);
  }

  /** Link the record and close the verification (inside a transaction). Resolves to the student id. */
  async function settle(v, resolution, userId) {
    const t = now();
    const proposed = JSON.parse(v.proposed);
    let studentId = v.student_id;
    if (resolution === 'new_profile') studentId = await createProfile(db, proposed, { now: t, idPrefix: config.studentIdPrefix });
    else await attachToProfile(db, v.student_id, proposed, { update: resolution === 'update' || resolution === 'code', now: t });
    const [table, recordId] = v.registration_id ? ['certificate_registrations', v.registration_id] : ['inquiries', v.inquiry_id];
    await db.run(`UPDATE ${table} SET student_id = ?, updated_at = ? WHERE id = ?`, [studentId, t, recordId]);
    await db.run(
      `UPDATE profile_verifications SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ?, code_hash = NULL, updated_at = ?
        WHERE id = ?`,
      [resolution === 'code' ? 'verified' : 'resolved', resolution, userId, t, t, v.id],
    );
    return studentId;
  }

  /**
   * The student enters the code. Resolves to { status: 'verified', studentId } or { error, ... }:
   * wrong_code (attemptsLeft), expired, locked (too many wrong codes: staff will decide), closed, not_found.
   */
  function verify(token, code) {
    return db.transaction(async () => {
      const v = await db.get(`${SELECT} WHERE pv.token = ? FOR UPDATE`, [token]);
      if (!v) return { error: 'not_found' };
      if (v.status === 'failed') return { error: 'locked' };
      if (v.status !== 'pending') return { error: 'closed' };
      if (!v.code_hash || v.code_expires_at <= now()) return { error: 'expired' };
      const given = Buffer.from(hash(token, code), 'hex');
      if (!crypto.timingSafeEqual(given, Buffer.from(v.code_hash, 'hex'))) {
        const attempts = v.attempts + 1;
        const locked = attempts >= maxWrong;
        await db.run(`UPDATE profile_verifications SET attempts = ?, status = ?, code_hash = ${locked ? 'NULL' : 'code_hash'}, updated_at = ? WHERE id = ?`, [
          attempts,
          locked ? 'failed' : 'pending',
          now(),
          v.id,
        ]);
        return locked ? { error: 'locked' } : { error: 'wrong_code', attemptsLeft: maxWrong - attempts };
      }
      const studentId = await settle(v, 'code', null);
      const { student_code: studentCode } = await db.get('SELECT student_code FROM students WHERE id = ?', [studentId]);
      return { status: 'verified', studentId: studentCode };
    });
  }

  /** Send a new code. Resolves to { verification } or { error, retryAfter? }. */
  async function resend(token) {
    const v = await rowByToken(token);
    if (!v) return { error: 'not_found' };
    if (v.status === 'failed') return { error: 'locked' };
    if (v.status !== 'pending') return { error: 'closed' };
    if (v.sends >= maxSends) return { error: 'resend_limit' };
    const wait = v.last_sent_at ? Date.parse(v.last_sent_at) + resendAfterMs - Date.now() : 0;
    if (wait > 0) return { error: 'too_soon', retryAfter: Math.ceil(wait / 1000) };
    return { verification: await sendCode(v.id) };
  }

  /**
   * Staff decision on an open verification: 'link' (keep the profile as it is), 'update' (accept the
   * submitted details) or 'new_profile' (a different person: a profile of their own). Resolves to the
   * verification, or null if it is not open.
   */
  function resolve(id, resolution, userId) {
    if (!RESOLUTIONS.includes(resolution)) throw new Error(`unknown resolution ${resolution}`);
    return db.transaction(async () => {
      const v = await db.get(`${SELECT} WHERE pv.id = ? FOR UPDATE`, [id]);
      if (!v || !OPEN.includes(v.status)) return null;
      await settle(v, resolution, userId);
      return toApi(await db.get(`${SELECT} WHERE pv.id = ?`, [id]));
    });
  }

  async function list({ status = 'open', studentId = null } = {}) {
    const where = [];
    const params = [];
    if (status === 'open') where.push("pv.status IN ('pending', 'failed')");
    else if (status === 'closed') where.push("pv.status IN ('verified', 'resolved')");
    if (studentId) {
      where.push('pv.student_id = ?');
      params.push(studentId);
    }
    const rows = await db.all(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY pv.created_at DESC, pv.id DESC LIMIT 200`, params);
    return rows.map(toApi);
  }

  const get = async (id) => toApi(await db.get(`${SELECT} WHERE pv.id = ?`, [id]));
  /** The open verification of a record, if any. record: { registrationId } or { inquiryId }. */
  async function forRecord(record) {
    const [column, id] = record.registrationId ? ['registration_id', record.registrationId] : ['inquiry_id', record.inquiryId];
    return toApi(await db.get(`${SELECT} WHERE pv.${column} = ? AND pv.status IN ('pending', 'failed') ORDER BY pv.id DESC LIMIT 1`, [id])) ?? null;
  }
  const openCount = async () => (await db.get("SELECT COUNT(*) AS n FROM profile_verifications WHERE status IN ('pending', 'failed')")).n;

  return { sendCode, verify, resend, resolve, list, get, forRecord, openCount };
}

/**
 * A student is being erased (joins the caller's transaction): the records waiting to be verified against
 * their profile get profiles of their own, and the profile's verification history goes with it.
 * Resolves to a function to call once the student is deleted: it gives those profiles the email and
 * mobile number that were the erased student's.
 */
async function detachFromStudent(db, studentId, idPrefix) {
  const open = await db.all("SELECT * FROM profile_verifications WHERE student_id = ? AND status IN ('pending', 'failed') FOR UPDATE", [studentId]);
  const moved = [];
  for (const v of open) {
    const proposed = JSON.parse(v.proposed);
    const newId = await createProfile(db, proposed, { idPrefix });
    const [table, recordId] = v.registration_id ? ['certificate_registrations', v.registration_id] : ['inquiries', v.inquiry_id];
    await db.run(`UPDATE ${table} SET student_id = ? WHERE id = ?`, [newId, recordId]);
    moved.push([newId, proposed]);
  }
  await db.run('DELETE FROM profile_verifications WHERE student_id = ?', [studentId]);
  return async () => {
    for (const [id, proposed] of moved) await attachToProfile(db, id, proposed);
  };
}

module.exports = { createProfileVerification, openVerification, closeForRecord, detachFromStudent, maskEmail, RESOLUTIONS };
