'use strict';

// Single source of truth for enumerations and their human labels.
// Order matters: it is the display order in the dashboard and the CSV.

const STREAMS = [
  ['computer-science', 'Computer Science'],
  ['management', 'Management'],
  ['pharmacy', 'Pharmacy'],
  ['life-sciences', 'Life Sciences'],
  ['civil', 'Civil Engineering'],
  ['mechanical', 'Mechanical Engineering'],
  ['electronics', 'Electronics'],
  ['eee', 'EEE'],
  ['commerce', 'Commerce'],
  ['more', 'More'],
];

const YEARS = [
  ['year-1', '1st year'],
  ['year-2', '2nd year'],
  ['year-3', '3rd year'],
  ['year-4', '4th year'],
  ['year-5', '5th year'],
  ['graduated', 'Graduated'],
  ['working', 'Working professional'],
];

const PLANS = [
  ['basic', 'Basic Foundation'],
  ['premium', 'Premium Foundation'],
  ['undecided', 'Undecided'],
];

const SOURCES = [
  ['pre-register', 'Pre-register'],
  ['contact', 'Contact'],
  ['brochure', 'Brochure download'],
  ['phone-call', 'Phone call'],
  ['walk-in', 'Walk-in'],
  ['referral', 'Referral'], // a friend named on a career guidance certificate registration
];

const STATUSES = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['counselled', 'Counselled'],
  ['pre-registered', 'Pre-registered'],
  ['enrolled', 'Enrolled'],
  ['not-interested', 'Not interested'],
];

// Programmes a student can take part in. A student's programme tags come from their records:
// certificate registrations are Career Guidance, enquiries are the Internship Course Program.
const PROGRAMS = [
  ['career-guidance', 'Career Guidance'],
  ['internship', 'Internship Course Program'],
];

// Student profile fields compared when a registration matches an existing profile.
const PROFILE_FIELDS = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['phone', 'Mobile number'],
  ['college', 'College'],
  ['stream', 'Stream'],
  ['yearOfStudy', 'Year of study'],
];

const ROLES = [
  ['counsellor', 'Counsellor'],
  ['manager', 'Manager'],
  ['admin', 'Admin'],
];

// What each role may do beyond working enquiries and viewing students, sessions and certificates
// (which every signed-in user can). Managers have every admin power except exporting student data,
// editing or deleting records, and deactivating staff (users are never hard-deleted) or touching admins.
const PERMISSIONS = {
  manage: ['admin', 'manager'], // sessions, certificate designs, settings, staff accounts, revoking certificates
  export: ['admin'], // CSV downloads, and choosing the Google Sheet that receives every registration
  editRecords: ['admin'], // student profiles (incl. accepting changed details for one), a certificate's printed name and email
  deleteRecords: ['admin'], // permanent erasure; deleting sessions and certificate designs
  deactivateUsers: ['admin'],
  manageAdmins: ['admin'], // create admin accounts, change or reset the password of an admin
};

const can = (role, permission) => Object.hasOwn(PERMISSIONS, permission) && PERMISSIONS[permission].includes(role);
const permissionsFor = (role) => Object.keys(PERMISSIONS).filter((p) => can(role, p));

const PUBLIC_SOURCES = ['pre-register', 'contact', 'brochure'];
const MANUAL_SOURCES = ['phone-call', 'walk-in'];
// Enquiries in these statuses no longer need follow-up (excluded from "due today" / "overdue").
const CLOSED_STATUSES = ['enrolled', 'not-interested'];

const ids = (pairs) => pairs.map(([id]) => id);
const labelMap = (pairs) => new Map(pairs);

const LABELS = {
  stream: labelMap(STREAMS),
  yearOfStudy: labelMap(YEARS),
  plan: labelMap(PLANS),
  source: labelMap(SOURCES),
  status: labelMap(STATUSES),
  role: labelMap(ROLES),
  program: labelMap(PROGRAMS),
  profileField: labelMap(PROFILE_FIELDS),
};

function label(kind, id) {
  if (id == null || id === '') return '';
  return LABELS[kind].get(id) || id;
}

const toOptions = (pairs) => pairs.map(([id, text]) => ({ id, label: text }));

module.exports = {
  STREAMS,
  YEARS,
  PLANS,
  SOURCES,
  STATUSES,
  ROLES,
  PROGRAMS,
  PROFILE_FIELDS,
  PROGRAM_IDS: ids(PROGRAMS),
  STREAM_IDS: ids(STREAMS),
  YEAR_IDS: ids(YEARS),
  PLAN_IDS: ids(PLANS),
  SOURCE_IDS: ids(SOURCES),
  STATUS_IDS: ids(STATUSES),
  ROLE_IDS: ids(ROLES),
  PUBLIC_SOURCES,
  MANUAL_SOURCES,
  CLOSED_STATUSES,
  PERMISSIONS,
  can,
  permissionsFor,
  LABELS,
  label,
  meta() {
    return {
      streams: toOptions(STREAMS),
      years: toOptions(YEARS),
      plans: toOptions(PLANS),
      sources: toOptions(SOURCES),
      manualSources: toOptions(SOURCES.filter(([id]) => MANUAL_SOURCES.includes(id))),
      statuses: toOptions(STATUSES),
      roles: toOptions(ROLES),
      programs: toOptions(PROGRAMS),
      profileFields: toOptions(PROFILE_FIELDS),
      closedStatuses: CLOSED_STATUSES.slice(),
    };
  },
};
