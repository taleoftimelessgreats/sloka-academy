'use strict';

const C = require('./constants');
const { detachFromStudent } = require('./profileVerification');
const { regToApi } = require('./certificateRepo');
const { toApi: inquiryToApi } = require('./inquiryRepo');

const toApi = (s) =>
  s && {
    id: s.id,
    studentCode: s.student_code ?? null,
    name: s.name,
    email: s.email,
    phone: s.phone,
    college: s.college,
    stream: s.stream,
    yearOfStudy: s.year_of_study,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    certificates: s.cert_count ?? undefined,
    enquiries: s.enquiry_count ?? undefined,
    latestEnquiryStatus: s.enquiry_status ?? undefined,
    lastActivityAt: s.last_activity ?? undefined,
    // Programme tags (constants PROGRAMS), from the student's records.
    programs: s.cert_count === undefined ? undefined : [s.cert_count > 0 && 'career-guidance', s.enquiry_count > 0 && 'internship'].filter(Boolean),
    // Registrations or enquiries that matched this profile with different details and wait for verification.
    pendingVerifications: s.pending_count ?? undefined,
  };

// Counts and the latest activity across both programmes.
const SELECT = `
  SELECT st.*,
    (SELECT COUNT(*) FROM certificate_registrations r WHERE r.student_id = st.id) AS cert_count,
    (SELECT COUNT(*) FROM inquiries i WHERE i.student_id = st.id) AS enquiry_count,
    (SELECT COUNT(*) FROM profile_verifications pv WHERE pv.student_id = st.id AND pv.status IN ('pending', 'failed')) AS pending_count,
    (SELECT i.status FROM inquiries i WHERE i.student_id = st.id ORDER BY i.created_at DESC, i.id DESC LIMIT 1) AS enquiry_status,
    GREATEST(st.created_at,
        COALESCE((SELECT MAX(r.created_at) FROM certificate_registrations r WHERE r.student_id = st.id), ''),
        COALESCE((SELECT MAX(i.created_at) FROM inquiries i WHERE i.student_id = st.id), '')) AS last_activity
  FROM students st`;

const SORTS = {
  recent: 'last_activity DESC, st.id DESC',
  name: 'st.name ASC, st.id ASC', // the collation is case-insensitive
  created: 'st.created_at DESC, st.id DESC',
};

const PROGRAMS = {
  'career-guidance': 'EXISTS (SELECT 1 FROM certificate_registrations r WHERE r.student_id = st.id)',
  internship: 'EXISTS (SELECT 1 FROM inquiries i WHERE i.student_id = st.id)',
};

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Parse list/export filters. Returns { errors, where, params, order, page, pageSize }. */
function parseStudentFilters(query) {
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

  const q = str('q');
  if (q !== undefined) {
    if (q.length > 100) errors.q = 'Search must be at most 100 characters.';
    else {
      const like = `%${escapeLike(q)}%`;
      let digits = q.replace(/\D/g, '');
      if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
      const phoneLike = digits.length >= 3 && !/[A-Za-z]/.test(q) ? `%${digits}%` : like;
      clauses.push('(st.name LIKE ? OR st.email LIKE ? OR st.college LIKE ? OR st.phone LIKE ? OR st.student_code LIKE ?)');
      params.push(like, like, like, phoneLike, like);
    }
  }
  const program = str('program');
  if (program !== undefined) {
    if (Object.hasOwn(PROGRAMS, program)) clauses.push(PROGRAMS[program]);
    else errors.program = 'Invalid value.';
  }
  for (const [key, column, ids] of [
    ['stream', 'stream', C.STREAM_IDS],
    ['yearOfStudy', 'year_of_study', C.YEAR_IDS],
  ]) {
    const v = str(key);
    if (v === undefined) continue;
    if (v === 'none') clauses.push(`st.${column} IS NULL`);
    else if (ids.includes(v)) {
      clauses.push(`st.${column} = ?`);
      params.push(v);
    } else errors[key] = 'Invalid value.';
  }
  const sessionId = str('sessionId');
  if (sessionId !== undefined) {
    if (/^\d{1,12}$/.test(sessionId)) {
      clauses.push('EXISTS (SELECT 1 FROM certificate_registrations r WHERE r.student_id = st.id AND r.session_id = ?)');
      params.push(Number(sessionId));
    } else errors.sessionId = 'Invalid value.';
  }

  const sort = str('sort') || 'recent';
  if (!Object.hasOwn(SORTS, sort)) errors.sort = 'Invalid sort.';
  const pageRaw = str('page');
  const sizeRaw = str('pageSize');
  const page = pageRaw === undefined ? 1 : Number(pageRaw);
  const pageSize = sizeRaw === undefined ? 25 : Number(sizeRaw);
  if (!Number.isInteger(page) || page < 1 || page > 100000) errors.page = 'Invalid page.';
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) errors.pageSize = 'Page size must be 1-100.';
  return {
    errors,
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
    order: `ORDER BY ${SORTS[sort] || SORTS.recent}`,
    page,
    pageSize,
  };
}

const PROFILE_COLUMNS = { name: 'name', email: 'email', phone: 'phone', college: 'college', stream: 'stream', yearOfStudy: 'year_of_study' };

function createStudentRepo(db, { studentIdPrefix = 'SLK' } = {}) {
  const getRow = (id) => db.get(`${SELECT} WHERE st.id = ?`, [id]);
  const get = async (id) => toApi(await getRow(id));
  const regIds = async (id) => (await db.all('SELECT id FROM certificate_registrations WHERE student_id = ?', [id])).map((r) => r.id);
  const inqIds = async (id) => (await db.all('SELECT id FROM inquiries WHERE student_id = ?', [id])).map((r) => r.id);

  async function detail(id) {
    const [student, certs, enquiries] = await Promise.all([
      get(id),
      db.all(
        `SELECT r.*, s.title AS session_title, s.session_date, s.venue AS session_venue, s.mode AS session_mode
        FROM certificate_registrations r JOIN sessions s ON s.id = r.session_id
        WHERE r.student_id = ? ORDER BY r.issued_at DESC, r.id DESC`,
        [id],
      ),
      db.all(
        `SELECT i.*, au.name AS assigned_name, cu.name AS created_by_name
        FROM inquiries i LEFT JOIN users au ON au.id = i.assigned_to LEFT JOIN users cu ON cu.id = i.created_by
        WHERE i.student_id = ? ORDER BY i.created_at DESC, i.id DESC`,
        [id],
      ),
    ]);
    if (!student) return null;
    return { student, certificates: certs.map(regToApi), enquiries: enquiries.map(inquiryToApi) };
  }

  async function list(f) {
    const [count, rows] = await Promise.all([
      db.get(`SELECT COUNT(*) AS n FROM students st ${f.where}`, f.params),
      db.all(`${SELECT} ${f.where} ${f.order} LIMIT ? OFFSET ?`, [...f.params, f.pageSize, (f.page - 1) * f.pageSize]),
    ]);
    return { items: rows.map(toApi), total: count.n, page: f.page, pageSize: f.pageSize };
  }

  const exportRows = async (f) => (await db.all(`${SELECT} ${f.where} ${f.order}`, f.params)).map(toApi);

  /** Validated partial update of the profile. Resolves to the student, null if missing, 'email_taken' or 'phone_taken'. */
  function update(id, values) {
    return db.transaction(async () => {
      if (!(await db.get('SELECT id FROM students WHERE id = ? FOR UPDATE', [id]))) return null;
      if (values.email) {
        const other = await db.get('SELECT id FROM students WHERE email = ?', [values.email]);
        if (other && other.id !== id) return 'email_taken';
      }
      if (values.phone) {
        const other = await db.get('SELECT id FROM students WHERE phone = ?', [values.phone]);
        if (other && other.id !== id) return 'phone_taken';
      }
      const sets = [];
      const params = [];
      for (const [k, v] of Object.entries(values)) {
        if (!Object.hasOwn(PROFILE_COLUMNS, k)) continue;
        sets.push(`${PROFILE_COLUMNS[k]} = ?`);
        params.push(v ?? null);
      }
      if (sets.length) await db.run(`UPDATE students SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, new Date().toISOString(), id]);
      return get(id);
    });
  }

  /**
   * Permanent erasure: the student, their registrations/certificates and enquiries, with all logs.
   * Records from other people that were waiting to be verified against this profile get profiles of their own.
   */
  function remove(id) {
    return db.transaction(async () => {
      const finishDetach = await detachFromStudent(db, id, studentIdPrefix);
      for (const regId of await regIds(id)) {
        await db.run('DELETE FROM certificate_events WHERE registration_id = ?', [regId]);
        await db.run('UPDATE inquiries SET referred_by = NULL WHERE referred_by = ?', [regId]); // friends they referred stay
        await db.run('DELETE FROM certificate_registrations WHERE id = ?', [regId]);
      }
      for (const inqId of await inqIds(id)) {
        await db.run('DELETE FROM inquiry_notes WHERE inquiry_id = ?', [inqId]);
        await db.run('DELETE FROM inquiries WHERE id = ?', [inqId]);
      }
      const deleted = (await db.run('DELETE FROM students WHERE id = ?', [id])).changes > 0;
      await finishDetach();
      return deleted;
    });
  }

  const count = async () => (await db.get('SELECT COUNT(*) AS n FROM students')).n;

  return { get, detail, list, exportRows, update, remove, count };
}

module.exports = { createStudentRepo, parseStudentFilters, studentToApi: toApi };
