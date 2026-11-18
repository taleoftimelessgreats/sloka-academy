// Internship registrations by the BD team: list (with Due This Week / Overdue), the registration form with its
// duplicate check against the student master, the student's profile (enrollments, payment ledger, offer letter)
// and the mobile/email conflicts associates flagged for review.
// Rendered with DOM APIs / textContent only. Never use innerHTML with data.

import {
  api, can, clearErrors, ensureMeta, errorText, field, fieldMessage, fmtDate, fmtDateTime, fmtMoney, go, h, label, mount, newId, pagerEl,
  selectEl, showErrors, state, toast,
} from './core.js';

const LIST_FILTERS = ['q', 'courseId', 'bdAssociateId', 'status', 'regFrom', 'regTo', 'dueFrom', 'dueTo', 'view', 'sort'];
const VIEWS = [
  { id: '', label: 'All registrations' },
  { id: 'due-week', label: 'Due this week' },
  { id: 'overdue', label: 'Overdue' },
];

const courseList = async () => (await api('GET', '/api/courses')).courses;

/** Payment status, with the Overdue flag on top. */
export function paymentBadge(e) {
  return h(
    'span',
    { class: 'tags' },
    h('span', { class: 'badge', 'data-status': e.paymentStatus }, label('paymentStatus', e.paymentStatus)),
    e.overdue ? h('span', { class: 'badge', 'data-status': 'overdue' }, 'Overdue') : null,
  );
}

const OFFER_STATUS = { generated: 'Generated', sent: 'Sent', failed: 'Failed' };
const offerBadge = (status) => h('span', { class: 'badge', 'data-status': `offer-${status}` }, OFFER_STATUS[status] || status);

// ------------------------------------------------------------------ list

export async function viewRegistrations(params, stale) {
  await ensureMeta();
  const query = new URLSearchParams();
  for (const k of LIST_FILTERS) if (params.get(k)) query.set(k, params.get(k));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [data, courses, stats] = await Promise.all([api('GET', `/api/registrations?${query}&page=${page}&pageSize=25`), courseList(), api('GET', '/api/stats')]);
  if (stale()) return;
  const meta = state.meta;
  const view = params.get('view') || '';

  const tabs = h(
    'nav',
    { class: 'tabs', 'aria-label': 'Registration views' },
    VIEWS.map((v) => {
      const p = new URLSearchParams(query);
      if (v.id) p.set('view', v.id);
      else p.delete('view');
      p.delete('sort');
      const count = v.id === 'due-week' ? stats.registrations.dueThisWeek : v.id === 'overdue' ? stats.registrations.overdue : stats.registrations.total;
      return h('a', { class: view === v.id ? 'tab active' : 'tab', href: `#/registrations${p.toString() ? `?${p}` : ''}`, 'aria-current': view === v.id ? 'page' : null }, v.label, h('span', { class: 'count' }, count));
    }),
  );

  const search = h('input', { type: 'search', name: 'q', placeholder: 'Search name, mobile, email or Student ID', value: params.get('q') || '', 'aria-label': 'Search' });
  const bdAssociates = state.staff.map((s) => ({ id: s.id, label: s.active ? s.name : `${s.name} (inactive)` }));
  const selects = [
    ['courseId', courses.map((c) => ({ id: c.id, label: c.name })), 'All course domains'],
    ['bdAssociateId', bdAssociates, 'Any BD Associate'],
    ['status', [...meta.paymentStatuses, { id: 'overdue', label: 'Overdue' }], 'Any payment status'],
  ].map(([name, list, empty]) => {
    const sel = selectEl(name, list, params.get(name) || '', { empty });
    sel.setAttribute('aria-label', empty);
    return sel;
  });
  const dates = [
    ['regFrom', 'Registered from'],
    ['regTo', 'Registered to'],
    ['dueFrom', 'Due from'],
    ['dueTo', 'Due to'],
  ].map(([name, text]) => h('label', { class: 'date-filter' }, h('span', null, text), h('input', { type: 'date', name, value: params.get(name) || '' })));
  const form = h('form', { class: 'filters filters-registrations', role: 'search' }, h('div', { class: 'search' }, search, h('button', { class: 'btn', type: 'submit' }, 'Search')), selects, h('div', { class: 'date-row' }, dates));
  const apply = () => {
    const p = new URLSearchParams();
    if (search.value.trim()) p.set('q', search.value.trim());
    for (const sel of selects) if (sel.value) p.set(sel.name, sel.value);
    for (const input of form.querySelectorAll('input[type="date"]')) if (input.value) p.set(input.name, input.value);
    if (view) p.set('view', view);
    go(`#/registrations${p.toString() ? `?${p}` : ''}`);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    apply();
  });
  form.addEventListener('change', (e) => {
    if (e.target !== search) apply();
  });

  const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
  const rows = data.items.map((e) =>
    h(
      'tr',
      null,
      h(
        'td',
        { class: 'primary', 'data-label': 'Student' },
        h('a', { class: 'name', href: `#/registrations/students/${e.student.id}?e=${e.id}` }, e.student.name),
        h('span', { class: 'sub mono' }, e.student.studentCode || ''),
        h('span', { class: 'sub' }, e.student.phone || ''),
      ),
      td('Course', e.course.name, h('span', { class: 'sub' }, `Starts ${fmtDate(e.batchStartDate)}`)),
      td('Fee', h('span', { class: 'nowrap' }, fmtMoney(e.fee)), h('span', { class: 'sub' }, `Paid ${fmtMoney(e.paid)}`)),
      td('Balance', h('span', { class: e.balance > 0 ? 'nowrap strong' : 'nowrap muted' }, fmtMoney(e.balance))),
      td('Due', e.balanceDueDate && e.balance > 0 ? h('span', { class: e.overdue ? 'nowrap fu-overdue' : 'nowrap' }, fmtDate(e.balanceDueDate)) : h('span', { class: 'muted' }, '—')),
      td('Status', paymentBadge(e)),
      td('BD Associate', e.bdAssociate ? e.bdAssociate.name : h('span', { class: 'muted' }, '—')),
      td('Registered', h('span', { class: 'nowrap' }, fmtDate(e.registrationDate))),
    ),
  );
  const heads = ['Student', 'Course', 'Fee', 'Balance', 'Due', 'Status', 'BD Associate', 'Registered'];
  const table = h(
    'table',
    { class: 'stackable' },
    h('thead', null, h('tr', null, heads.map((t) => h('th', null, t)))),
    h(
      'tbody',
      null,
      rows.length
        ? rows
        : h('tr', null, h('td', { colspan: String(heads.length), class: 'empty' }, data.total === 0 && !query.toString() ? 'No registrations yet.' : 'No registrations match these filters.')),
    ),
  );
  const hrefFor = (n) => {
    const p = new URLSearchParams(params);
    p.set('page', String(n));
    return `#/registrations?${p}`;
  };
  const hasFilters = LIST_FILTERS.some((k) => k !== 'view' && params.get(k));
  const s = stats.registrations;
  mount(
    'Registrations',
    h(
      'div',
      { class: 'page-head' },
      h('h1', null, 'Registrations'),
      h('span', { class: 'muted' }, `${data.total} ${data.total === 1 ? 'registration' : 'registrations'}`),
      hasFilters ? h('a', { class: 'btn btn-ghost btn-sm', href: `#/registrations${view ? `?view=${view}` : ''}` }, 'Clear filters') : null,
      h('span', { class: 'spacer' }),
      can('registrations.export') ? h('a', { class: 'btn', href: `/api/registrations/export?${query}`, download: '' }, 'Export CSV') : null,
      can('registrations.create') ? h('a', { class: 'btn btn-primary', href: '#/registrations/new' }, '+ Register a student') : null,
    ),
    h(
      'div',
      { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'num' }, fmtMoney(s.collected)), h('div', { class: 'lbl' }, 'Collected')),
      h('div', { class: 'stat' }, h('div', { class: 'num' }, fmtMoney(s.outstanding)), h('div', { class: 'lbl' }, 'Outstanding')),
      h('a', { class: s.dueThisWeek ? 'stat hot' : 'stat', href: '#/registrations?view=due-week' }, h('div', { class: 'num' }, s.dueThisWeek), h('div', { class: 'lbl' }, 'Due this week')),
      h('a', { class: s.overdue ? 'stat hot' : 'stat', href: '#/registrations?view=overdue' }, h('div', { class: 'num' }, s.overdue), h('div', { class: 'lbl' }, 'Overdue')),
    ),
    stats.openRegistrationFlags
      ? h(
          'a',
          { class: 'notice notice-link', href: '#/registrations/flags' },
          h('strong', null, `${stats.openRegistrationFlags} mobile/email ${stats.openRegistrationFlags === 1 ? 'conflict was' : 'conflicts were'} flagged by associates.`),
          ' Review →',
        )
      : null,
    tabs,
    form,
    h('div', { class: 'card card-flush' }, h('div', { class: 'table-wrap' }, table)),
    pagerEl(data, hrefFor),
  );
}

// ------------------------------------------------------------------ registration form

const today = () => state.today;

/** The "Is this the same student?" dialog. Resolves to the chosen match, 'no', or null (closed). */
function sameStudentDialog(matches) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'modal', 'aria-labelledby': 'same-student-title' });
    const close = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const cards = matches.map((m) =>
      h(
        'div',
        { class: 'match' },
        h('div', { class: 'match-head' }, h('strong', null, m.name), h('span', { class: 'mono' }, m.studentCode || '')),
        h(
          'dl',
          { class: 'info compact' },
          h('dt', null, 'Mobile'),
          h('dd', { class: 'mono' }, m.phoneMasked || '—'),
          h('dt', null, 'Email'),
          h('dd', null, m.email || '—'),
          h('dt', null, 'College'),
          h('dd', null, m.college || '—'),
          h('dt', null, 'Matched on'),
          h('dd', null, m.matchedBy.map((x) => (x === 'phone' ? 'mobile number' : 'email')).join(' and ')),
          h('dt', null, 'Enrollments'),
          h('dd', null, m.enrollments.length ? m.enrollments.map((e) => `${e.course} (${fmtDate(e.registrationDate)}, ${label('paymentStatus', e.paymentStatus)})`).join('; ') : 'None yet'),
        ),
        matches.length === 1 || m.matchedBy.length === 2
          ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => close(m) }, 'Yes, this is the same student')
          : null,
      ),
    );
    const split = matches.length > 1 && !matches.some((m) => m.matchedBy.length === 2);
    dialog.append(
      h('h2', { id: 'same-student-title' }, 'Is this the same student?'),
      h(
        'p',
        { class: 'muted' },
        split
          ? 'The mobile number belongs to one student and the email to another. Both must belong to the same student, so this cannot be registered as entered.'
          : 'This mobile number or email is already in the student master. If it is the same student, the new enrollment is added to their record.',
      ),
      ...cards,
      h(
        'div',
        { class: 'form-actions' },
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => close('no') }, split ? 'Re-check the details' : 'No, a different student'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close(null) }, 'Cancel'),
      ),
    );
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export async function viewRegistrationForm(stale) {
  await ensureMeta();
  const courses = (await courseList()).filter((c) => c.active);
  if (stale()) return;
  const meta = state.meta;

  // ---- student
  const st = {
    name: h('input', { name: 'student.name', maxlength: '100', required: true, autocomplete: 'off' }),
    phone: h('input', { name: 'student.phone', type: 'tel', inputmode: 'tel', required: true, autocomplete: 'off', placeholder: '10-digit mobile' }),
    email: h('input', { name: 'student.email', type: 'email', required: true, autocomplete: 'off' }),
    gender: selectEl('student.gender', meta.genders, '', { empty: 'Select' }),
    dateOfBirth: h('input', { name: 'student.dateOfBirth', type: 'date', max: today() }),
    college: h('input', { name: 'student.college', maxlength: '150', required: true, autocomplete: 'off' }),
    qualification: h('input', { name: 'student.qualification', maxlength: '100', placeholder: 'e.g. B.Tech', autocomplete: 'off' }),
    specialization: h('input', { name: 'student.specialization', maxlength: '150', placeholder: 'e.g. Computer Science', autocomplete: 'off' }),
    yearOfStudy: selectEl('student.yearOfStudy', meta.years, '', { empty: 'Select' }),
    graduationYear: h('input', { name: 'student.graduationYear', type: 'number', min: '1980', max: String(new Date().getFullYear() + 6), step: '1' }),
    city: h('input', { name: 'student.city', maxlength: '100', autocomplete: 'off' }),
    state: h('input', { name: 'student.state', maxlength: '100', autocomplete: 'off' }),
  };

  // ---- enrollment
  const en = {
    courseId: selectEl('enrollment.courseId', courses.map((c) => ({ id: c.id, label: `${c.name} (${c.duration})` })), '', { empty: 'Select the course domain' }),
    batchStartDate: h('input', { name: 'enrollment.batchStartDate', type: 'date', required: true }),
    fee: h('input', { name: 'enrollment.fee', inputmode: 'decimal', required: true, placeholder: '₹', autocomplete: 'off' }),
    tokenAmount: h('input', { name: 'enrollment.tokenAmount', inputmode: 'decimal', required: true, placeholder: '₹', autocomplete: 'off' }),
    paymentMode: selectEl('enrollment.paymentMode', meta.paymentModes, '', { empty: 'Select' }),
    transactionReference: h('input', { name: 'enrollment.transactionReference', maxlength: '100', placeholder: 'UTR / transaction ID', autocomplete: 'off' }),
    paidOn: h('input', { name: 'enrollment.paidOn', type: 'date', value: today(), max: today() }),
    balanceDueDate: h('input', { name: 'enrollment.balanceDueDate', type: 'date', min: today() }),
    remarks: h('textarea', { name: 'enrollment.remarks', rows: '3', maxlength: '2000' }),
  };
  const mayAssign = can('registrations.edit');
  const bdSelect = mayAssign
    ? selectEl('enrollment.bdAssociateId', state.staff.filter((s) => s.active).map((s) => ({ id: s.id, label: s.name })), state.me.id)
    : null;
  const balanceOut = h('output', { class: 'readonly', 'aria-live': 'polite' }, '—');
  const sendOffer = h('input', { type: 'checkbox', checked: true, id: newId() });

  const amount = (input) => {
    const v = input.value.replace(/[,\s₹]/g, '');
    return /^\d+(\.\d{1,2})?$/.test(v) ? Number(v) : null;
  };
  const updateBalance = () => {
    const fee = amount(en.fee);
    const token = amount(en.tokenAmount);
    if (fee === null || token === null) {
      balanceOut.textContent = '—';
      return;
    }
    const balance = Math.round((fee - token) * 100) / 100;
    balanceOut.textContent = balance < 0 ? 'Token is more than the fee' : fmtMoney(balance);
    balanceOut.classList.toggle('bad', balance < 0);
    en.balanceDueDate.required = balance > 0;
  };
  en.fee.addEventListener('input', updateBalance);
  en.tokenAmount.addEventListener('input', updateBalance);

  // ---- duplicate check against the student master
  let confirmed = null; // the master record the associate confirmed
  let blocked = false; // they said "not the same student": re-verify before submitting
  const banner = h('div', { class: 'notice', hidden: true });
  const lockable = ['name', 'gender', 'dateOfBirth', 'college', 'qualification', 'specialization', 'yearOfStudy', 'graduationYear', 'city', 'state'];
  const setLocked = (match) => {
    confirmed = match;
    for (const k of lockable) st[k].disabled = Boolean(match);
    if (match) {
      // The master record's details, as they are (blank where the record has none).
      st.name.value = match.name;
      st.college.value = match.college || '';
      for (const [k, v] of Object.entries(match.details || {})) if (st[k]) st[k].value = v == null ? '' : String(v);
      banner.replaceChildren(
        h('strong', null, `Registering ${match.name} (${match.studentCode}) from the student master. `),
        'Their details come from the master record and stay as they are. Complete the enrollment below. ',
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => setLocked(null) }, 'Not this student?'),
      );
    }
    banner.hidden = !match;
  };

  let lastLookup = '';
  async function checkMaster({ force = false } = {}) {
    const phone = st.phone.value.trim();
    const email = st.email.value.trim();
    const key = `${phone}|${email.toLowerCase()}`;
    if ((!phone && !email) || (!force && key === lastLookup) || confirmed) return true;
    lastLookup = key;
    let matches;
    try {
      ({ matches } = await api('GET', `/api/registrations/lookup?phone=${encodeURIComponent(phone)}&email=${encodeURIComponent(email)}`));
    } catch {
      return true; // the server checks again on submit
    }
    if (!matches.length) {
      blocked = false;
      return true;
    }
    const answer = await sameStudentDialog(matches);
    if (answer && answer !== 'no') {
      blocked = false;
      setLocked(answer);
      return true;
    }
    if (answer === 'no') {
      blocked = true;
      // Flag the conflict for an admin, then ask the associate to re-verify.
      try {
        await api('POST', '/api/registrations/flags', { name: st.name.value, phone, email, note: 'Associate said this is a different student.' });
        toast('Flagged for admin review. Please re-verify the mobile number and email with the student.', true);
      } catch (err) {
        toast(errorText(err), true);
      }
    }
    return false;
  }
  st.phone.addEventListener('change', () => checkMaster());
  st.email.addEventListener('change', () => checkMaster());

  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Register student');
  const section = (title, ...children) => h('section', { class: 'card' }, h('h2', null, title), ...children);
  const form = h(
    'form',
    { class: 'stack', novalidate: true },
    section(
      'Student details',
      h('p', { class: 'muted small' }, 'Saved to the student master. The mobile number and email are checked against it as you type them.'),
      banner,
      h(
        'div',
        { class: 'form-grid' },
        field('Mobile number', st.phone, { required: true }),
        field('Email', st.email, { required: true }),
        field('Full name', st.name, { required: true }),
        field('Gender', st.gender),
        field('Date of birth', st.dateOfBirth),
        field('College / university', st.college, { required: true }),
        field('Qualification', st.qualification),
        field('Specialization', st.specialization),
        field('Year of study', st.yearOfStudy),
        field('Year of graduation', st.graduationYear),
        field('City', st.city),
        field('State', st.state),
      ),
    ),
    section(
      'Enrollment',
      h(
        'div',
        { class: 'form-grid' },
        field('Course domain', en.courseId, { required: true }),
        field('Batch / internship start date', en.batchStartDate, { required: true }),
        field('Committed program fee (₹)', en.fee, { required: true, hint: 'As negotiated with the student.' }),
        field('Registration (token) amount paid (₹)', en.tokenAmount, { required: true }),
        field('Payment mode', en.paymentMode, { required: true }),
        field('Transaction reference', en.transactionReference),
        field('Paid on', en.paidOn),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Balance due'), balanceOut, h('small', { class: 'hint' }, 'Committed fee − total paid.')),
        field('Balance due date', en.balanceDueDate, { hint: 'Required while a balance remains.' }),
        mayAssign
          ? field('BD Associate', bdSelect)
          : h('div', { class: 'field' }, h('span', { class: 'label' }, 'BD Associate'), h('output', { class: 'readonly' }, state.me.name)),
        field('Remarks', en.remarks, { full: true }),
      ),
      can('offerLetters.create') && meta.emailEnabled
        ? h('label', { class: 'check', for: sendOffer.id }, sendOffer, ' Email the offer letter to the student now (it is generated either way)')
        : null,
    ),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, submit, h('a', { class: 'btn btn-ghost', href: '#/registrations' }, 'Cancel')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    if (blocked) {
      form.querySelector('.form-error').textContent = 'This mobile number or email belongs to another student. Re-verify them with the student (or pick the existing student) before registering.';
      return;
    }
    if (!(await checkMaster({ force: !confirmed }))) return;
    const value = (input) => (input.value.trim() === '' ? null : input.value.trim());
    const body = {
      studentId: confirmed ? confirmed.id : null,
      student: Object.fromEntries(Object.entries(st).map(([k, input]) => [k, value(input)])),
      enrollment: {
        ...Object.fromEntries(Object.entries(en).map(([k, input]) => [k, value(input)])),
        bdAssociateId: bdSelect ? Number(bdSelect.value) : null,
      },
      sendOfferLetter: can('offerLetters.create') && meta.emailEnabled && sendOffer.checked,
    };
    submit.disabled = true;
    try {
      const r = await api('POST', '/api/registrations', body);
      const letter = r.offerLetter;
      toast(
        letter && letter.status === 'sent'
          ? `Registered. Offer letter ${letter.offerLetterId} emailed.`
          : letter && letter.status === 'failed'
            ? `Registered. The offer letter could not be emailed: ${letter.emailError}`
            : 'Registered. The offer letter is ready.',
        Boolean(letter && letter.status === 'failed'),
      );
      go(`#/registrations/students/${r.registration.student.id}?e=${r.registration.id}`);
    } catch (err) {
      if (err.status === 409 && err.data.error === 'student_exists') {
        lastLookup = '';
        await checkMaster({ force: true });
      } else showErrors(form, err);
    } finally {
      submit.disabled = false;
    }
  });

  mount(
    'Register a student',
    h('div', { class: 'page-head' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/registrations' }, '← Registrations'), h('h1', null, 'Register a student')),
    h('p', { class: 'muted lead' }, 'For internship registrations made by the BD team. The token amount confirms the slot; the offer letter is generated straight away.'),
    form,
  );
  st.phone.focus();
}

// ------------------------------------------------------------------ student profile

function enrollmentCard(e, { reload, focus }) {
  const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
  const info = h(
    'dl',
    { class: 'info' },
    h('dt', null, 'Batch / start date'),
    h('dd', null, fmtDate(e.batchStartDate)),
    h('dt', null, 'Committed fee'),
    h('dd', null, fmtMoney(e.fee)),
    h('dt', null, 'Paid'),
    h('dd', null, fmtMoney(e.paid)),
    h('dt', null, 'Balance'),
    h('dd', { class: e.balance > 0 ? 'strong' : null }, fmtMoney(e.balance)),
    h('dt', null, 'Balance due date'),
    h('dd', { class: e.overdue ? 'fu-overdue' : null }, e.balance > 0 && e.balanceDueDate ? fmtDate(e.balanceDueDate) : '—'),
    h('dt', null, 'BD Associate'),
    h('dd', null, e.bdAssociate ? e.bdAssociate.name : '—'),
    h('dt', null, 'Registered'),
    h('dd', null, `${fmtDate(e.registrationDate)}${e.createdBy ? ` by ${e.createdBy.name}` : ''}`),
    e.remarks ? [h('dt', null, 'Remarks'), h('dd', { class: 'pre' }, e.remarks)] : null,
  );

  // ---- edit after submission (registrations.edit)
  let editForm = null;
  if (can('registrations.edit')) {
    const ed = {
      fee: h('input', { name: 'fee', inputmode: 'decimal', value: String(e.fee) }),
      balanceDueDate: h('input', { name: 'balanceDueDate', type: 'date', value: e.balanceDueDate || '' }),
      batchStartDate: h('input', { name: 'batchStartDate', type: 'date', value: e.batchStartDate }),
      bdAssociateId: selectEl('bdAssociateId', state.staff.filter((s) => s.active || (e.bdAssociate && s.id === e.bdAssociate.id)).map((s) => ({ id: s.id, label: s.name })), e.bdAssociate ? e.bdAssociate.id : ''),
      remarks: h('textarea', { name: 'remarks', rows: '2', maxlength: '2000' }, e.remarks || ''),
    };
    editForm = h(
      'form',
      { class: 'subform', novalidate: true, hidden: true },
      h(
        'div',
        { class: 'form-grid' },
        field('Committed fee (₹)', ed.fee),
        field('Balance due date', ed.balanceDueDate),
        field('Batch / start date', ed.batchStartDate),
        field('BD Associate', ed.bdAssociateId),
        field('Remarks', ed.remarks, { full: true }),
      ),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save changes'), h('span', { class: 'muted small' }, 'Every change is recorded in the audit log.')),
    );
    editForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api('PATCH', `/api/registrations/${e.id}`, {
          fee: ed.fee.value,
          balanceDueDate: ed.balanceDueDate.value || null,
          batchStartDate: ed.batchStartDate.value,
          bdAssociateId: Number(ed.bdAssociateId.value),
          remarks: ed.remarks.value,
        });
        toast('Registration updated');
        reload(e.id);
      } catch (err) {
        showErrors(editForm, err);
      }
    });
  }

  // ---- payment ledger
  const ledgerRows = e.payments.map((p) => {
    const actions = [];
    if (can('registrations.edit')) {
      const edit = h('button', { class: 'btn btn-sm', type: 'button' }, 'Correct');
      edit.addEventListener('click', async () => {
        const amount = window.prompt(`Correct the amount of this ${p.kind === 'token' ? 'token ' : ''}payment (₹):`, String(p.amount));
        if (amount === null) return;
        try {
          await api('PATCH', `/api/registrations/${e.id}/payments/${p.id}`, { amount, paymentMode: p.paymentMode });
          toast('Payment corrected');
          reload(e.id);
        } catch (err) {
          toast(fieldMessage(err), true);
        }
      });
      actions.push(edit);
      if (p.kind !== 'token') {
        const del = h('button', { class: 'btn btn-sm btn-danger', type: 'button' }, 'Remove');
        del.addEventListener('click', async () => {
          if (!window.confirm(`Remove the payment of ${fmtMoney(p.amount)} on ${fmtDate(p.paidOn)}? This is recorded in the audit log.`)) return;
          try {
            await api('DELETE', `/api/registrations/${e.id}/payments/${p.id}`);
            toast('Payment removed');
            reload(e.id);
          } catch (err) {
            toast(fieldMessage(err), true);
          }
        });
        actions.push(del);
      }
    }
    return h(
      'tr',
      null,
      td('Paid on', h('span', { class: 'nowrap' }, fmtDate(p.paidOn))),
      td('Type', p.kind === 'token' ? 'Registration (token)' : 'Instalment'),
      td('Amount', h('span', { class: 'nowrap strong' }, fmtMoney(p.amount))),
      td('Mode', label('paymentMode', p.paymentMode)),
      td('Reference', p.transactionReference ? h('span', { class: 'mono' }, p.transactionReference) : h('span', { class: 'muted' }, '—')),
      td('Recorded by', p.recordedBy ? p.recordedBy.name : '—'),
      actions.length ? td('', h('div', { class: 'row' }, actions)) : td('', ''),
    );
  });
  const ledger = h(
    'table',
    { class: 'stackable' },
    h('thead', null, h('tr', null, ['Paid on', 'Type', 'Amount', 'Mode', 'Reference', 'Recorded by', ''].map((t) => h('th', null, t)))),
    h('tbody', null, ledgerRows),
    h('tfoot', null, h('tr', null, h('td', { colspan: '2' }, 'Total paid'), h('td', null, h('strong', null, fmtMoney(e.paid))), h('td', { colspan: '4', class: 'muted' }, `Balance ${fmtMoney(e.balance)}`))),
  );

  let payForm = null;
  if (can('payments.create') && e.balance > 0) {
    const pf = {
      amount: h('input', { name: 'amount', inputmode: 'decimal', required: true, placeholder: `Up to ${fmtMoney(e.balance)}` }),
      paymentMode: selectEl('paymentMode', state.meta.paymentModes, '', { empty: 'Select' }),
      transactionReference: h('input', { name: 'transactionReference', maxlength: '100' }),
      paidOn: h('input', { name: 'paidOn', type: 'date', value: state.today, max: state.today }),
      balanceDueDate: h('input', { name: 'balanceDueDate', type: 'date', value: e.balanceDueDate || '' }),
    };
    payForm = h(
      'form',
      { class: 'subform', novalidate: true },
      h('h3', null, 'Record a payment'),
      h(
        'div',
        { class: 'form-grid' },
        field('Amount (₹)', pf.amount, { required: true }),
        field('Payment mode', pf.paymentMode, { required: true }),
        field('Transaction reference', pf.transactionReference),
        field('Paid on', pf.paidOn),
        field('Next balance due date', pf.balanceDueDate, { hint: 'If a balance remains after this payment.' }),
      ),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Record payment')),
    );
    payForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const r = await api('POST', `/api/registrations/${e.id}/payments`, {
          amount: pf.amount.value,
          paymentMode: pf.paymentMode.value,
          transactionReference: pf.transactionReference.value,
          paidOn: pf.paidOn.value || null,
          balanceDueDate: pf.balanceDueDate.value || null,
        });
        toast(`Payment recorded: ${label('paymentStatus', r.registration.paymentStatus)}`);
        reload(e.id);
      } catch (err) {
        showErrors(payForm, err);
      }
    });
  }

  // ---- offer letter
  let offerSection = null;
  const letter = e.offerLetterDetail;
  if (letter !== undefined && can('offerLetters.view')) {
    const pdfPath = `/api/registrations/${e.id}/offer-letter/pdf`;
    const buttons = [];
    let frame = null;
    if (letter) {
      buttons.push(h('a', { class: 'btn', href: pdfPath, download: '' }, 'Download PDF'));
      const preview = h('button', { class: 'btn', type: 'button' }, 'Preview');
      // The API refuses to be framed, so the preview shows a copy of the PDF from this page (a blob URL).
      frame = h('iframe', { class: 'preview-frame', title: 'Offer letter preview', hidden: true });
      preview.addEventListener('click', async () => {
        frame.hidden = !frame.hidden;
        if (frame.hidden || frame.src) return;
        try {
          const res = await fetch(`${pdfPath}?inline=1`, { credentials: 'same-origin', cache: 'no-store' });
          if (!res.ok) throw new Error(String(res.status));
          frame.src = URL.createObjectURL(await res.blob());
        } catch {
          frame.hidden = true;
          toast('The preview could not be loaded. Download the PDF instead.', true);
        }
      });
      buttons.push(preview);
    }
    if (can('offerLetters.create')) {
      const emailOn = state.meta.emailEnabled;
      const send = h(
        'button',
        { class: 'btn btn-primary', type: 'button', disabled: !emailOn, title: emailOn ? null : 'Email is not configured on the server: download the PDF and send it yourself.' },
        letter && letter.status === 'sent' ? 'Email again' : 'Email to student',
      );
      send.addEventListener('click', async () => {
        send.disabled = true;
        try {
          const r = await api('POST', `/api/registrations/${e.id}/offer-letter/send`);
          toast(r.offerLetter.status === 'sent' ? 'Offer letter emailed' : `Not sent: ${r.offerLetter.emailError}`, r.offerLetter.status !== 'sent');
          reload(e.id);
        } catch (err) {
          toast(errorText(err), true);
          send.disabled = false;
        }
      });
      const regen = h('button', { class: 'btn', type: 'button' }, letter ? 'Regenerate' : 'Generate');
      regen.addEventListener('click', async () => {
        if (letter && !window.confirm('Regenerate the offer letter with the current details and template? It keeps its ID; the date becomes today.')) return;
        try {
          await api('POST', `/api/registrations/${e.id}/offer-letter/generate`);
          toast('Offer letter generated');
          reload(e.id);
        } catch (err) {
          toast(errorText(err), true);
        }
      });
      buttons.push(send, regen);
    }
    const events = letter
      ? h(
          'ul',
          { class: 'timeline' },
          letter.events.map((ev) => h('li', null, h('span', { class: 'when' }, fmtDateTime(ev.createdAt)), ' ', h('strong', null, ev.type[0].toUpperCase() + ev.type.slice(1)), ev.detail ? ` · ${ev.detail}` : '', ev.actor ? ` · ${ev.actor.name}` : '')),
        )
      : null;
    offerSection = h(
      'div',
      { class: 'subform' },
      h(
        'h3',
        null,
        'Offer letter ',
        letter ? h('span', { class: 'mono' }, letter.offerLetterId) : null,
        ' ',
        letter ? offerBadge(letter.status) : h('span', { class: 'muted' }, 'not generated'),
      ),
      letter ? h('p', { class: 'muted small' }, `${letter.template ? `Template "${letter.template.name}"` : 'Built-in letterhead'} · dated ${fmtDate(letter.offerDate)}${letter.sentAt ? ` · last emailed ${fmtDateTime(letter.sentAt)}` : ''}`) : null,
      letter && letter.status === 'failed' ? h('p', { class: 'error-text' }, `Email failed: ${letter.emailError}`) : null,
      h('div', { class: 'row' }, buttons),
      frame,
      events,
    );
  }

  let del = null;
  if (can('registrations.delete')) {
    del = h('button', { class: 'btn btn-danger btn-sm', type: 'button' }, 'Delete registration');
    del.addEventListener('click', async () => {
      if (!window.confirm(`Delete this registration for ${e.course.name}, with its ${e.payments.length} payment(s) and offer letter? This cannot be undone.`)) return;
      try {
        await api('DELETE', `/api/registrations/${e.id}`);
        toast('Registration deleted');
        reload(null);
      } catch (err) {
        toast(errorText(err), true);
      }
    });
  }

  const editToggle = editForm
    ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { editForm.hidden = !editForm.hidden; } }, 'Edit fee, dates, BD Associate')
    : null;
  return h(
    'section',
    { class: focus ? 'card enrollment focus' : 'card enrollment', id: `enrollment-${e.id}` },
    h('div', { class: 'card-head flush' }, h('h2', null, e.course.name, h('span', { class: 'sub' }, `${e.course.duration} · registration #${e.id}`)), paymentBadge(e)),
    h('div', { class: 'grid-2' }, info, h('div', { class: 'stack' }, h('div', { class: 'row' }, editToggle, del))),
    editForm,
    h('h3', null, 'Payment ledger'),
    h('div', { class: 'table-wrap' }, ledger),
    payForm,
    offerSection,
  );
}

export async function viewStudentRegistrations(studentId, params, stale) {
  await ensureMeta();
  const data = await api('GET', `/api/registrations/students/${studentId}`);
  if (stale()) return;
  const s = data.student;
  const focusId = Number(params.get('e')) || null;
  const reload = (eid) => go(`#/registrations/students/${studentId}${eid ? `?e=${eid}` : ''}`);
  const dd = (v) => (v == null || v === '' ? h('span', { class: 'muted' }, '—') : v);
  const master = h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-head flush' }, h('h2', null, 'Student master'), can('students.view') ? h('a', { class: 'small', href: `#/students/${s.id}` }, 'Open the master record →') : null),
    h(
      'dl',
      { class: 'info' },
      ...[
        ['Student ID', h('span', { class: 'mono' }, s.studentCode || '—')],
        ['Mobile', s.phone],
        ['Email', s.email],
        ['Gender', label('gender', s.gender)],
        ['Date of birth', s.dateOfBirth ? fmtDate(s.dateOfBirth) : null],
        ['College / university', s.college],
        ['Qualification', s.qualification],
        ['Specialization', s.specialization],
        ['Year of study', label('yearOfStudy', s.yearOfStudy)],
        ['Year of graduation', s.graduationYear],
        ['City / state', [s.city, s.state].filter(Boolean).join(', ')],
      ].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, dd(v))]),
    ),
    can('students.edit') ? h('p', { class: 'muted small' }, 'Master details are edited on the master record (changes are logged).') : null,
  );
  const cards = data.enrollments.map((e) => enrollmentCard(e, { reload, focus: e.id === focusId }));
  mount(
    s.name,
    h('div', { class: 'page-head' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/registrations' }, '← Registrations'), h('h1', null, s.name), h('span', { class: 'muted mono' }, s.studentCode || '')),
    h('div', { class: 'stack' }, master, h('h2', { class: 'section-title' }, `Enrollments (${data.enrollments.length})`), cards.length ? cards : h('p', { class: 'muted' }, 'No enrollments.')),
  );
  if (focusId) document.getElementById(`enrollment-${focusId}`)?.scrollIntoView({ block: 'start' });
}

// ------------------------------------------------------------------ flagged conflicts

export async function viewFlags(params, stale) {
  const status = params.get('status') || 'open';
  const { flags } = await api('GET', `/api/registrations/flags?status=${encodeURIComponent(status)}`);
  if (stale()) return;
  const tabs = h(
    'nav',
    { class: 'tabs' },
    [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([id, text]) => h('a', { class: status === id ? 'tab active' : 'tab', href: `#/registrations/flags?status=${id}` }, text)),
  );
  const items = flags.map((f) => {
    const note = h('input', { placeholder: 'What was done (optional)', maxlength: '500', 'aria-label': 'Resolution note' });
    const resolve = h('form', { class: 'inline-form', novalidate: true }, note, h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, 'Mark resolved'));
    resolve.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', `/api/registrations/flags/${f.id}/resolve`, { note: note.value });
        toast('Resolved');
        go(`#/registrations/flags?status=${status}`);
      } catch (err) {
        toast(errorText(err), true);
      }
    });
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head flush' }, h('h2', null, f.entered.name || 'Registration'), h('span', { class: 'badge', 'data-status': f.status === 'open' ? 'verify' : 'closed' }, f.status === 'open' ? 'Open' : 'Resolved')),
      h(
        'dl',
        { class: 'info' },
        h('dt', null, 'Entered'),
        h('dd', null, [f.entered.phone, f.entered.email].filter(Boolean).join(' · ')),
        h('dt', null, 'Matches'),
        h('dd', null, f.matched.length ? f.matched.map((m, i) => [i ? ', ' : '', h('a', { href: `#/students/${m.id}` }, `${m.name} (${m.studentCode})`), ` on ${m.matchedBy.join(' and ')}`]) : 'No longer matches anyone'),
        h('dt', null, 'Flagged'),
        h('dd', null, `${fmtDateTime(f.createdAt)}${f.raisedBy ? ` by ${f.raisedBy.name}` : ''}`),
        f.note ? [h('dt', null, 'Note'), h('dd', null, f.note)] : null,
        f.status === 'resolved' ? [h('dt', null, 'Resolved'), h('dd', null, `${fmtDateTime(f.resolvedAt)}${f.resolvedBy ? ` by ${f.resolvedBy.name}` : ''}${f.resolutionNote ? `: ${f.resolutionNote}` : ''}`)] : null,
      ),
      f.status === 'open' ? resolve : null,
    );
  });
  mount(
    'Registration conflicts',
    h('div', { class: 'page-head' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/registrations' }, '← Registrations'), h('h1', null, 'Registration conflicts')),
    h('p', { class: 'muted lead' }, "An associate entered a mobile number or email that belongs to a student in the master, and said it is a different student. The registration was blocked. Check with the student, correct the master record if needed, then mark the conflict resolved."),
    tabs,
    items.length ? h('div', { class: 'stack' }, items) : h('p', { class: 'muted' }, status === 'open' ? 'No open conflicts.' : 'Nothing here.'),
  );
}

// Kept for the student master page: a student's internship registrations.
export const registrationsLink = (studentId, count) =>
  count && can('registrations.view') ? h('a', { class: 'btn btn-sm', href: `#/registrations/students/${studentId}` }, `Internship registrations (${count})`) : null;
