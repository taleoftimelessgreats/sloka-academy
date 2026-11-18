'use strict';

/**
 * Role-based access control. A permission is `<module>.<action>`; every API route checks one.
 * Roles live in the database (Roles & permissions screen); these are the modules and actions they choose
 * from, and the roles the database starts with.
 */

const ACTIONS = [
  ['view', 'View'],
  ['create', 'Create'],
  ['edit', 'Edit'],
  ['delete', 'Delete'],
  ['export', 'Export'],
];

// Each module lists the actions that mean something for it, with what that action allows.
const MODULES = [
  {
    id: 'registrations',
    label: 'Internship registrations',
    actions: {
      view: 'See registered students, their enrollments and payment ledgers',
      create: 'Register students (check the student master, record the token amount)',
      edit: 'Change fee, due date, batch, BD Associate and payments after submission',
      delete: 'Delete an enrollment with its payments and offer letter',
      export: 'Download registrations as CSV',
    },
  },
  { id: 'payments', label: 'Payments', actions: { create: 'Record later payments against an enrollment' } },
  {
    id: 'offerLetters',
    label: 'Offer letters',
    actions: { view: 'Download offer letters and see their delivery log', create: 'Generate, regenerate and email offer letters' },
  },
  {
    id: 'offerTemplates',
    label: 'Offer letter templates',
    actions: {
      view: 'See offer letter templates',
      create: 'Upload templates',
      edit: 'Edit, preview, activate and assign templates; set the signatory',
      delete: 'Delete unused templates',
    },
  },
  { id: 'courses', label: 'Course master', actions: { view: 'See course domains', create: 'Add course domains', edit: 'Rename, retire and set durations' } },
  {
    id: 'students',
    label: 'Participant (student) data',
    actions: {
      view: "See participants' and students' personal details wherever they appear: the student master and profiles, certificate participants, session participant lists and exports",
      create: 'Settle profile verifications by linking or giving a new profile',
      edit: "Edit a student's master details (logged), or accept changed details",
      delete: 'Permanently erase a student and everything linked to them',
      export: 'Download students as CSV',
    },
  },
  {
    id: 'enquiries',
    label: 'Enquiry data',
    actions: {
      view: 'See enquiries wherever they appear: the enquiries list and details, enquiries on student profiles, friends referred on certificates',
      create: 'Add phone and walk-in enquiries',
      edit: 'Work enquiries: status, follow-up, assignment, notes, details',
      delete: 'Permanently delete enquiries',
      export: 'Download enquiries as CSV',
    },
  },
  {
    id: 'sessions',
    label: 'Career guidance sessions',
    actions: { view: 'See sessions and their codes', create: 'Create sessions', edit: 'Edit sessions and regenerate codes', delete: 'Delete empty sessions', export: 'Download a session as CSV' },
  },
  {
    id: 'certificates',
    label: 'Certificates',
    actions: {
      view: 'See, download and re-send certificates (with Participant (student) data → View, which shows who they belong to)',
      edit: 'Revoke, reinstate, retry failed emails and correct printed details',
      delete: 'Permanently delete registrations',
      export: 'Download certificates as CSV',
    },
  },
  {
    id: 'certTemplates',
    label: 'Certificate designs',
    actions: { view: 'See certificate designs', create: 'Upload designs', edit: 'Edit layouts, archive, set the default', delete: 'Delete unused designs' },
  },
  { id: 'settings', label: 'Settings', actions: { view: 'See integrations; test and sync the Google Sheet', edit: 'Connect the Google Sheet (sees its script)' } },
  {
    id: 'associates',
    label: 'Associates',
    actions: { view: 'See associates', create: 'Add associates (sends their invite)', edit: 'Edit associates and reset passwords', delete: 'Deactivate and reactivate associates' },
  },
  { id: 'roles', label: 'Roles & permissions', actions: { view: 'See roles and permissions', edit: 'Change roles, permissions and per-associate overrides' } },
  { id: 'audit', label: 'Audit log', actions: { view: 'See the audit log' } },
];

const ALL_PERMISSIONS = MODULES.flatMap((m) => Object.keys(m.actions).map((a) => `${m.id}.${a}`));
const isPermission = (p) => ALL_PERMISSIONS.includes(p);

const SCOPES = [
  ['own', 'Own records'],
  ['team', 'Team records'],
  ['all', 'All records'],
];
const SCOPE_IDS = SCOPES.map(([id]) => id);

const except = (list, ...drop) => list.filter((p) => !drop.includes(p));

const SUPER_ADMIN = 'super_admin';

const COUNSELLOR = [
  'enquiries.view', 'enquiries.create', 'enquiries.edit',
  'students.view',
  'sessions.view',
  'certificates.view',
  'certTemplates.view',
];

// The roles a new database starts with. `system` roles cannot be deleted. Super Admin always has every
// permission. Manager and Counsellor are the portal's original roles, kept with what they could do.
const DEFAULT_ROLES = [
  {
    key: SUPER_ADMIN,
    name: 'Super Admin',
    description: 'Everything, including roles and permissions. Cannot be restricted.',
    scope: 'all',
    system: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'admin',
    name: 'Admin',
    description: 'Runs the portal: registrations, payments, students, associates, templates. Cannot change roles or manage Super Admins.',
    scope: 'all',
    system: true,
    permissions: except(ALL_PERMISSIONS, 'roles.view', 'roles.edit'),
  },
  {
    key: 'bd_manager',
    name: 'BD Manager',
    description: "Registers students and sends offer letters for their team; sees and exports the team's registrations.",
    scope: 'team',
    system: true,
    permissions: [
      'registrations.view', 'registrations.create', 'registrations.export',
      'offerLetters.view', 'offerLetters.create',
      'courses.view',
      'enquiries.view', 'enquiries.create', 'enquiries.edit',
    ],
  },
  {
    key: 'bd_associate',
    name: 'BD Associate',
    description: 'Registers students and sends offer letters for their own registrations.',
    scope: 'own',
    system: true,
    permissions: [
      'registrations.view', 'registrations.create',
      'offerLetters.view', 'offerLetters.create',
      'courses.view',
      'enquiries.view', 'enquiries.create', 'enquiries.edit',
    ],
  },
  {
    key: 'accounts',
    name: 'Accounts',
    description: 'Sees every registration, records and corrects payments and fees, exports.',
    scope: 'all',
    system: true,
    permissions: ['registrations.view', 'registrations.edit', 'registrations.export', 'payments.create', 'offerLetters.view', 'courses.view'],
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Runs sessions, certificate designs and associates; works enquiries.',
    scope: 'all',
    system: false,
    permissions: [
      ...COUNSELLOR,
      'students.create',
      'sessions.create', 'sessions.edit',
      'certificates.edit',
      'certTemplates.create', 'certTemplates.edit',
      'settings.view',
      'associates.view', 'associates.create', 'associates.edit',
    ],
  },
  {
    key: 'counsellor',
    name: 'Counsellor',
    description: 'Works enquiries; views students, sessions and certificates.',
    scope: 'all',
    system: false,
    permissions: COUNSELLOR,
  },
];

/** A role's permissions with an associate's overrides ({ permission: true | false }) applied. */
function effectivePermissions(roleKey, rolePermissions, overrides = {}) {
  if (roleKey === SUPER_ADMIN) return new Set(ALL_PERMISSIONS);
  const set = new Set(rolePermissions.filter(isPermission));
  for (const [p, granted] of Object.entries(overrides)) {
    if (!isPermission(p)) continue;
    if (granted) set.add(p);
    else set.delete(p);
  }
  return set;
}

/** Modules and actions as the Roles & permissions screen shows them. */
const catalogue = () => ({
  actions: ACTIONS.map(([id, label]) => ({ id, label })),
  modules: MODULES.map((m) => ({ id: m.id, label: m.label, actions: Object.entries(m.actions).map(([id, description]) => ({ id, description })) })),
  scopes: SCOPES.map(([id, label]) => ({ id, label })),
});

module.exports = {
  ALL_PERMISSIONS,
  SCOPE_IDS,
  SUPER_ADMIN,
  DEFAULT_ROLES,
  isPermission,
  effectivePermissions,
  catalogue,
};
