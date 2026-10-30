'use strict';

const C = require('./constants');
const { localDate } = require('./util');
const { linkStudent, pruneStudent: pruneProfile } = require('./studentMatch');
const { openVerification, closeForRecord } = require('./profileVerification');

// API field -> column. Used for updates and as the sort whitelist.
const COLUMNS = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  college: 'college',
  stream: 'stream',
  yearOfStudy: 'year_of_study',
  domain: 'domain',
  plan: 'plan',
  status: 'status',
  assignedTo: 'assigned_to',
  nextFollowUp: 'next_follow_up',
};

const SORTS = {
  createdAt: 'i.created_at',
  updatedAt: 'i.updated_at',
  nextFollowUp: 'i.next_follow_up',
  name: 'i.name', // the collation is case-insensitive
  status: 'i.status',
};

const CLOSED_SQL = C.CLOSED_STATUSES.map((s) => `'${s}'`).join(', '); // constants only, never user input

const SELECT = `
  SELECT i.*, au.name AS assigned_name, cu.name AS created_by_name, sx.student_code
  FROM inquiries i
  LEFT JOIN users au ON au.id = i.assigned_to
  LEFT JOIN users cu ON cu.id = i.created_by
  LEFT JOIN students sx ON sx.id = i.student_id`;

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    college: row.college,
    stream: row.stream,
    yearOfStudy: row.year_of_study,
    domain: row.domain,
    plan: row.plan,
    source: row.source,
    brochure: row.brochure,
    message: row.message,
    status: row.status,
    assignedTo: row.assigned_to ? { id: row.assigned_to, name: row.assigned_name } : null,
    nextFollowUp: row.next_follow_up,
    consentAt: row.consent_at,
    createdBy: row.created_by ? { id: row.created_by, name: row.created_by_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    studentId: row.student_id ?? null,
    studentCode: row.student_code ?? null,
  };
}

// Backslash is LIKE's default escape character in MySQL/TiDB.
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Parse list/export filters from a query object. Returns { errors, where, params, order, page, pageSize }.
 * All user values are bound as parameters; only whitelisted SQL fragments are concatenated.
 */
function parseFilters(query, { userId, today = localDate() } = {}) {
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
  const enumFilter = (key, column, ids, allowNone) => {
    const v = str(key);
    if (v === undefined) return;
    if (allowNone && v === 'none') clauses.push(`i.${column} IS NULL`);
    else if (ids.includes(v)) {
      clauses.push(`i.${column} = ?`);
      params.push(v);
    } else errors[key] = 'Invalid value.';
  };

  enumFilter('status', 'status', C.STATUS_IDS, false);
  enumFilter('source', 'source', C.SOURCE_IDS, false);
  enumFilter('stream', 'stream', C.STREAM_IDS, true);
  enumFilter('plan', 'plan', C.PLAN_IDS, true);
  enumFilter('yearOfStudy', 'year_of_study', C.YEAR_IDS, true);

  const assigned = str('assignedTo');
  if (assigned !== undefined) {
    if (assigned === 'none') clauses.push('i.assigned_to IS NULL');
    else if (assigned === 'me' && userId) {
      clauses.push('i.assigned_to = ?');
      params.push(userId);
    } else if (/^\d{1,12}$/.test(assigned)) {
      clauses.push('i.assigned_to = ?');
      params.push(Number(assigned));
    } else errors.assignedTo = 'Invalid value.';
  }

  const followUp = str('followUp');
  if (followUp !== undefined) {
    const open = `i.status NOT IN (${CLOSED_SQL})`;
    if (followUp === 'today') clauses.push(`i.next_follow_up = ? AND ${open}`);
    else if (followUp === 'overdue') clauses.push(`i.next_follow_up < ? AND ${open}`);
    else if (followUp === 'due') clauses.push(`i.next_follow_up <= ? AND ${open}`);
    else errors.followUp = 'Invalid value.';
    if (!errors.followUp) params.push(today);
  }

  const q = str('q');
  if (q !== undefined) {
    if (q.length > 100) errors.q = 'Search must be at most 100 characters.';
    else {
      const like = `%${escapeLike(q)}%`;
      let digits = q.replace(/\D/g, '');
      if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
      const phoneLike = digits.length >= 3 ? `%${digits}%` : like;
      clauses.push('(i.name LIKE ? OR i.email LIKE ? OR i.college LIKE ? OR i.phone LIKE ?)');
      params.push(like, like, like, phoneLike);
    }
  }

  const sortKey = str('sort') || 'createdAt';
  if (!Object.hasOwn(SORTS, sortKey)) errors.sort = 'Invalid sort.';
  const dirRaw = (str('dir') || (sortKey === 'nextFollowUp' || sortKey === 'name' ? 'asc' : 'desc')).toLowerCase();
  if (dirRaw !== 'asc' && dirRaw !== 'desc') errors.dir = 'Invalid sort direction.';
  const sortSql = SORTS[sortKey] || SORTS.createdAt;
  const dir = dirRaw === 'asc' ? 'ASC' : 'DESC';
  const order = `ORDER BY ${sortSql} IS NULL, ${sortSql} ${dir}, i.id ${dir}`; // blanks last either way

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
    order,
    page,
    pageSize,
  };
}

const NOTE_SELECT = `
  SELECT n.id, n.kind, n.body, n.created_at, n.author_id, u.name AS author_name
  FROM inquiry_notes n LEFT JOIN users u ON u.id = n.author_id`;

function createInquiryRepo(db, { studentIdPrefix = 'SLK' } = {}) {
  const addNoteRow = (inquiryId, authorId, kind, body, at) =>
    db.run('INSERT INTO inquiry_notes (inquiry_id, author_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)', [inquiryId, authorId, kind, body, at]);

  const pruneStudent = (studentId) => pruneProfile(db, studentId);

  const noteToApi = (n) => ({
    id: n.id,
    kind: n.kind,
    body: n.body,
    createdAt: n.created_at,
    author: n.author_id ? { id: n.author_id, name: n.author_name } : null,
  });

  /**
   * Resolves to { id, verification }. When the email or mobile number belongs to a profile with
   * different details, the enquiry is not linked yet and `verification` ({ id, token }) is the profile
   * verification opened for it.
   */
  function create(values, { createdBy = null } = {}) {
    const now = new Date().toISOString();
    return db.transaction(async () => {
      const link = await linkStudent(db, values, { now, idPrefix: studentIdPrefix });
      const { studentId } = link;
      const r = await db.run(
        `INSERT INTO inquiries (name, phone, email, college, stream, year_of_study, domain, plan, source, brochure, message,
          status, assigned_to, next_follow_up, consent_at, created_by, created_at, updated_at, student_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          values.name,
          values.phone,
          values.email ?? null,
          values.college ?? null,
          values.stream ?? null,
          values.yearOfStudy ?? null,
          values.domain ?? null,
          values.plan ?? null,
          values.source,
          values.brochure ?? null,
          values.message ?? null,
          values.status || 'new',
          values.assignedTo ?? null,
          values.nextFollowUp ?? null,
          now, // consent_at
          createdBy,
          now,
          now,
          studentId,
        ],
      );
      if (values.note) await addNoteRow(r.insertId, createdBy, 'note', values.note, now);
      const verification = link.conflict
        ? await openVerification(db, { inquiryId: r.insertId }, link.conflict.student.id, values, link.conflict.conflicts, now)
        : null;
      return { id: r.insertId, verification };
    });
  }

  async function get(id) {
    return toApi(await db.get(`${SELECT} WHERE i.id = ?`, [id]));
  }

  async function notes(id) {
    return (await db.all(`${NOTE_SELECT} WHERE n.inquiry_id = ? ORDER BY n.created_at ASC, n.id ASC`, [id])).map(noteToApi);
  }

  async function list(filters) {
    const [count, rows] = await Promise.all([
      db.get(`SELECT COUNT(*) AS n FROM inquiries i ${filters.where}`, filters.params),
      db.all(`${SELECT} ${filters.where} ${filters.order} LIMIT ? OFFSET ?`, [
        ...filters.params,
        filters.pageSize,
        (filters.page - 1) * filters.pageSize,
      ]),
    ]);
    return { items: rows.map(toApi), total: count.n, page: filters.page, pageSize: filters.pageSize };
  }

  async function exportRows(filters) {
    const [rows, allNotes] = await Promise.all([
      db.all(`${SELECT} ${filters.where} ${filters.order}`, filters.params),
      db.all(
        `SELECT n.inquiry_id, n.kind, n.body, n.created_at, u.name AS author_name
        FROM inquiry_notes n
        JOIN inquiries i ON i.id = n.inquiry_id
        LEFT JOIN users u ON u.id = n.author_id
        ${filters.where}
        ORDER BY n.inquiry_id, n.created_at, n.id`,
        filters.params,
      ),
    ]);
    const byInquiry = new Map();
    for (const n of allNotes) {
      if (!byInquiry.has(n.inquiry_id)) byInquiry.set(n.inquiry_id, []);
      byInquiry.get(n.inquiry_id).push(n);
    }
    return { rows: rows.map(toApi), notesByInquiry: byInquiry };
  }

  function describeChange(key, before, after) {
    const show = (kind, v) => (v == null || v === '' ? '—' : C.label(kind, v));
    switch (key) {
      case 'status':
        return `Status: ${show('status', before)} → ${show('status', after)}`;
      case 'plan':
        return `Plan: ${show('plan', before)} → ${show('plan', after)}`;
      case 'stream':
        return `Stream: ${show('stream', before)} → ${show('stream', after)}`;
      case 'yearOfStudy':
        return `Year of study: ${show('yearOfStudy', before)} → ${show('yearOfStudy', after)}`;
      case 'nextFollowUp':
        return `Next follow-up: ${before || '—'} → ${after || '—'}`;
      default:
        return null; // contact details: logged by name only (old values are not retained)
    }
  }

  /** Apply a validated partial update. `assigneeName(id)` resolves (or promises) names for the change log. */
  function update(id, values, { userId, assigneeName }) {
    return db.transaction(async () => {
      // Lock the enquiry so that two people editing it at once are applied one after the other.
      if (!(await db.get('SELECT id FROM inquiries WHERE id = ? FOR UPDATE', [id]))) return null;
      const before = await get(id);
      const sets = [];
      const params = [];
      const log = [];
      const edited = [];
      for (const [key, value] of Object.entries(values)) {
        if (!Object.hasOwn(COLUMNS, key)) continue;
        const prev = key === 'assignedTo' ? (before.assignedTo ? before.assignedTo.id : null) : before[key];
        if ((prev ?? null) === (value ?? null)) continue;
        sets.push(`${COLUMNS[key]} = ?`);
        params.push(value ?? null);
        if (key === 'assignedTo') {
          log.push(`Assigned to: ${before.assignedTo ? before.assignedTo.name : '—'} → ${value ? await assigneeName(value) : '—'}`);
        } else {
          const line = describeChange(key, prev, value);
          if (line) log.push(line);
          else edited.push(key);
        }
      }
      if (!sets.length) return before;
      const now = new Date().toISOString();
      await db.run(`UPDATE inquiries SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now, id]);
      if (edited.length) log.push(`Edited: ${edited.join(', ')}`);
      await addNoteRow(id, userId, 'change', log.join('\n'), now);
      // Corrected contact details may belong to another student. The edit changes this enquiry only:
      // profiles are never overwritten from here (admins edit them on the Students page).
      if (['name', 'email', 'phone', 'college', 'stream', 'yearOfStudy'].some((k) => Object.hasOwn(values, k))) {
        const after = await get(id);
        await closeForRecord(db, { inquiryId: id }, userId, now);
        const link = await linkStudent(db, after, { now, idPrefix: studentIdPrefix });
        let studentId = link.studentId;
        if (link.conflict) {
          if (link.conflict.student.id === before.studentId) studentId = before.studentId; // still that student's enquiry
          else await openVerification(db, { inquiryId: id }, link.conflict.student.id, after, link.conflict.conflicts, now);
        }
        if (studentId !== before.studentId) {
          await db.run('UPDATE inquiries SET student_id = ? WHERE id = ?', [studentId, id]);
          await pruneStudent(before.studentId);
        }
      }
      return get(id);
    });
  }

  function addNote(id, body, userId) {
    return db.transaction(async () => {
      const now = new Date().toISOString();
      const r = await addNoteRow(id, userId, 'note', body, now);
      await db.run('UPDATE inquiries SET updated_at = ? WHERE id = ?', [now, id]);
      return noteToApi(await db.get(`${NOTE_SELECT} WHERE n.id = ?`, [r.insertId]));
    });
  }

  function remove(id) {
    return db.transaction(async () => {
      const before = await get(id);
      await db.run('DELETE FROM inquiry_notes WHERE inquiry_id = ?', [id]);
      const deleted = (await db.run('DELETE FROM inquiries WHERE id = ?', [id])).changes > 0;
      if (deleted && before) await pruneStudent(before.studentId);
      return deleted;
    });
  }

  async function stats(today = localDate()) {
    const one = async (sql, p = []) => (await db.get(sql, p)).n;
    const conversion = async (column, kind, order) => {
      const rows = await db.all(`
        SELECT ${column} AS k, COUNT(*) AS total,
          SUM(CASE WHEN status = 'pre-registered' THEN 1 ELSE 0 END) AS pre,
          SUM(CASE WHEN status = 'enrolled' THEN 1 ELSE 0 END) AS enrolled
        FROM inquiries GROUP BY ${column}`);
      const byKey = new Map(rows.map((r) => [r.k, r]));
      const keys = [...order.filter((k) => byKey.has(k)), ...(byKey.has(null) ? [null] : [])];
      return keys.map((k) => {
        const r = byKey.get(k);
        return {
          [kind]: k,
          label: k == null ? 'Not specified' : C.label(kind, k),
          total: r.total,
          preRegistered: r.pre,
          enrolled: r.enrolled,
          enrolledPct: r.total ? Math.round((r.enrolled / r.total) * 1000) / 10 : 0,
        };
      });
    };
    const [statusRows, total, dueToday, overdue, byStream, byPlan] = await Promise.all([
      db.all('SELECT status, COUNT(*) AS n FROM inquiries GROUP BY status'),
      one('SELECT COUNT(*) AS n FROM inquiries'),
      one(`SELECT COUNT(*) AS n FROM inquiries WHERE next_follow_up = ? AND status NOT IN (${CLOSED_SQL})`, [today]),
      one(`SELECT COUNT(*) AS n FROM inquiries WHERE next_follow_up < ? AND status NOT IN (${CLOSED_SQL})`, [today]),
      conversion('stream', 'stream', C.STREAM_IDS),
      conversion('plan', 'plan', C.PLAN_IDS),
    ]);
    const statusCounts = new Map(statusRows.map((r) => [r.status, r.n]));
    return {
      today,
      total,
      newCount: statusCounts.get('new') || 0,
      dueToday,
      overdue,
      byStatus: C.STATUSES.map(([id, text]) => ({ status: id, label: text, count: statusCounts.get(id) || 0 })),
      byStream,
      byPlan,
    };
  }

  async function distinctDomains() {
    const rows = await db.all(
      "SELECT domain, COUNT(*) AS n FROM inquiries WHERE domain IS NOT NULL AND domain <> '' GROUP BY domain ORDER BY n DESC, domain LIMIT 50",
    );
    return rows.map((r) => r.domain);
  }

  return { create, get, notes, list, exportRows, update, addNote, remove, stats, distinctDomains };
}

module.exports = { createInquiryRepo, parseFilters, toApi, COLUMNS, SORTS };
