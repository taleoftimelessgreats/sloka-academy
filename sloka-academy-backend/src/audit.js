'use strict';

const { isValidDateString } = require('./util');

/**
 * The audit log: who changed what, when, and the old -> new values. Written inside the caller's transaction
 * (db.transaction shares it), so a change and its log entry are saved together.
 */

// What the log records, with the labels the portal shows (and filters by).
const ENTITIES = [
  ['enrollment', 'Registrations'],
  ['payment', 'Payments'],
  ['student', 'Student master'],
  ['offer_template', 'Offer letter templates'],
  ['course', 'Course master'],
  ['associate', 'Associates'],
  ['role', 'Roles'],
  ['permission_override', 'Permission overrides'],
  ['certificate', 'Certificates'],
  ['certificate_template', 'Certificate designs'],
  ['enquiry', 'Enquiries'],
  ['registration_flag', 'Registration conflicts'],
  ['settings', 'Settings'],
];
const ENTITY_IDS = ENTITIES.map(([id]) => id);

const same = (a, b) => (a ?? null) === (b ?? null) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** [{ field, from, to }] for the fields of `after` whose value differs in `before` (labels: field -> label). */
function diff(before, after, labels = {}) {
  const out = [];
  for (const [key, to] of Object.entries(after)) {
    const from = before ? before[key] : undefined;
    if (to === undefined || same(from, to)) continue;
    out.push({ field: labels[key] || key, from: from ?? null, to: to ?? null });
  }
  return out;
}

const toApi = (r) => ({
  id: r.id,
  entity: r.entity,
  entityId: r.entity_id,
  action: r.action,
  summary: r.summary,
  changes: r.changes ? JSON.parse(r.changes) : [],
  actor: r.actor_id ? { id: r.actor_id, name: r.actor_name ?? null } : null,
  createdAt: r.created_at,
});

function createAudit(db) {
  /** Record one change. changes: [{ field, from, to }] (see diff). Returns nothing. */
  async function log({ actorId = null, entity, entityId = null, action, summary, changes = [] }) {
    await db.run('INSERT INTO audit_log (actor_id, entity, entity_id, action, summary, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      actorId,
      entity,
      entityId == null ? null : String(entityId),
      action,
      String(summary).slice(0, 500),
      changes.length ? JSON.stringify(changes) : null,
      new Date().toISOString(),
    ]);
  }

  /** Filters: entity, entityId, actorId, from/to (YYYY-MM-DD, UTC days), page. Resolves to { errors } or a page. */
  async function list(query) {
    const errors = {};
    const clauses = [];
    const params = [];
    const str = (k) => (typeof query[k] === 'string' && query[k].trim() !== '' ? query[k].trim() : undefined);
    const entity = str('entity');
    if (entity !== undefined) {
      if (ENTITY_IDS.includes(entity)) {
        clauses.push('a.entity = ?');
        params.push(entity);
      } else errors.entity = 'Invalid value.';
    }
    const entityId = str('entityId');
    if (entityId !== undefined) {
      if (entityId.length <= 64) {
        clauses.push('a.entity_id = ?');
        params.push(entityId);
      } else errors.entityId = 'Invalid value.';
    }
    const actorId = str('actorId');
    if (actorId !== undefined) {
      if (/^\d{1,12}$/.test(actorId)) {
        clauses.push('a.actor_id = ?');
        params.push(Number(actorId));
      } else errors.actorId = 'Invalid value.';
    }
    for (const [key, op, suffix] of [['from', '>=', 'T00:00:00.000Z'], ['to', '<=', 'T23:59:59.999Z']]) {
      const v = str(key);
      if (v === undefined) continue;
      if (isValidDateString(v)) {
        clauses.push(`a.created_at ${op} ?`);
        params.push(`${v}${suffix}`);
      } else errors[key] = 'Enter a valid date.';
    }
    const page = str('page') === undefined ? 1 : Number(str('page'));
    if (!Number.isInteger(page) || page < 1 || page > 100000) errors.page = 'Invalid page.';
    if (Object.keys(errors).length) return { errors };
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const pageSize = 50;
    const [count, rows] = await Promise.all([
      db.get(`SELECT COUNT(*) AS n FROM audit_log a ${where}`, params),
      db.all(
        `SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ${where}
        ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
    ]);
    return { items: rows.map(toApi), total: count.n, page, pageSize };
  }

  return { log, list };
}

module.exports = { createAudit, diff, ENTITIES };
