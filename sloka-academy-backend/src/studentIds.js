'use strict';

const { localDate } = require('./util');

/**
 * Student IDs: <PREFIX>-STU-<year first seen>-<number>, e.g. SLK-STU-2026-00042.
 * Numbers count up per year from a stored counter, so an ID is never handed out twice, even after
 * the student's data is erased. Once assigned, an ID never changes.
 */
function formatStudentId(prefix, year, n) {
  return `${prefix}-STU-${year}-${String(n).padStart(5, '0')}`;
}

/**
 * Take the next Student ID for a student first seen at `now` (an ISO timestamp). The counter row stays
 * locked until the surrounding transaction commits, so two registrations never get the same number.
 */
function nextStudentCode(db, prefix, now = new Date().toISOString()) {
  const year = localDate(new Date(now)).slice(0, 4);
  const name = `student:${year}`;
  return db.transaction(async () => {
    await db.run('INSERT INTO id_sequences (name, value) VALUES (?, 1) ON DUPLICATE KEY UPDATE value = value + 1', [name]);
    const { value } = await db.get('SELECT value FROM id_sequences WHERE name = ?', [name]);
    return formatStudentId(prefix, year, value);
  });
}

/** IDs for students who have none (e.g. imported from an older database), oldest first. Returns how many were assigned. */
async function assignMissingStudentIds(db, prefix) {
  const missing = await db.all('SELECT id, created_at FROM students WHERE student_code IS NULL ORDER BY created_at, id');
  if (!missing.length) return 0;
  await db.transaction(async () => {
    for (const s of missing) {
      const code = await nextStudentCode(db, prefix, s.created_at);
      await db.run('UPDATE students SET student_code = ? WHERE id = ? AND student_code IS NULL', [code, s.id]);
    }
  });
  return missing.length;
}

module.exports = { formatStudentId, nextStudentCode, assignMissingStudentIds };
