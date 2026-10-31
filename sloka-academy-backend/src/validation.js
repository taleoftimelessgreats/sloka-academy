'use strict';

const C = require('./constants');
const { isValidDateString } = require('./util');

// Control characters, bidi overrides and line/paragraph separators are replaced in single-line fields.
const SINGLE_LINE_JUNK = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;
// Multi-line fields keep \n and \t.
const MULTI_LINE_JUNK = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9]$/;

const charCount = (s) => [...s].length;

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// ---- field validators: (raw, label) => { value } | { error } -------------------------------

function text({ min = 0, max, multiline = false }) {
  return (raw, label) => {
    if (typeof raw !== 'string') return { error: `${label} must be text.` };
    const value = multiline
      ? raw.replace(/\r\n?/g, '\n').replace(MULTI_LINE_JUNK, '').trim()
      : raw.replace(SINGLE_LINE_JUNK, ' ').trim();
    const n = charCount(value);
    if (n < min || n > max) {
      return { error: min > 0 ? `${label} must be between ${min} and ${max} characters.` : `${label} must be at most ${max} characters.` };
    }
    return { value };
  };
}

function oneOf(ids, message) {
  return (raw) => {
    const v = typeof raw === 'string' ? raw.trim() : raw;
    return ids.includes(v) ? { value: v } : { error: message };
  };
}

function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/\D/g, '');
  if ((digits.length === 12 && digits.startsWith('91')) || (digits.length === 11 && digits.startsWith('0'))) {
    digits = digits.slice(-10);
  }
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

function phone(raw) {
  const value = normalizePhone(raw);
  return value ? { value } : { error: 'Enter a valid 10-digit Indian mobile number.' };
}

function email(raw) {
  if (typeof raw !== 'string') return { error: 'Enter a valid email address.' };
  const v = raw.trim();
  if (v.length > 254) return { error: 'Email must be at most 254 characters.' };
  if (!EMAIL_RE.test(v) || v.split('@')[0].startsWith('.') || v.split('@')[0].endsWith('.') || v.includes('..')) {
    return { error: 'Enter a valid email address.' };
  }
  return { value: v.toLowerCase() };
}

function date(raw) {
  const v = typeof raw === 'string' ? raw.trim() : raw;
  return isValidDateString(v) ? { value: v } : { error: 'Enter a valid date (YYYY-MM-DD).' };
}

function userId(raw) {
  const n = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  return Number.isSafeInteger(n) && n > 0 ? { value: n } : { error: 'Choose a valid staff member.' };
}

function password(raw) {
  if (typeof raw !== 'string') return { error: 'Password must be text.' };
  if (charCount(raw) < 10) return { error: 'Password must be at least 10 characters.' };
  if (Buffer.byteLength(raw, 'utf8') > 72) return { error: 'Password must be at most 72 bytes.' };
  return { value: raw };
}

// ---- field definitions ------------------------------------------------------------------------

const FIELDS = {
  name: { label: 'Name', check: text({ min: 2, max: 100 }), requiredMsg: 'Name is required.' },
  phone: { label: 'Phone', check: phone, requiredMsg: 'Phone number is required.' },
  email: { label: 'Email', check: email, requiredMsg: 'Email is required.' },
  college: { label: 'College', check: text({ max: 150 }) },
  stream: { label: 'Stream', check: oneOf(C.STREAM_IDS, 'Choose a valid stream.') },
  yearOfStudy: { label: 'Year of study', check: oneOf(C.YEAR_IDS, 'Choose a valid year of study.') },
  domain: { label: 'Domain', check: text({ max: 80 }) },
  plan: { label: 'Plan', check: oneOf(C.PLAN_IDS, 'Plan must be basic, premium or undecided.') },
  brochure: { label: 'Brochure', check: text({ max: 200 }) },
  message: { label: 'Message', check: text({ max: 2000, multiline: true }) },
  status: { label: 'Status', check: oneOf(C.STATUS_IDS, 'Choose a valid status.'), requiredMsg: 'Status is required.' },
  assignedTo: { label: 'Assigned counsellor', check: userId },
  nextFollowUp: { label: 'Next follow-up', check: date },
  note: { label: 'Note', check: text({ min: 1, max: 4000, multiline: true }), requiredMsg: 'Note cannot be empty.' },
  role: { label: 'Role', check: oneOf(C.ROLE_IDS, 'Role must be counsellor, manager or admin.'), requiredMsg: 'Role is required.' },
  password: { label: 'Password', check: password, requiredMsg: 'Password is required.' },
  active: { label: 'Active', check: (raw) => (typeof raw === 'boolean' ? { value: raw } : { error: 'Active must be true or false.' }) },
};

/**
 * Validate `body` against `spec` ({ field: { required?, def? } }).
 * Create mode: blank optional fields become null. Partial mode (PATCH): absent fields are skipped,
 * blank fields become null (or an error if required).
 */
function run(body, spec, { partial = false } = {}) {
  const values = {};
  const errors = {};
  for (const [key, opts] of Object.entries(spec)) {
    const def = opts.def || FIELDS[key];
    const raw = body[key];
    if (partial && raw === undefined) continue;
    if (isBlank(raw)) {
      if (opts.required) errors[key] = opts.requiredMsg || def.requiredMsg || `${def.label} is required.`;
      else values[key] = null;
      continue;
    }
    const r = def.check(raw, def.label);
    if (r.error) errors[key] = r.error;
    else values[key] = r.value;
  }
  return { values, errors };
}

const asObject = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

const CONSENT_MSG = 'Please confirm your consent to be contacted.';

function validatePublicInquiry(input) {
  const body = asObject(input);
  const { values, errors } = run(body, {
    source: { required: true, def: { label: 'Source', check: oneOf(C.PUBLIC_SOURCES, 'Invalid source.'), requiredMsg: 'Source is required.' } },
    name: { required: true },
    phone: { required: true },
    email: { required: true },
    college: {},
    stream: {},
    yearOfStudy: {},
    domain: {},
    plan: {},
    brochure: {},
    message: {},
  });
  if (body.consent !== true) errors.consent = CONSENT_MSG;
  if (values.source !== 'brochure') values.brochure = null; // only meaningful for brochure downloads
  return { values, errors };
}

function validateManualInquiry(input) {
  const body = asObject(input);
  const { values, errors } = run(body, {
    source: { required: true, def: { label: 'Source', check: oneOf(C.MANUAL_SOURCES, 'Source must be phone call or walk-in.'), requiredMsg: 'Source is required.' } },
    name: { required: true },
    phone: { required: true },
    email: {},
    college: {},
    stream: {},
    yearOfStudy: {},
    domain: {},
    plan: {},
    status: {},
    assignedTo: {},
    nextFollowUp: {},
    note: {},
  });
  if (body.consent !== true) errors.consent = 'Confirm that the enquirer agreed to their details being stored and to be contacted.';
  if (!values.status) values.status = 'new';
  return { values, errors };
}

function validateInquiryUpdate(input) {
  return run(
    asObject(input),
    {
      name: { required: true },
      phone: { required: true },
      email: {},
      college: {},
      stream: {},
      yearOfStudy: {},
      domain: {},
      plan: {},
      status: { required: true },
      assignedTo: {},
      nextFollowUp: {},
    },
    { partial: true },
  );
}

function validateNote(input) {
  return run(asObject(input), { body: { required: true, def: FIELDS.note } });
}

function validateNewUser(input) {
  return run(asObject(input), {
    name: { required: true },
    email: { required: true },
    role: { required: true },
    password: { required: true },
  });
}

function validateUserUpdate(input) {
  return run(asObject(input), { name: { required: true }, role: { required: true }, active: { required: true } }, { partial: true });
}

function validatePassword(input, key = 'password') {
  return run(asObject(input), { [key]: { required: true, def: FIELDS.password } });
}

// ---- certificates -----------------------------------------------------------------------------

// Characters the PDF's standard fonts (WinAnsi encoding) can print, beyond ASCII and Latin-1.
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function isWinAnsi(s) {
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp)) continue;
    return false;
  }
  return true;
}

// Letters A-Z a-z, Latin-1 letters (no multiplication/division signs), space, period, apostrophe, hyphen.
const CERT_NAME_CHARS = /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF .'-]+$/;
const CERT_NAME_LETTER = /[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]/;
const CERT_NAME_MSG = 'Please write your name in English letters, exactly as it should appear on the certificate.';
const SESSION_CLOSED_MSG = 'Registration for this session is closed.';
const WRONG_CODE_MSG = "That code doesn't match this session. Use the code announced at the end of the session.";

function certName(raw) {
  if (typeof raw !== 'string') return { error: CERT_NAME_MSG };
  const v = raw
    .normalize('NFC')
    .replace(/[\u2018\u2019\u02BC]/g, "'") // phones auto-insert curly apostrophes
    .replace(/\s+/g, ' ')
    .trim();
  if (!CERT_NAME_CHARS.test(v) || !CERT_NAME_LETTER.test(v)) return { error: CERT_NAME_MSG };
  const n = charCount(v);
  if (n < 2 || n > 80) return { error: 'Name must be between 2 and 80 characters.' };
  return { value: v };
}

function printable({ min, max }) {
  const base = text({ min, max });
  return (raw, label) => {
    const r = base(raw, label);
    if (r.error) return r;
    if (!isWinAnsi(r.value)) return { error: `${label} is printed on certificates: use English letters and common punctuation only.` };
    return r;
  };
}

function sessionCode(raw) {
  const v = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return /^[A-Z0-9]{6,20}$/.test(v) ? { value: v } : { error: 'Code must be 6-20 letters or digits (A-Z, 0-9).' };
}

function isoDateTime(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(raw.trim())) {
    return { error: 'Enter a valid date and time.' };
  }
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? { error: 'Enter a valid date and time.' } : { value: d.toISOString() };
}

const bool = (label) => (raw) => (typeof raw === 'boolean' ? { value: raw } : { error: `${label} must be true or false.` });

const CERT_FIELDS = {
  sessionId: {
    label: 'Session',
    check: (raw) => {
      const r = userId(raw);
      return r.error ? { error: SESSION_CLOSED_MSG } : r;
    },
    requiredMsg: 'Please choose the session you attended.',
  },
  code: {
    label: 'Code',
    check: (raw) => (typeof raw === 'string' && raw.trim().length <= 40 ? { value: raw } : { error: 'Enter the session code.' }),
    requiredMsg: 'Enter the session code announced at the end of the session.',
  },
  name: { label: 'Name', check: certName, requiredMsg: 'Name is required.' },
  college: { label: 'College', check: printable({ min: 2, max: 150 }), requiredMsg: 'College is required.' },
  templateId: { label: 'Certificate design', check: (raw) => (Number.isSafeInteger(raw) && raw > 0 ? { value: raw } : { error: 'Choose a valid certificate design.' }) },
  title: { label: 'Title', check: printable({ min: 3, max: 120 }), requiredMsg: 'Title is required.' },
  sessionDate: { label: 'Date', check: date, requiredMsg: 'Date is required.' },
  venue: { label: 'Venue', check: printable({ min: 2, max: 150 }), requiredMsg: 'Venue is required for in-person sessions.' },
  mode: { label: 'Mode', check: oneOf(['in-person', 'online'], 'Mode must be in-person or online.'), requiredMsg: 'Mode is required.' },
  description: { label: 'Description', check: text({ max: 2000, multiline: true }) },
  customCode: { label: 'Code', check: sessionCode },
  registrationOpen: { label: 'Registration open', check: bool('Registration open') },
  closesAt: { label: 'Closes at', check: isoDateTime },
  reason: { label: 'Reason', check: text({ min: 3, max: 300 }), requiredMsg: 'A reason is required.' },
};

function validateCertificateRegistration(input) {
  const body = asObject(input);
  const { values, errors } = run(body, {
    sessionId: { required: true, def: CERT_FIELDS.sessionId },
    code: { required: true, def: CERT_FIELDS.code },
    name: { required: true, def: CERT_FIELDS.name },
    email: { required: true },
    phone: { required: true },
    college: { required: true, def: CERT_FIELDS.college },
    stream: {},
    yearOfStudy: {},
  });
  if (body.consent !== true) errors.consent = CONSENT_MSG;
  const referrals = validateReferrals(body, values.phone);
  values.referrals = referrals.values;
  Object.assign(errors, referrals.errors);
  return { values, errors };
}

const MAX_REFERRALS = 3;
const REFERRAL_REQUIRED_MSG = 'Refer at least one friend from another college.';
const REFERRAL_FIELDS = {
  name: { label: "Friend's name", check: text({ min: 2, max: 100 }), requiredMsg: "Enter your friend's full name." },
  phone: { label: "Friend's mobile number", check: phone, requiredMsg: "Enter your friend's mobile number." },
  college: { label: "Friend's college", check: text({ min: 2, max: 150 }), requiredMsg: "Enter your friend's college." },
};

/**
 * Refer a friend: `referrals` ([{ name, phone, college }], 1 to 3) on a certificate registration, with
 * `referralConsent: true`. Every field of every entry is required. Errors are keyed `referrals.<index>.<field>`.
 */
function validateReferrals(body, ownPhone) {
  const values = [];
  const errors = {};
  const raw = body.referrals ?? [];
  if (!Array.isArray(raw)) return { values, errors: { referrals: 'Invalid referral details.' } };
  if (!raw.length) return { values, errors: { referrals: REFERRAL_REQUIRED_MSG } };
  if (raw.length > MAX_REFERRALS) return { values, errors: { referrals: `You can refer up to ${MAX_REFERRALS} friends.` } };
  const seen = new Set();
  raw.forEach((entry, i) => {
    const friend = asObject(entry);
    const spec = Object.fromEntries(Object.entries(REFERRAL_FIELDS).map(([k, def]) => [k, { required: true, def }]));
    const r = run(friend, spec);
    if (!r.errors.phone) {
      if (r.values.phone === ownPhone) r.errors.phone = "That's your own number. Enter your friend's mobile number.";
      else if (seen.has(r.values.phone)) r.errors.phone = "You've already added a friend with this number.";
      seen.add(r.values.phone);
    }
    for (const [k, msg] of Object.entries(r.errors)) errors[`referrals.${i}.${k}`] = msg;
    if (!Object.keys(r.errors).length) values.push(r.values);
  });
  if (body.referralConsent !== true) {
    errors.referralConsent = 'Please confirm that your friends agreed to be contacted by Sloka Academy.';
  }
  return { values, errors };
}

function validateSession(input, { partial = false } = {}) {
  const body = asObject(input);
  const spec = {
    title: { required: true, def: CERT_FIELDS.title },
    sessionDate: { required: true, def: CERT_FIELDS.sessionDate },
    mode: { required: true, def: CERT_FIELDS.mode },
    venue: { def: CERT_FIELDS.venue },
    description: { def: CERT_FIELDS.description },
    code: { def: CERT_FIELDS.customCode },
    registrationOpen: { def: CERT_FIELDS.registrationOpen },
    closesAt: { def: CERT_FIELDS.closesAt },
    templateId: { def: CERT_FIELDS.templateId },
  };
  return run(body, spec, { partial });
}

function validateCertName(input) {
  return run(asObject(input), { name: { required: true, def: CERT_FIELDS.name } });
}

/** Staff correction of a registration: the printed name and/or the email the certificate goes to. */
function validateCertCorrection(input) {
  const body = asObject(input);
  const { values, errors } = run(body, { name: { def: CERT_FIELDS.name }, email: {} }, { partial: true });
  if (values.name === null) errors.name = 'Name is required.';
  if (values.email === null) errors.email = 'Email is required.';
  if (!Object.keys(errors).length && !values.name && !values.email) errors.name = 'Nothing to change.';
  return { values, errors };
}

function validateStudentUpdate(input) {
  return run(asObject(input), { name: { required: true }, email: {}, phone: {}, college: {}, stream: {}, yearOfStudy: {} }, { partial: true });
}

function validateTemplateName(raw) {
  return run({ name: raw }, { name: { required: true, def: { label: 'Template name', check: text({ min: 2, max: 80 }), requiredMsg: 'Give the template a name.' } } });
}

function validateRevoke(input) {
  return run(asObject(input), { reason: { required: true, def: CERT_FIELDS.reason } });
}

module.exports = {
  normalizePhone,
  validatePublicInquiry,
  validateManualInquiry,
  validateInquiryUpdate,
  validateNote,
  validateNewUser,
  validateUserUpdate,
  validatePassword,
  validateCertificateRegistration,
  validateSession,
  validateCertName,
  validateCertCorrection,
  validateStudentUpdate,
  validateTemplateName,
  validateRevoke,
  isWinAnsi,
  CERT_NAME_MSG,
  SESSION_CLOSED_MSG,
  WRONG_CODE_MSG,
  FIELDS,
  run,
  asObject,
};
