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

// Roles and what they may do are in the database; see permissions.js.

const DEPARTMENTS = [
  ['bd-sales', 'BD / Sales'],
  ['operations', 'Operations'],
  ['accounts', 'Accounts'],
  ['academics', 'Academics'],
  ['marketing', 'Marketing'],
  ['hr', 'HR'],
  ['management', 'Management'],
  ['other', 'Other'],
];

const GENDERS = [
  ['female', 'Female'],
  ['male', 'Male'],
  ['other', 'Other'],
  ['undisclosed', 'Prefer not to say'],
];

const PAYMENT_MODES = [
  ['upi', 'UPI'],
  ['bank-transfer', 'Bank transfer (NEFT / IMPS / RTGS)'],
  ['card', 'Card'],
  ['payment-link', 'Payment link / gateway'],
  ['cash', 'Cash'],
  ['cheque', 'Cheque / DD'],
  ['other', 'Other'],
];

// An enrollment's payment status follows its payments (registrationRepo.js). Overdue is a flag on top:
// the balance due date has passed and a balance remains.
// The payment policy, word for word on invoices, offer letters, emails, the portal and the website
// (sloka-academy-frontend/src/config/site.ts paymentPolicy).
const PAYMENT_POLICY = ['All payments are non-refundable.', 'Payments are collected exclusively for training purposes.'];

const PAYMENT_STATUSES = [
  ['slot-confirmed', 'Slot Confirmed'],
  ['partially-paid', 'Partially Paid'],
  ['fully-paid', 'Fully Paid'],
];

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
  program: labelMap(PROGRAMS),
  department: labelMap(DEPARTMENTS),
  gender: labelMap(GENDERS),
  paymentMode: labelMap(PAYMENT_MODES),
  paymentStatus: labelMap(PAYMENT_STATUSES),
  profileField: labelMap(PROFILE_FIELDS),
};

function label(kind, id) {
  if (id == null || id === '') return '';
  return LABELS[kind].get(id) || id;
}

const toOptions = (pairs) => pairs.map(([id, text]) => ({ id, label: text }));

module.exports = {
  STATUSES,
  PROGRAMS,
  STREAM_IDS: ids(STREAMS),
  YEAR_IDS: ids(YEARS),
  PLAN_IDS: ids(PLANS),
  SOURCE_IDS: ids(SOURCES),
  STATUS_IDS: ids(STATUSES),
  DEPARTMENT_IDS: ids(DEPARTMENTS),
  GENDER_IDS: ids(GENDERS),
  PAYMENT_MODE_IDS: ids(PAYMENT_MODES),
  PAYMENT_STATUS_IDS: ids(PAYMENT_STATUSES),
  PAYMENT_POLICY,
  PUBLIC_SOURCES,
  MANUAL_SOURCES,
  CLOSED_STATUSES,
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
      departments: toOptions(DEPARTMENTS),
      genders: toOptions(GENDERS),
      paymentModes: toOptions(PAYMENT_MODES),
      paymentStatuses: toOptions(PAYMENT_STATUSES),
      paymentPolicy: PAYMENT_POLICY.slice(),
      programs: toOptions(PROGRAMS),
      profileFields: toOptions(PROFILE_FIELDS),
      closedStatuses: CLOSED_STATUSES.slice(),
    };
  },
};
