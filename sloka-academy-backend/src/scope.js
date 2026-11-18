'use strict';

/**
 * What a role's data scope (own / team / all records) lets someone see, for each kind of record. `ids` are the
 * associates the scope covers (auth.scopeUserIds: the user, plus everyone reporting to them for 'team'), or null
 * for every record. The SQL fragments go into WHERE clauses; their values are bound as parameters.
 *
 *  - Internship registrations belong to their BD Associate.
 *  - Enquiries belong to whoever they are assigned to (or who entered them). Unassigned enquiries are new leads
 *    anyone may pick up, so every scope sees them.
 *  - A student is visible through their registrations and enquiries in scope.
 */

const none = { sql: '', params: [] };

/** Registrations (alias e). */
const registrationScope = (ids) => (ids ? { sql: 'e.bd_associate_id IN (?)', params: [ids] } : none);

/** Enquiries (alias i, or another alias). */
const enquiryScope = (ids, a = 'i') =>
  ids ? { sql: `(${a}.assigned_to IN (?) OR ${a}.assigned_to IS NULL OR ${a}.created_by IN (?))`, params: [ids, ids] } : none;

/** Students (alias st). */
function studentScope(ids) {
  if (!ids) return none;
  const enquiry = enquiryScope(ids, 'si');
  return {
    sql: `(EXISTS (SELECT 1 FROM enrollments se WHERE se.student_id = st.id AND se.bd_associate_id IN (?))
      OR EXISTS (SELECT 1 FROM inquiries si WHERE si.student_id = st.id AND ${enquiry.sql}))`,
    params: [ids, ...enquiry.params],
  };
}

/** Whether an enquiry (API shape) is in scope. */
const enquiryVisible = (inquiry, ids) =>
  !ids || !inquiry.assignedTo || ids.includes(inquiry.assignedTo.id) || Boolean(inquiry.createdBy && ids.includes(inquiry.createdBy.id));

module.exports = { registrationScope, enquiryScope, studentScope, enquiryVisible };
