// The student master database and profile verification.
// Rendered with DOM APIs / textContent only. Never use innerHTML with data.

import { registrationsLink } from './registrations.js';
import { certBadge, emailBadge } from './certificates.js';
import { api, can, copyBtn, ensureMeta, errorText, field, fmtDate, fmtDateTime, go, h, label, mount, pagerEl, selectEl, showErrors, state, statusBadge, toast } from './core.js';

// ------------------------------------------------------------------ view: students (master database)

export const STUDENT_FILTERS = ['q', 'program', 'stream', 'yearOfStudy', 'sort'];

export const programTag = (id, extra) => h('span', { class: 'badge program' }, label('program', id), extra ? ` · ${extra}` : null);

// ------------------------------------------------------------------ profile verification

export const VERIFY_STATUS = {
  pending: 'Waiting for the student’s code',
  failed: 'Code not confirmed',
  verified: 'Confirmed by the student',
  resolved: 'Settled by staff',
};
export const RESOLUTION_TEXT = {
  code: 'The student confirmed it with the emailed code; the profile was updated with the submitted details.',
  link: 'Linked to the profile, which was kept as it was.',
  update: 'Linked to the profile, which was updated with the submitted details.',
  new_profile: 'A different person: given a profile of their own.',
  edited: 'Settled when the record itself was edited.',
};

export function verificationBadge(v) {
  const open = v.status === 'pending' || v.status === 'failed';
  const text = v.status === 'pending' && !v.codesSent ? 'Pending verification' : VERIFY_STATUS[v.status];
  return h('span', { class: 'badge', 'data-status': open ? 'verify' : v.status === 'verified' ? 'issued' : 'closed' }, text);
}

/**
 * A registration or enquiry whose email or mobile number belongs to a profile with different details:
 * the profile next to what was submitted, and the staff decision.
 */
export function verificationPanel(v, { reload, showRecord = true } = {}) {
  const open = v.status === 'pending' || v.status === 'failed';
  const shown = (field, value) => (field === 'stream' || field === 'yearOfStudy' ? label(field, value) : value) || h('span', { class: 'muted' }, '—');
  const rows = state.meta.profileFields
    .filter((f) => v.proposed[f.id] != null || v.student[f.id] != null)
    .map((f) => {
      const differs = v.conflicts.includes(f.id);
      return h(
        'tr',
        { class: differs ? 'differs' : null },
        h('th', { scope: 'row' }, f.label, differs ? h('span', { class: 'differs-mark' }, open ? 'differs' : 'differed') : null),
        h('td', null, shown(f.id, v.student[f.id])),
        h('td', null, shown(f.id, v.proposed[f.id])),
      );
    });
  const compare = h(
    'table',
    { class: 'compare' },
    h('thead', null, h('tr', null, h('th', null, ''), h('th', null, open ? 'On the profile' : 'Profile now'), h('th', null, 'Submitted'))),
    h('tbody', null, rows),
  );
  const record =
    v.record.type === 'certificate'
      ? h('a', { href: `#/certificates/${v.record.id}` }, `career guidance registration (${v.record.title}, certificate ${v.record.certificateId})`)
      : h('a', { href: `#/enquiries/${v.record.id}` }, `internship enquiry (${label('source', v.record.source)})`);
  const profile = h('a', { href: `#/students/${v.student.id}` }, `${v.student.name} (${v.student.studentCode})`);

  let codeLine = null;
  if (v.status === 'failed') codeLine = `A wrong code was entered too many times${v.codeSentTo ? ` (code sent to ${v.codeSentTo})` : ''}.`;
  else if (open) {
    codeLine = v.codesSent
      ? `${v.codesSent === 1 ? 'A code was' : `${v.codesSent} codes were`} emailed to ${v.codeSentTo}, last on ${fmtDateTime(v.lastSentAt)}${v.wrongCodes ? `; ${v.wrongCodes} wrong ${v.wrongCodes === 1 ? 'try' : 'tries'} so far` : ''}.`
      : 'No code was sent: the profile has no email, email is off, the record was added by staff, or the address reached today’s email limit.';
  }

  const actions = [];
  const act = (action, text, question, permission) => {
    if (!can(permission)) return;
    const b = h('button', { class: action === 'update' ? 'btn' : 'btn btn-ghost', type: 'button' }, text);
    b.addEventListener('click', async () => {
      if (!window.confirm(question)) return;
      b.disabled = true;
      try {
        await api('POST', `/api/verifications/${v.id}/resolve`, { action });
        toast('Verification settled');
        reload();
      } catch (err) {
        b.disabled = false;
        toast(errorText(err), true);
      }
    });
    actions.push(b);
  };
  if (open) {
    act('link', 'Same person: keep the profile', `Link this record to ${v.student.name} and keep the profile as it is?`, 'students.create');
    act('update', 'Same person: update the profile', `Link this record to ${v.student.name} and replace the profile’s details with the submitted ones?`, 'students.edit');
    act('new_profile', 'Different person: new profile', 'Give this person a profile and Student ID of their own? The email or mobile number that belongs to the existing profile stays with it.', 'students.create');
  }

  return h(
    'section',
    { class: 'card verify-card' },
    h(
      'div',
      { class: 'card-head flush' },
      h('h2', null, showRecord ? (v.record.type === 'certificate' ? 'Career guidance registration' : 'Internship enquiry') : 'Profile verification'),
      verificationBadge(v),
    ),
    h(
      'p',
      null,
      showRecord ? ['This ', record, ' was ', 'received ', fmtDateTime(v.record.createdAt), '. It '] : 'This record ',
      'uses the email or mobile number of ',
      profile,
      open ? ', but some details differ. The profile has not been changed and the record is not linked to it yet.' : ', with some details that differed.',
    ),
    compare,
    codeLine ? h('p', { class: 'muted small' }, codeLine) : null,
    open
      ? actions.length
        ? h('div', { class: 'row wrap' }, actions)
        : h('p', { class: 'muted small' }, 'A manager or admin decides which profile this belongs to.')
      : h('p', { class: 'muted small' }, RESOLUTION_TEXT[v.resolution] || '', v.resolvedBy ? ` ${v.resolvedBy.name}, ${fmtDateTime(v.resolvedAt)}.` : v.resolvedAt ? ` ${fmtDateTime(v.resolvedAt)}.` : ''),
  );
}

export async function viewVerifications(params, stale) {
  await ensureMeta();
  const status = params.get('status') === 'closed' ? 'closed' : 'open';
  const { verifications } = await api('GET', `/api/verifications?status=${status}`);
  if (stale()) return;
  const reload = () => {
    const seq = state.seq;
    viewVerifications(params, () => seq !== state.seq).catch((err) => toast(errorText(err), true));
  };
  const tab = (id, text) => h('a', { class: status === id ? 'btn btn-sm' : 'btn btn-ghost btn-sm', href: `#/students/verifications${id === 'closed' ? '?status=closed' : ''}`, 'aria-current': status === id ? 'page' : null }, text);
  mount(
    'Profile verification',
    h('div', { class: 'page-head' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/students' }, '← Students')),
    h('div', { class: 'page-head' }, h('h1', null, 'Profile verification'), h('span', { class: 'spacer' }), tab('open', 'Waiting'), tab('closed', 'Settled')),
    h(
      'p',
      { class: 'muted lead' },
      'Registrations and enquiries whose email or mobile number belongs to an existing student, but with other details that differ. Profiles are never overwritten automatically: the student confirms the change with a code emailed to the address on their profile, or staff decide here.',
    ),
    verifications.length
      ? h('div', { class: 'stack' }, verifications.map((v) => verificationPanel(v, { reload })))
      : h('div', { class: 'card' }, h('p', { class: 'empty' }, status === 'open' ? 'Nothing is waiting for verification.' : 'Nothing has been settled yet.')),
  );
}

export async function viewStudents(params, stale) {
  await ensureMeta();
  const query = new URLSearchParams();
  for (const k of STUDENT_FILTERS) if (params.get(k)) query.set(k, params.get(k));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const data = await api('GET', `/api/students?${query}&page=${page}&pageSize=25`);
  if (stale()) return;
  const meta = state.meta;

  const search = h('input', { type: 'search', name: 'q', placeholder: 'Search name, email, phone, college or Student ID', value: params.get('q') || '', 'aria-label': 'Search' });
  const selects = [
    ['program', meta.programs, 'All programmes'],
    ['stream', meta.streams, 'All streams'],
    ['yearOfStudy', meta.years, 'Any year'],
    [
      'sort',
      [
        { id: 'name', label: 'Name A–Z' },
        { id: 'created', label: 'Newest first' },
      ],
      'Recent activity',
    ],
  ].map(([name, list, empty]) => {
    const sel = selectEl(name, list, params.get(name) || '', { empty });
    sel.setAttribute('aria-label', empty);
    return sel;
  });
  const form = h('form', { class: 'filters filters-students', role: 'search' }, h('div', { class: 'search' }, search, h('button', { class: 'btn', type: 'submit' }, 'Search')), selects);
  const apply = () => {
    const p = new URLSearchParams();
    if (search.value.trim()) p.set('q', search.value.trim());
    for (const sel of selects) if (sel.value) p.set(sel.name, sel.value);
    go(`#/students${p.toString() ? `?${p}` : ''}`);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    apply();
  });
  form.addEventListener('change', (e) => {
    if (e.target !== search) apply();
  });

  const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
  const dash = () => h('span', { class: 'muted' }, '—');
  const rows = data.items.map((st) =>
    h(
      'tr',
      null,
      h('td', { class: 'primary', 'data-label': 'Name' }, h('a', { class: 'name', href: `#/students/${st.id}` }, st.name), st.email ? h('span', { class: 'sub' }, st.email) : null),
      td('Student ID', st.studentCode ? h('span', { class: 'mono nowrap' }, st.studentCode) : dash()),
      td('Phone', st.phone ? h('span', { class: 'nowrap' }, st.phone) : dash()),
      td('College', st.college || dash()),
      td('Stream', label('stream', st.stream) || dash(), st.yearOfStudy ? h('span', { class: 'sub' }, label('yearOfStudy', st.yearOfStudy)) : null),
      td(
        'Programmes',
        h(
          'div',
          { class: 'tags' },
          st.certificates ? programTag('career-guidance', `${st.certificates} ${st.certificates === 1 ? 'certificate' : 'certificates'}`) : null,
          st.enquiries ? [programTag('internship'), statusBadge(st.latestEnquiryStatus)] : null,
          st.registrations ? h('span', { class: 'badge', 'data-status': 'enrolled' }, `${st.registrations} internship ${st.registrations === 1 ? 'registration' : 'registrations'}`) : null,
          st.pendingVerifications ? h('span', { class: 'badge', 'data-status': 'verify' }, `${st.pendingVerifications} to verify`) : null,
          !st.certificates && !st.enquiries && !st.registrations && !st.pendingVerifications ? dash() : null,
        ),
      ),
      td('Last activity', h('span', { class: 'nowrap' }, fmtDateTime(st.lastActivityAt))),
    ),
  );
  const heads = ['Name', 'Student ID', 'Phone', 'College', 'Stream / year', 'Programmes', 'Last activity'];
  const table = h(
    'table',
    { class: 'stackable' },
    h('thead', null, h('tr', null, heads.map((t) => h('th', null, t)))),
    h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: String(heads.length), class: 'empty' }, data.total === 0 && !query.toString() ? 'No students yet. They appear here when they register for a certificate or send an enquiry.' : 'No students match these filters.'))),
  );
  const hrefFor = (n) => {
    const p = new URLSearchParams(params);
    p.set('page', String(n));
    return `#/students?${p}`;
  };
  const hasFilters = STUDENT_FILTERS.some((k) => params.get(k));
  mount(
    'Students',
    h(
      'div',
      { class: 'page-head' },
      h('h1', null, 'Students'),
      h('span', { class: 'muted' }, `${data.total} ${data.total === 1 ? 'student' : 'students'}`),
      hasFilters ? h('a', { class: 'btn btn-ghost btn-sm', href: '#/students' }, 'Clear filters') : null,
      h('span', { class: 'spacer' }),
      can('students.export') ? h('a', { class: 'btn', href: `/api/students/export?${query}`, download: '' }, 'Export CSV') : null,
    ),
    h(
      'p',
      { class: 'muted lead' },
      'The master student database: one profile and one Student ID per student, tagged with every programme they took part in. Students are matched by email or mobile number, so a returning student is never added twice; when the other details differ, the profile is not overwritten and the record waits for verification.',
    ),
    data.pendingVerifications
      ? h(
          'a',
          { class: 'notice notice-link', href: '#/students/verifications' },
          h('strong', null, `${data.pendingVerifications} ${data.pendingVerifications === 1 ? 'registration or enquiry is' : 'registrations or enquiries are'} waiting for profile verification.`),
          ' They are not counted on a profile until verified. Review →',
        )
      : null,
    form,
    h('div', { class: 'card card-flush' }, h('div', { class: 'table-wrap' }, table)),
    pagerEl(data, hrefFor),
  );
}

export async function viewStudentDetail(id, stale) {
  await ensureMeta();
  const data = await api('GET', `/api/students/${id}`);
  if (stale()) return;
  const st = data.student;
  const meta = state.meta;
  const reload = () => {
    const seq = state.seq;
    viewStudentDetail(id, () => seq !== state.seq).catch((err) => toast(errorText(err), true));
  };

  const dl = h('dl', { class: 'info' });
  const add = (k, v) => {
    if (v === null || v === undefined || v === '') return;
    dl.append(h('dt', null, k), h('dd', null, v));
  };
  add('Student ID', st.studentCode ? h('span', { class: 'row' }, h('span', { class: 'mono' }, st.studentCode), copyBtn(st.studentCode)) : null);
  add('College', st.college);
  add('Gender', label('gender', st.gender));
  add('Date of birth', st.dateOfBirth ? fmtDate(st.dateOfBirth) : null);
  add('Qualification', [st.qualification, st.specialization].filter(Boolean).join(', '));
  add('Stream', label('stream', st.stream));
  add('Year of study', label('yearOfStudy', st.yearOfStudy));
  add('Year of graduation', st.graduationYear);
  add('City / state', [st.city, st.state].filter(Boolean).join(', '));
  add('First seen', fmtDateTime(st.createdAt));
  add('Profile updated', fmtDateTime(st.updatedAt));
  const contact = h(
    'div',
    { class: 'contact' },
    st.phone ? h('a', { href: `tel:${st.phone}` }, st.phone) : null,
    st.email ? h('a', { href: `mailto:${st.email}` }, st.email) : null,
  );
  const tags = h('div', { class: 'tags' }, (st.programs || []).map((p) => programTag(p)));

  // Every registration and enquiry of this student, newest first, each kept as its own record.
  const history = [
    ...data.certificates.map((r) => ({
      at: r.createdAt,
      program: 'career-guidance',
      what: h('a', { href: `#/certificates/${r.id}` }, `Certificate: ${r.session.title}`),
      sub: `Session ${fmtDate(r.session.sessionDate)} · ${r.certificateId}`,
      badge: certBadge(r.status),
    })),
    ...data.enquiries.map((i) => ({
      at: i.createdAt,
      program: 'internship',
      what: h('a', { href: `#/enquiries/${i.id}` }, `${label('source', i.source)} enquiry`),
      sub: [i.domain, label('plan', i.plan)].filter(Boolean).join(' · '),
      badge: statusBadge(i.status),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  const historyCard = h(
    'section',
    { class: 'card card-flush' },
    h('h2', null, `Participation history (${history.length})`),
    history.length
      ? h(
          'ol',
          { class: 'history' },
          history.map((e) =>
            h(
              'li',
              null,
              h('span', { class: 'muted nowrap' }, fmtDateTime(e.at)),
              h('span', { class: 'grow' }, programTag(e.program), ' ', e.what, e.sub ? h('span', { class: 'sub' }, e.sub) : null),
              e.badge,
            ),
          ),
        )
      : h('p', { class: 'empty' }, 'No registrations or enquiries yet.'),
  );
  const verificationCards = (data.verifications || []).map((v) => verificationPanel(v, { reload }));

  const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
  const certTable = h(
    'table',
    { class: 'stackable' },
    h('thead', null, h('tr', null, ['Session', 'Certificate', 'Name printed', 'Email', 'Status'].map((t) => h('th', null, t)))),
    h(
      'tbody',
      null,
      data.certificates.length
        ? data.certificates.map((r) =>
            h(
              'tr',
              null,
              h('td', { class: 'primary', 'data-label': 'Session' }, h('a', { class: 'name', href: `#/sessions/${r.session.id}` }, r.session.title), h('span', { class: 'sub' }, fmtDate(r.session.sessionDate))),
              td('Certificate', h('a', { class: 'mono nowrap', href: `#/certificates/${r.id}` }, r.certificateId)),
              td('Name printed', r.name),
              td('Email', emailBadge(r.emailStatus)),
              td('Status', certBadge(r.status)),
            ),
          )
        : h('tr', null, h('td', { colspan: '5', class: 'empty' }, 'No career guidance certificates.')),
    ),
  );
  const enquiryTable = h(
    'table',
    { class: 'stackable' },
    h('thead', null, h('tr', null, ['Received', 'Source', 'Domain / plan', 'Status'].map((t) => h('th', null, t)))),
    h(
      'tbody',
      null,
      data.enquiries.length
        ? data.enquiries.map((i) =>
            h(
              'tr',
              null,
              h('td', { class: 'primary', 'data-label': 'Received' }, h('a', { class: 'name', href: `#/enquiries/${i.id}` }, fmtDateTime(i.createdAt))),
              td('Source', label('source', i.source)),
              td('Domain / plan', i.domain || h('span', { class: 'muted' }, '—'), i.plan ? h('span', { class: 'sub' }, label('plan', i.plan)) : null),
              td('Status', statusBadge(i.status)),
            ),
          )
        : h('tr', null, h('td', { colspan: '4', class: 'empty' }, 'No internship enquiries.')),
    ),
  );

  const side = [];
  if (can('students.edit')) {
    const f = {
      name: h('input', { name: 'name', value: st.name, maxlength: '100', required: true }),
      email: h('input', { name: 'email', type: 'email', value: st.email || '', maxlength: '254' }),
      phone: h('input', { name: 'phone', type: 'tel', value: st.phone || '' }),
      college: h('input', { name: 'college', value: st.college || '', maxlength: '150' }),
      gender: selectEl('gender', meta.genders, st.gender || '', { empty: 'Not specified' }),
      dateOfBirth: h('input', { name: 'dateOfBirth', type: 'date', value: st.dateOfBirth || '' }),
      qualification: h('input', { name: 'qualification', value: st.qualification || '', maxlength: '100' }),
      specialization: h('input', { name: 'specialization', value: st.specialization || '', maxlength: '150' }),
      stream: selectEl('stream', meta.streams, st.stream || '', { empty: 'Not specified' }),
      yearOfStudy: selectEl('yearOfStudy', meta.years, st.yearOfStudy || '', { empty: 'Not specified' }),
      graduationYear: h('input', { name: 'graduationYear', type: 'number', min: '1980', max: String(new Date().getFullYear() + 6), value: st.graduationYear ?? '' }),
      city: h('input', { name: 'city', value: st.city || '', maxlength: '100' }),
      state: h('input', { name: 'state', value: st.state || '', maxlength: '100' }),
    };
    const editForm = h(
      'form',
      { class: 'card', novalidate: true },
      h('h2', null, 'Edit profile'),
      h(
        'div',
        { class: 'form-grid form-grid-1' },
        field('Name', f.name, { required: true }),
        field('Email', f.email),
        field('Phone', f.phone),
        field('College', f.college),
        field('Gender', f.gender),
        field('Date of birth', f.dateOfBirth),
        field('Qualification', f.qualification),
        field('Specialization', f.specialization),
        field('Stream', f.stream),
        field('Year of study', f.yearOfStudy),
        field('Year of graduation', f.graduationYear),
        field('City', f.city),
        field('State', f.state),
      ),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save profile')),
      h('p', { class: 'muted small' }, 'Changes the master record only; every change is recorded in the audit log. A certificate’s printed name and email are corrected on the certificate itself.'),
    );
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      for (const [k, el] of Object.entries(f)) body[k] = el.value.trim() || null;
      try {
        await api('PATCH', `/api/students/${id}`, body);
        toast('Profile saved');
        reload();
      } catch (err) {
        showErrors(editForm, err);
      }
    });
    side.push(editForm);
  }
  if (can('students.delete')) {
    const del = h('button', { class: 'btn btn-danger', type: 'button' }, 'Delete student and all records');
    del.addEventListener('click', async () => {
      const n = data.certificates.length + data.enquiries.length;
      if (!window.confirm(`Permanently delete ${st.name}, ${data.certificates.length} certificate(s) and ${data.enquiries.length} enquiry(ies)?\n\nCertificates will no longer verify. Rows already copied to the Google Sheet must be deleted there separately. This cannot be undone.`)) return;
      try {
        await api('DELETE', `/api/students/${id}`);
        toast(`Deleted ${st.name} and ${n} linked ${n === 1 ? 'record' : 'records'}`);
        go('#/students');
      } catch (err) {
        toast(errorText(err), true);
      }
    });
    side.push(
      h('section', { class: 'card danger-zone' }, h('h2', null, 'Erase data'), h('p', { class: 'muted small' }, 'Removes this student, their certificates, internship registrations (with payments and offer letters) and enquiries, with all activity logs (e.g. on the student’s request).'), del),
    );
  }

  mount(
    st.name,
    h('div', { class: 'page-head' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/students' }, '← Students')),
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, st.name), tags, contact), h('span', { class: 'spacer' }), registrationsLink(st.id, st.registrations)),
    h(
      'div',
      { class: 'detail' },
      h(
        'div',
        { class: 'stack' },
        verificationCards,
        h('section', { class: 'card' }, dl),
        historyCard,
        h('section', { class: 'card card-flush' }, h('h2', null, `Career guidance certificates (${data.certificates.length})`), h('div', { class: 'table-wrap' }, certTable)),
        h('section', { class: 'card card-flush' }, h('h2', null, `Internship enquiries (${data.enquiries.length})`), h('div', { class: 'table-wrap' }, enquiryTable)),
      ),
      h('div', { class: 'stack' }, side),
    ),
  );
}
