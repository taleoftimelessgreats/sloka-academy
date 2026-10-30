'use strict';

const { isDuplicate } = require('./db');
const { nextStudentCode } = require('./studentIds');

// Profile field -> students column.
const COLUMNS = { name: 'name', email: 'email', phone: 'phone', college: 'college', stream: 'stream', yearOfStudy: 'year_of_study' };
const FIELDS = Object.keys(COLUMNS);

/** The profile fields of a submission (validated and normalised), blanks as null. */
const profileOf = (v) => Object.fromEntries(FIELDS.map((f) => [f, v[f] == null || v[f] === '' ? null : v[f]]));

// Letter case and extra spaces do not make a different name, college or email.
function comparable(field, value) {
  if (value == null || String(value).trim() === '') return null;
  const s = String(value).trim().replace(/\s+/g, ' ');
  return field === 'name' || field === 'college' || field === 'email' ? s.toLowerCase() : s;
}

/**
 * Compare a submission with the profiles that share its email or mobile number. Writes nothing; locks
 * the profiles it finds until the caller's transaction ends. Resolves to one of:
 *   { kind: 'new' }                          nobody has this email or number
 *   { kind: 'match', student, fill }         same details (fill: the profile's blanks the submission fills)
 *   { kind: 'conflict', student, conflicts } the email or number is known, but other details differ
 * When the email belongs to one profile and the number to another, the email's profile is the match
 * (it is where a verification code can be sent) and the number is a conflict.
 */
async function compareWithProfiles(db, v) {
  const p = profileOf(v);
  if (!p.email && !p.phone) return { kind: 'new' };
  const found = await db.all('SELECT * FROM students WHERE email = ? OR phone = ? FOR UPDATE', [p.email, p.phone]);
  const byEmail = p.email ? found.find((s) => comparable('email', s.email) === comparable('email', p.email)) : undefined;
  const byPhone = p.phone ? found.find((s) => s.phone === p.phone) : undefined;
  const student = byEmail || byPhone;
  if (!student) return { kind: 'new' };

  const conflicts = [];
  const fill = {};
  for (const f of FIELDS) {
    const mine = comparable(f, p[f]);
    if (mine === null) continue;
    const theirs = comparable(f, student[COLUMNS[f]]);
    if (f === 'phone' && byPhone && byPhone.id !== student.id) conflicts.push(f); // the number is someone else's
    else if (theirs === null) fill[f] = p[f];
    else if (theirs !== mine) conflicts.push(f);
  }
  return conflicts.length ? { kind: 'conflict', student, conflicts } : { kind: 'match', student, fill };
}

async function setDetails(db, studentId, changes, now) {
  const keys = Object.keys(changes);
  if (!keys.length) return;
  await db.run(`UPDATE students SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(', ')}, updated_at = GREATEST(updated_at, ?) WHERE id = ?`, [
    ...keys.map((k) => changes[k]),
    now,
    studentId,
  ]);
}

/** A new profile with its own Student ID. An email or number that already belongs to someone is left off. */
async function createProfile(db, v, { now = new Date().toISOString(), idPrefix = 'SLK' } = {}) {
  return db.transaction(async () => {
    const p = profileOf(v);
    if (p.email && (await db.get('SELECT id FROM students WHERE email = ?', [p.email]))) p.email = null;
    if (p.phone && (await db.get('SELECT id FROM students WHERE phone = ?', [p.phone]))) p.phone = null;
    const code = await nextStudentCode(db, idPrefix, now);
    const r = await db.run(
      `INSERT INTO students (student_code, name, email, phone, college, stream, year_of_study, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, p.name, p.email, p.phone, p.college, p.stream, p.yearOfStudy, now, now],
    );
    return r.insertId;
  });
}

/**
 * Put a submission on a known profile. Blanks on the profile are always filled; with update: true the
 * submitted details also replace the profile's (after the student verified them, or an admin accepted
 * them), except an email or number that belongs to another student.
 */
async function attachToProfile(db, studentId, v, { update = false, now = new Date().toISOString() } = {}) {
  await db.transaction(async () => {
    const student = await db.get('SELECT * FROM students WHERE id = ? FOR UPDATE', [studentId]);
    if (!student) throw new Error(`student #${studentId} not found`);
    const p = profileOf(v);
    const changes = {};
    for (const f of FIELDS) {
      if (p[f] === null) continue;
      const current = student[COLUMNS[f]];
      if (current !== null && (!update || comparable(f, current) === comparable(f, p[f]))) continue;
      if (f === 'email' || f === 'phone') {
        const owner = await db.get(`SELECT id FROM students WHERE ${f} = ? AND id <> ?`, [p[f], studentId]);
        if (owner) continue;
      }
      changes[f] = p[f];
    }
    await setDetails(db, studentId, changes, now);
  });
}

/**
 * Find or create the master student record for a submission (joins the caller's transaction).
 * Each email and each mobile number belongs to at most one student, so a returning student never gets
 * a second profile or Student ID. A profile is never overwritten by a submission:
 *   - nobody has the email or number: a new profile with a new Student ID;
 *   - same details: linked to that profile (its blanks filled);
 *   - the email or number is known but other details differ: depends on onConflict:
 *       'flag' (default)  nothing is linked or changed; studentId is null and `conflict` says which profile
 *                         and fields, so the caller can record the submission as pending verification;
 *       'keep'            linked to that profile, which stays as it is (blanks filled).
 * Resolves to { studentId, created, conflict }.
 */
function linkStudent(db, v, { now = new Date().toISOString(), idPrefix = 'SLK', onConflict = 'flag' } = {}) {
  return db.transaction(async () => {
    try {
      const m = await compareWithProfiles(db, v);
      if (m.kind === 'new') return { studentId: await createProfile(db, v, { now, idPrefix }), created: true, conflict: null };
      if (m.kind === 'conflict' && onConflict === 'flag') {
        return { studentId: null, created: false, conflict: { student: m.student, conflicts: m.conflicts } };
      }
      await attachToProfile(db, m.student.id, v, { now });
      return { studentId: m.student.id, created: false, conflict: null };
    } catch (err) {
      // The same person registered at the same moment and their profile was saved first: running the
      // whole transaction again finds it.
      if (isDuplicate(err)) err.retryable = true;
      throw err;
    }
  });
}

/**
 * Delete a profile that no longer has any registrations, enquiries or open verifications
 * (e.g. after its only record was erased or moved to another profile).
 */
async function pruneStudent(db, studentId) {
  if (!studentId) return;
  const { n } = await db.get(
    `SELECT (SELECT COUNT(*) FROM certificate_registrations WHERE student_id = ?)
      + (SELECT COUNT(*) FROM inquiries WHERE student_id = ?)
      + (SELECT COUNT(*) FROM profile_verifications WHERE student_id = ? AND status IN ('pending', 'failed')) AS n`,
    [studentId, studentId, studentId],
  );
  if (n > 0) return;
  await db.run('DELETE FROM profile_verifications WHERE student_id = ?', [studentId]); // closed ones: history of this profile
  await db.run('DELETE FROM students WHERE id = ?', [studentId]);
}

module.exports = { linkStudent, attachToProfile, createProfile, compareWithProfiles, pruneStudent, profileOf, PROFILE_COLUMNS: COLUMNS };
