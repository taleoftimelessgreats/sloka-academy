// Internship enquiries: list, detail, add.
// Rendered with DOM APIs / textContent only. Never use innerHTML with data.

import { addDays, api, can, ensureMeta, errorText, field, fmtDateTime, followUpCell, go, h, label, mount, selectEl, showErrors, staffOptions, state, statusBadge, toast, newId } from './core.js';
import { pipelineSummary } from './overview.js';
import { verificationPanel } from './students.js';

// ------------------------------------------------------------------ view: list

export const FILTER_KEYS = ['q', 'status', 'source', 'stream', 'plan', 'assignedTo', 'followUp', 'sort', 'dir'];
export const SORTS = [
  { id: 'createdAt:desc', label: 'Newest first' },
  { id: 'createdAt:asc', label: 'Oldest first' },
  { id: 'updatedAt:desc', label: 'Recently updated' },
  { id: 'nextFollowUp:asc', label: 'Follow-up date' },
  { id: 'name:asc', label: 'Name A–Z' },
];

export async function viewList(params, stale) {
  await ensureMeta();
  const query = new URLSearchParams();
  for (const k of FILTER_KEYS) if (params.get(k)) query.set(k, params.get(k));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [data, stats] = await Promise.all([api('GET', `/api/inquiries?${query}&page=${page}&pageSize=25`), api('GET', '/api/stats')]);
  if (stale()) return;
  state.lastListHash = location.hash || '#/enquiries';
  const meta = state.meta;

  const search = h('input', { type: 'search', name: 'q', placeholder: 'Search name, phone, email, college', value: params.get('q') || '', 'aria-label': 'Search' });
  const sortValue = params.get('sort') ? `${params.get('sort')}:${params.get('dir') || (params.get('sort') === 'nextFollowUp' || params.get('sort') === 'name' ? 'asc' : 'desc')}` : 'createdAt:desc';
  const assignees = [{ id: 'me', label: 'Assigned to me' }, { id: 'none', label: 'Unassigned' }, ...state.staff.map((s) => ({ id: s.id, label: s.active ? s.name : `${s.name} (inactive)` }))];
  const withNone = (list) => [...list, { id: 'none', label: 'Not specified' }];
  const selects = [
    ['status', meta.statuses, 'All statuses'],
    ['source', meta.sources, 'All sources'],
    ['stream', withNone(meta.streams), 'All streams'],
    ['plan', withNone(meta.plans), 'All plans'],
    ['assignedTo', assignees, 'Anyone'],
    ['followUp', [{ id: 'today', label: 'Due today' }, { id: 'overdue', label: 'Overdue' }, { id: 'due', label: 'Due or overdue' }], 'Any follow-up'],
  ].map(([name, list, empty]) => {
    const s = selectEl(name, list, params.get(name) || '', { empty });
    s.setAttribute('aria-label', empty);
    return s;
  });
  const sortSel = selectEl('sortdir', SORTS, sortValue);
  sortSel.setAttribute('aria-label', 'Sort');

  const filterForm = h(
    'form',
    { class: 'filters', role: 'search' },
    h('div', { class: 'search' }, search, h('button', { class: 'btn', type: 'submit' }, 'Search')),
    selects,
    sortSel,
  );
  const apply = () => {
    const p = new URLSearchParams();
    if (search.value.trim()) p.set('q', search.value.trim());
    for (const s of selects) if (s.value) p.set(s.name, s.value);
    const [sort, dir] = sortSel.value.split(':');
    if (sortSel.value !== 'createdAt:desc') {
      p.set('sort', sort);
      p.set('dir', dir);
    }
    go(`#/enquiries${p.toString() ? `?${p}` : ''}`);
  };
  filterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    apply();
  });
  filterForm.addEventListener('change', (e) => {
    if (e.target !== search) apply();
  });

  const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
  const rows = data.items.map((i) =>
    h(
      'tr',
      null,
      h('td', { class: 'primary', 'data-label': 'Name' }, h('a', { class: 'name', href: `#/enquiries/${i.id}` }, i.name), i.college ? h('span', { class: 'sub' }, i.college) : null),
      td('Phone', h('span', { class: 'nowrap' }, i.phone), i.email ? h('span', { class: 'sub' }, i.email) : null),
      td('Stream', label('stream', i.stream) || h('span', { class: 'muted' }, '—'), i.domain ? h('span', { class: 'sub' }, i.domain) : null),
      td('Plan', label('plan', i.plan) || h('span', { class: 'muted' }, '—')),
      td('Source', label('source', i.source), i.referredBy ? h('span', { class: 'sub' }, `by ${i.referredBy.name}`) : null),
      td('Status', statusBadge(i.status)),
      td('Assigned', i.assignedTo ? i.assignedTo.name : h('span', { class: 'muted' }, '—')),
      td('Follow-up', followUpCell(i)),
      td('Received', h('span', { class: 'nowrap' }, fmtDateTime(i.createdAt))),
    ),
  );
  const table = h(
    'table',
    { class: 'stackable' },
    h('thead', null, h('tr', null, ['Name', 'Phone / email', 'Stream', 'Plan', 'Source', 'Status', 'Assigned', 'Follow-up', 'Received'].map((t) => h('th', null, t)))),
    h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: '9', class: 'empty' }, 'No enquiries match these filters.'))),
  );

  const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = Math.min(data.total, data.page * data.pageSize);
  const pageHref = (n) => {
    const p = new URLSearchParams(params);
    p.set('page', String(n));
    return `#/enquiries?${p}`;
  };
  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pager = h(
    'div',
    { class: 'pager' },
    h('span', null, `${from}–${to} of ${data.total}`),
    data.page > 1 ? h('a', { class: 'btn btn-sm', href: pageHref(data.page - 1) }, '← Prev') : h('button', { class: 'btn btn-sm', type: 'button', disabled: true }, '← Prev'),
    data.page < lastPage ? h('a', { class: 'btn btn-sm', href: pageHref(data.page + 1) }, 'Next →') : h('button', { class: 'btn btn-sm', type: 'button', disabled: true }, 'Next →'),
  );

  const hasFilters = FILTER_KEYS.some((k) => params.get(k));
  mount(
    'Internship enquiries',
    h(
      'div',
      { class: 'page-head' },
      h('h1', null, 'Internship enquiries'),
      h('span', { class: 'muted' }, `${data.total} ${data.total === 1 ? 'result' : 'results'}`),
      hasFilters ? h('a', { class: 'btn btn-ghost btn-sm', href: '#/enquiries' }, 'Clear filters') : null,
      h('span', { class: 'spacer' }),
      can('enquiries.export') ? h('a', { class: 'btn', href: `/api/inquiries/export?${query}`, download: '' }, 'Export CSV') : null,
      can('enquiries.create') ? h('a', { class: 'btn btn-primary', href: '#/new' }, '+ Add enquiry') : null,
    ),
    h('p', { class: 'muted lead' }, 'Internship Course Program pre-registrations, contact-form messages, brochure requests, calls and walk-ins, plus friends referred on the career guidance certificate form. Each enquirer is also in Students, except referred friends (they did not fill in a form themselves).'),
    pipelineSummary(stats),
    filterForm,
    h('div', { class: 'card card-flush' }, h('div', { class: 'table-wrap' }, table)),
    pager,
  );
}

// ------------------------------------------------------------------ view: detail

export async function viewDetail(id, stale) {
  await ensureMeta();
  const { inquiry: inq, notes, verification } = await api('GET', `/api/inquiries/${id}`);
  if (stale()) return;
  const meta = state.meta;
  const reload = () => {
    const seq = state.seq;
    viewDetail(id, () => seq !== state.seq).catch((err) => toast(errorText(err), true));
  };

  // --- info
  const dl = h('dl', { class: 'info' });
  const add = (k, v) => {
    if (v === null || v === undefined || v === '') return;
    dl.append(h('dt', null, k), h('dd', null, v));
  };
  add('College', inq.college);
  add('Stream', label('stream', inq.stream));
  add('Year of study', label('yearOfStudy', inq.yearOfStudy));
  add('Domain', inq.domain);
  add('Plan', label('plan', inq.plan));
  add('Source', label('source', inq.source));
  const ref = inq.referredBy;
  add(
    'Referred by',
    ref ? h('span', null, h('a', { href: `#/certificates/${ref.registrationId}` }, ref.name), ref.college ? ` · ${ref.college}` : '', ' · ', h('span', { class: 'mono' }, ref.certificateId)) : null,
  );
  add('Brochure', inq.brochure);
  const via = inq.createdBy ? ` · added by ${inq.createdBy.name}` : inq.source === 'referral' ? ' · refer a friend (certificate form)' : ' · website form';
  add('Received', `${fmtDateTime(inq.createdAt)}${via}`);
  // A referred friend has not filled in a form: the student who referred them confirmed the friend agreed.
  add(inq.source === 'referral' ? 'Referrer confirmed consent' : 'Consent given', fmtDateTime(inq.consentAt));
  add('Last updated', fmtDateTime(inq.updatedAt));

  const contact = h(
    'div',
    { class: 'contact' },
    h('a', { href: `tel:${inq.phone}` }, inq.phone),
    inq.email ? h('a', { href: `mailto:${inq.email}` }, inq.email) : null,
  );

  const infoCard = h(
    'section',
    { class: 'card' },
    dl,
    inq.message ? h('div', { class: 'message' }, h('div', { class: 'muted small' }, 'Message from enquirer'), h('div', { class: 'pre' }, inq.message)) : null,
  );

  // --- notes timeline (newest first)
  const noteText = h('textarea', { name: 'body', placeholder: 'Call summary, next steps…', maxlength: '4000', required: true });
  const noteForm = h(
    'form',
    { novalidate: true },
    field('Add a note', noteText, { name: 'body' }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add note')),
  );
  noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', `/api/inquiries/${id}/notes`, { body: noteText.value });
      toast('Note added');
      reload();
    } catch (err) {
      showErrors(noteForm, err);
    }
  });
  const timeline = h(
    'ol',
    { class: 'timeline' },
    [...notes].reverse().map((n) =>
      h(
        'li',
        { class: n.kind === 'change' ? 'change' : 'note' },
        h('div', { class: 'meta' }, h('strong', null, n.author ? n.author.name : 'Unknown'), ` · ${fmtDateTime(n.createdAt)}${n.kind === 'change' ? ' · updated' : ''}`),
        h('div', { class: 'body pre' }, n.body),
      ),
    ),
  );
  const notesCard = h(
    'section',
    { class: 'card' },
    h('h2', null, 'Notes & history'),
    noteForm,
    notes.length ? timeline : h('p', { class: 'muted' }, 'No notes yet.'),
  );

  // --- follow-up panel
  const statusSel = selectEl('status', meta.statuses, inq.status);
  const assignSel = selectEl('assignedTo', staffOptions(inq.assignedTo && inq.assignedTo.id), inq.assignedTo ? inq.assignedTo.id : '', { empty: 'Unassigned' });
  const fuInput = h('input', { type: 'date', name: 'nextFollowUp', value: inq.nextFollowUp || '' });
  const quick = h(
    'div',
    { class: 'quick' },
    [['Today', 0], ['+1 day', 1], ['+3 days', 3], ['+1 week', 7]].map(([t, n]) =>
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { fuInput.value = addDays(state.today, n); } }, t),
    ),
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { fuInput.value = ''; } }, 'Clear'),
  );
  const followForm = h(
    'form',
    { class: 'card', novalidate: true },
    h('h2', null, 'Follow-up'),
    h(
      'div',
      { class: 'stack' },
      field('Status', statusSel),
      field('Assigned counsellor', assignSel),
      h('div', null, field('Next follow-up', fuInput), quick),
    ),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'), state.me ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { assignSel.value = String(state.me.id); } }, 'Assign to me') : null),
  );
  followForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {};
    if (statusSel.value !== inq.status) patch.status = statusSel.value;
    const assigned = assignSel.value ? Number(assignSel.value) : null;
    if (assigned !== (inq.assignedTo ? inq.assignedTo.id : null)) patch.assignedTo = assigned;
    if ((fuInput.value || null) !== (inq.nextFollowUp || null)) patch.nextFollowUp = fuInput.value || null;
    if (!Object.keys(patch).length) return toast('No changes to save');
    try {
      await api('PATCH', `/api/inquiries/${id}`, patch);
      toast('Saved');
      reload();
    } catch (err) {
      showErrors(followForm, err);
    }
  });

  // --- edit details
  const inputs = {
    name: h('input', { name: 'name', value: inq.name, maxlength: '100', required: true }),
    phone: h('input', { name: 'phone', type: 'tel', value: inq.phone, required: true }),
    email: h('input', { name: 'email', type: 'email', value: inq.email || '' }),
    college: h('input', { name: 'college', value: inq.college || '', maxlength: '150' }),
    stream: selectEl('stream', meta.streams, inq.stream, { empty: 'Not specified' }),
    yearOfStudy: selectEl('yearOfStudy', meta.years, inq.yearOfStudy, { empty: 'Not specified' }),
    domain: h('input', { name: 'domain', value: inq.domain || '', maxlength: '80', list: 'domain-list' }),
    plan: selectEl('plan', meta.plans, inq.plan, { empty: 'Not specified' }),
  };
  const editForm = h(
    'form',
    { novalidate: true },
    h(
      'div',
      { class: 'stack' },
      field('Name', inputs.name, { required: true }),
      field('Phone', inputs.phone, { required: true }),
      field('Email', inputs.email),
      field('College', inputs.college),
      field('Stream', inputs.stream),
      field('Year of study', inputs.yearOfStudy),
      field('Domain', inputs.domain),
      field('Plan', inputs.plan),
    ),
    domainList(),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Save details')),
  );
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {};
    for (const [k, el] of Object.entries(inputs)) {
      const v = el.value.trim();
      if (v !== (inq[k] || '')) patch[k] = v === '' ? null : v;
    }
    if (!Object.keys(patch).length) return toast('No changes to save');
    try {
      await api('PATCH', `/api/inquiries/${id}`, patch);
      toast('Details updated');
      reload();
    } catch (err) {
      showErrors(editForm, err);
    }
  });
  const editCard = h('section', { class: 'card' }, h('details', { class: 'more' }, h('summary', null, 'Edit contact & interest'), editForm));

  // --- admin: permanent delete
  let dangerCard = null;
  if (can('enquiries.delete')) {
    const del = h('button', { class: 'btn btn-danger', type: 'button' }, 'Delete permanently');
    del.addEventListener('click', async () => {
      const ok = window.confirm(`Permanently delete the enquiry from "${inq.name}" and all of its notes?\n\nUse this for erasure requests. This cannot be undone.`);
      if (!ok) return;
      try {
        await api('DELETE', `/api/inquiries/${id}`);
        toast('Enquiry permanently deleted');
        go(state.lastListHash);
      } catch (err) {
        toast(errorText(err), true);
      }
    });
    dangerCard = h(
      'section',
      { class: 'card danger-zone' },
      h('h2', null, 'Erase data'),
      h('p', { class: 'muted small' }, 'Permanently removes this enquiry and its notes (e.g. on the student’s request).'),
      del,
    );
  }

  mount(
    inq.name,
    h(
      'div',
      { class: 'page-head' },
      h('a', { class: 'btn btn-ghost btn-sm', href: state.lastListHash }, '← Internship enquiries'),
      inq.studentId ? h('a', { class: 'btn btn-ghost btn-sm', href: `#/students/${inq.studentId}` }, inq.studentCode ? `Student ${inq.studentCode} →` : 'Student record →') : verification ? h('span', { class: 'badge', 'data-status': 'verify' }, 'Pending verification') : null,
    ),
    h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, inq.name), statusBadge(inq.status)), contact)),
    h(
      'div',
      { class: 'detail' },
      h('div', { class: 'stack' }, verification ? verificationPanel(verification, { reload, showRecord: false }) : null, infoCard, notesCard),
      h('div', { class: 'stack' }, followForm, editCard, dangerCard),
    ),
  );
  // Read only without the permission to work enquiries (the API refuses the changes anyway).
  if (!can('enquiries.edit')) {
    for (const form of [followForm, editCard, notesCard]) {
      if (form) form.querySelectorAll('input, select, textarea, button').forEach((el) => (el.disabled = true));
    }
  }
}

export function domainList() {
  return h('datalist', { id: 'domain-list' }, (state.meta.domains || []).map((d) => h('option', { value: d })));
}

// ------------------------------------------------------------------ view: add enquiry

export async function viewNew(stale) {
  await ensureMeta();
  if (stale()) return;
  const meta = state.meta;
  const consent = h('input', { type: 'checkbox', name: 'consent', id: newId() });
  const c = {
    source: selectEl('source', meta.manualSources, 'phone-call', { required: true }),
    name: h('input', { name: 'name', maxlength: '100', required: true, autocomplete: 'off' }),
    phone: h('input', { name: 'phone', type: 'tel', required: true, placeholder: '98765 43210', autocomplete: 'off' }),
    email: h('input', { name: 'email', type: 'email', autocomplete: 'off' }),
    college: h('input', { name: 'college', maxlength: '150' }),
    stream: selectEl('stream', meta.streams, '', { empty: 'Not specified' }),
    yearOfStudy: selectEl('yearOfStudy', meta.years, '', { empty: 'Not specified' }),
    domain: h('input', { name: 'domain', maxlength: '80', list: 'domain-list', placeholder: 'e.g. VLSI' }),
    plan: selectEl('plan', meta.plans, '', { empty: 'Not specified' }),
    status: selectEl('status', meta.statuses, 'new'),
    assignedTo: selectEl('assignedTo', staffOptions(null), state.me.id, { empty: 'Unassigned' }),
    nextFollowUp: h('input', { name: 'nextFollowUp', type: 'date' }),
    note: h('textarea', { name: 'note', maxlength: '4000', placeholder: 'What did they ask about?' }),
  };
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save enquiry');
  const form = h(
    'form',
    { class: 'card', novalidate: true },
    h(
      'div',
      { class: 'form-grid' },
      field('Source', c.source, { required: true }),
      field('Name', c.name, { required: true }),
      field('Phone', c.phone, { required: true, hint: '10-digit Indian mobile number' }),
      field('Email', c.email),
      field('College', c.college),
      field('Stream', c.stream),
      field('Year of study', c.yearOfStudy),
      field('Domain of interest', c.domain),
      field('Plan of interest', c.plan),
      field('Status', c.status),
      field('Assigned counsellor', c.assignedTo),
      field('Next follow-up', c.nextFollowUp),
      field('Note', c.note, { full: true }),
      h(
        'div',
        { class: 'field field-full' },
        h('label', { class: 'check', for: consent.id }, consent, h('span', null, 'The enquirer agreed to Sloka Academy storing these details and contacting them about courses.', h('span', { class: 'req' }, ' *'))),
        h('small', { class: 'error', 'data-error-for': 'consent' }),
      ),
    ),
    domainList(),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, submit, h('a', { class: 'btn btn-ghost', href: state.lastListHash }, 'Cancel')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    for (const [k, el] of Object.entries(c)) body[k] = el.value.trim();
    body.assignedTo = body.assignedTo ? Number(body.assignedTo) : null;
    body.consent = consent.checked;
    submit.disabled = true;
    try {
      const res = await api('POST', '/api/inquiries', body);
      toast('Enquiry added');
      go(`#/enquiries/${res.inquiry.id}`);
    } catch (err) {
      showErrors(form, err);
    } finally {
      submit.disabled = false;
    }
  });
  mount('Add enquiry', h('div', { class: 'page-head' }, h('h1', null, 'Add enquiry'), h('span', { class: 'muted' }, 'Phone calls and walk-ins')), form);
  c.name.focus();
}
