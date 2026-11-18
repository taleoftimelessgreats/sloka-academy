// Career guidance: sessions and certificates.
// Rendered with DOM APIs / textContent only. Never use innerHTML with data.

import { api, can, copyBtn, ensureMeta, errorText, field, fieldMessage, fmtDate, fmtDateTime, go, h, label, mount, pagerEl, selectEl, showErrors, state, statusBadge, toLocalInput, toast, newId, canAny } from './core.js';
import { route } from './main.js';
import { verificationPanel } from './students.js';

// ------------------------------------------------------------------ certificates: shared helpers

export const EVENT_LABELS = {
  registered: 'Registered, certificate issued',
  downloaded: 'First download by student',
  name_corrected: 'Name corrected',
  revoked: 'Revoked',
  reinstated: 'Reinstated',
  emailed: 'Certificate emailed',
  email_failed: 'Email failed',
  details_corrected: 'Details corrected',
  link_rotated: 'Download link replaced',
};

export const EMAIL_BADGES = {
  sent: ['Emailed', 'issued'],
  pending: ['Sending', 'pending'],
  failed: ['Failed', 'revoked'],
  off: ['Not emailed', 'closed'],
};
export function emailBadge(status) {
  const b = EMAIL_BADGES[status];
  if (!b) return h('span', { class: 'muted' }, '—');
  return h('span', { class: 'badge', 'data-status': b[1], title: status === 'off' ? 'Email is not set up on the server' : null }, b[0]);
}

export const certBadge = (status) => h('span', { class: 'badge', 'data-status': status }, status === 'revoked' ? 'Revoked' : 'Valid');
export const sessionBadge = (s) =>
  s.acceptingNow
    ? h('span', { class: 'badge', 'data-status': 'open' }, 'Open')
    : h('span', { class: 'badge', 'data-status': 'closed' }, s.registrationOpen ? 'Closed (deadline passed)' : 'Closed');
export const modeLabel = (m) => (m === 'online' ? 'Online' : 'In person');

export function registrationsTable(items, { showSession }) {
  const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
  const rows = items.map((r) =>
    h(
      'tr',
      null,
      h('td', { class: 'primary', 'data-label': 'Name' }, h('a', { class: 'name', href: `#/certificates/${r.id}` }, r.name), h('span', { class: 'sub' }, r.email)),
      td('Certificate', h('span', { class: 'mono nowrap' }, r.certificateId)),
      td('College', r.college),
      showSession ? td('Session', r.session.title, h('span', { class: 'sub' }, fmtDate(r.session.sessionDate))) : null,
      td('Issued', h('span', { class: 'nowrap' }, fmtDateTime(r.issuedAt))),
      td('Email', emailBadge(r.emailStatus)),
      h('td', { class: 'num', 'data-label': 'Downloads' }, r.downloadCount),
      td('Status', certBadge(r.status)),
    ),
  );
  const heads = ['Name', 'Certificate ID', 'College', showSession ? 'Session' : null, 'Issued', 'Email', 'Downloads', 'Status'].filter(Boolean);
  return h(
    'table',
    { class: 'stackable' },
    h('thead', null, h('tr', null, heads.map((t) => h('th', { class: t === 'Downloads' ? 'num' : null }, t)))),
    h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: String(heads.length), class: 'empty' }, 'No registrations yet.'))),
  );
}

// ------------------------------------------------------------------ view: sessions

export async function viewSessions(stale) {
  const { sessions } = await api('GET', '/api/sessions');
  if (stale()) return;
  const reload = () => {
    const seq = state.seq;
    viewSessions(() => seq !== state.seq).catch((err) => toast(errorText(err), true));
  };
  const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
  const rows = sessions.map((s) => {
    let regCell = sessionBadge(s);
    if (can('sessions.edit')) {
      const btn = h('button', { class: s.registrationOpen ? 'btn btn-sm' : 'btn btn-sm btn-primary', type: 'button' }, s.registrationOpen ? 'Close' : 'Open');
      btn.addEventListener('click', async () => {
        try {
          await api('PATCH', `/api/sessions/${s.id}`, { registrationOpen: !s.registrationOpen });
          toast(s.registrationOpen ? 'Registration closed' : 'Registration opened');
          reload();
        } catch (err) {
          toast(fieldMessage(err), true);
        }
      });
      regCell = h('div', { class: 'row' }, sessionBadge(s), btn);
    }
    return h(
      'tr',
      null,
      h('td', { class: 'primary', 'data-label': 'Session' }, h('a', { class: 'name', href: `#/sessions/${s.id}` }, s.title), s.venue ? h('span', { class: 'sub' }, s.venue) : null),
      td('Date', h('span', { class: 'nowrap' }, fmtDate(s.sessionDate))),
      td('Mode', modeLabel(s.mode)),
      td('Code', h('div', { class: 'row' }, h('span', { class: 'mono code' }, s.code), copyBtn(s.code))),
      td('Registration', regCell),
      h('td', { class: 'num', 'data-label': 'Registrations' }, h('a', { href: `#/sessions/${s.id}` }, s.registrations)),
    );
  });
  const table = h(
    'table',
    { class: 'stackable' },
    h('thead', null, h('tr', null, ['Session', 'Date', 'Mode', 'Code', 'Registration', 'Registrations'].map((t) => h('th', { class: t === 'Registrations' ? 'num' : null }, t)))),
    h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: '6', class: 'empty' }, 'No sessions yet.'))),
  );
  mount(
    'Sessions',
    h(
      'div',
      { class: 'page-head' },
      h('h1', null, 'Sessions'),
      h('span', { class: 'muted' }, 'Career guidance sessions and their certificate codes'),
      h('span', { class: 'spacer' }),
      can('sessions.create') ? h('a', { class: 'btn btn-primary', href: '#/sessions/new' }, '+ New session') : null,
    ),
    h('div', { class: 'card card-flush' }, h('div', { class: 'table-wrap' }, table)),
  );
}

export async function viewSessionForm(id, stale) {
  if (!can(id ? 'sessions.edit' : 'sessions.create')) return mount('Not allowed', h('p', { class: 'muted' }, 'You do not have permission to create or edit sessions.'));
  const [s, designs] = await Promise.all([id ? api('GET', `/api/sessions/${id}`).then((r) => r.session) : null, api('GET', '/api/templates')]);
  if (stale()) return undefined;
  const defaultDesign = designs.templates.find((t) => t.isDefault);
  const designOptions = designs.templates
    .filter((t) => !t.archived || (s && s.templateId === t.id))
    .map((t) => ({ id: t.id, label: t.archived ? `${t.name} (archived)` : t.name }));
  const f = {
    title: h('input', { name: 'title', maxlength: '120', required: true, value: s ? s.title : '' }),
    sessionDate: h('input', { name: 'sessionDate', type: 'date', required: true, value: s ? s.sessionDate : '' }),
    mode: selectEl('mode', [{ id: 'in-person', label: 'In person' }, { id: 'online', label: 'Online' }], s ? s.mode : 'in-person'),
    venue: h('input', { name: 'venue', maxlength: '150', value: s && s.venue ? s.venue : '', placeholder: 'College name, city' }),
    code: h('input', { name: 'code', maxlength: '20', class: 'mono', placeholder: s ? s.code : 'Auto-generate', autocomplete: 'off' }),
    closesAt: h('input', { name: 'closesAt', type: 'datetime-local', value: toLocalInput(s && s.closesAt) }),
    description: h('textarea', { name: 'description', maxlength: '2000' }),
    templateId: selectEl('templateId', designOptions, s && s.templateId ? s.templateId : '', { empty: `Default design (${defaultDesign ? defaultDesign.name : 'built-in Sloka design'})` }),
  };
  f.description.value = s && s.description ? s.description : '';
  const open = h('input', { type: 'checkbox', name: 'registrationOpen', id: newId(), checked: s ? s.registrationOpen : true });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, s ? 'Save session' : 'Create session');
  const form = h(
    'form',
    { class: 'card', novalidate: true },
    h(
      'div',
      { class: 'form-grid' },
      field('Title', f.title, { required: true, full: true, hint: 'Printed on the certificate. English letters and common punctuation.' }),
      field('Date', f.sessionDate, { required: true }),
      field('Mode', f.mode),
      field('Venue', f.venue, { hint: 'Required for in-person sessions. Printed on the certificate.' }),
      field(s ? 'New code (optional)' : 'Code (optional)', f.code, { hint: s ? 'Leave blank to keep the current code.' : 'Leave blank to auto-generate. Min 6 letters/digits.' }),
      field('Registration closes at (optional)', f.closesAt),
      field('Certificate design', f.templateId, { hint: 'Upload designs in Settings. Certificates keep the design they were issued with.' }),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'check', for: open.id }, open, h('span', null, 'Registration open')),
        h('small', { class: 'error', 'data-error-for': 'registrationOpen' }),
      ),
      field('Description (internal, optional)', f.description, { full: true }),
    ),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, submit, h('a', { class: 'btn btn-ghost', href: s ? `#/sessions/${s.id}` : '#/sessions' }, 'Cancel')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      title: f.title.value,
      sessionDate: f.sessionDate.value,
      mode: f.mode.value,
      venue: f.venue.value.trim() || null,
      description: f.description.value.trim() || null,
      registrationOpen: open.checked,
      closesAt: f.closesAt.value ? new Date(f.closesAt.value).toISOString() : null,
      templateId: f.templateId.value ? Number(f.templateId.value) : null,
    };
    if (f.code.value.trim()) body.code = f.code.value.trim();
    submit.disabled = true;
    try {
      const res = s ? await api('PATCH', `/api/sessions/${s.id}`, body) : await api('POST', '/api/sessions', body);
      toast(s ? 'Session saved' : 'Session created');
      go(`#/sessions/${res.session.id}`);
    } catch (err) {
      showErrors(form, err);
    } finally {
      submit.disabled = false;
    }
  });
  mount(s ? 'Edit session' : 'New session', h('div', { class: 'page-head' }, h('h1', null, s ? 'Edit session' : 'New session')), form);
  f.title.focus();
  return undefined;
}

export async function viewSessionDetail(id, params, stale) {
  const page = Math.max(1, Number(params.get('page')) || 1);
  // The participants' names and contacts need Participant (student) data → View (and the certificates).
  const seesParticipants = canAny('certificates.view+students.view');
  const [{ session: s }, regs, designs] = await Promise.all([
    api('GET', `/api/sessions/${id}`),
    seesParticipants ? api('GET', `/api/certificates?sessionId=${id}&page=${page}&pageSize=50`) : null,
    api('GET', '/api/templates'),
  ]);
  const design = s.templateId ? designs.templates.find((t) => t.id === s.templateId) : designs.templates.find((t) => t.isDefault);
  if (stale()) return;
  const reload = () => {
    const seq = state.seq;
    viewSessionDetail(id, params, () => seq !== state.seq).catch((err) => toast(errorText(err), true));
  };
  const act = (method, path, body, msg) => async () => {
    try {
      await api(method, path, body);
      toast(msg);
      reload();
    } catch (err) {
      toast(fieldMessage(err), true);
    }
  };

  const dl = h('dl', { class: 'info' });
  const add = (k, v) => v && dl.append(h('dt', null, k), h('dd', null, v));
  add('Date', fmtDate(s.sessionDate));
  add('Mode', modeLabel(s.mode));
  add('Venue', s.venue);
  add('Registration', sessionBadge(s));
  add('Closes at', s.closesAt ? fmtDateTime(s.closesAt) : null);
  add('Registrations', String(s.registrations));
  add('Certificate design', `${design ? design.name : 'Built-in Sloka design'}${s.templateId ? '' : ' (default)'}`);
  add('Created', `${fmtDateTime(s.createdAt)}${s.createdBy ? ` by ${s.createdBy.name}` : ''}`);
  add('Description', s.description ? h('span', { class: 'pre' }, s.description) : null);

  const codeCard = h(
    'section',
    { class: 'card' },
    h('h2', null, 'Session code'),
    h('p', { class: 'muted small' }, 'Announce this at the end of the session. Students need it to get their certificate.'),
    h('div', { class: 'row' }, h('span', { class: 'mono code code-lg' }, s.code), copyBtn(s.code)),
    can('sessions.edit')
      ? h(
          'div',
          { class: 'form-actions' },
          h(
            'button',
            {
              class: 'btn btn-sm',
              type: 'button',
              onclick: () => {
                if (window.confirm('Generate a new code? The old code will stop working immediately.')) {
                  act('POST', `/api/sessions/${id}/regenerate-code`, {}, 'New code generated')();
                }
              },
            },
            'Regenerate code',
          ),
        )
      : null,
  );

  const linkRow = (url) => h('div', { class: 'row' }, h('a', { class: 'mono break', href: url, target: '_blank', rel: 'noopener noreferrer' }, url), copyBtn(url));
  const linkCard = h(
    'section',
    { class: 'card' },
    h('h2', null, 'Student links'),
    h('p', { class: 'muted small' }, 'With the code filled in: share this link (or a QR code of it) at the end of the session. Anyone who has it can get a certificate, so do not share it earlier.'),
    linkRow(s.studentLinkWithCode),
    h('p', { class: 'muted small' }, 'Without the code: opens the form with this session selected; students type the code you announce.'),
    linkRow(s.studentLink),
  );

  let adminCard = null;
  if (canAny('sessions.edit', 'sessions.delete')) {
    const canDelete = can('sessions.delete');
    const del = h('button', { class: 'btn btn-danger', type: 'button', disabled: s.registrations > 0, title: s.registrations > 0 ? 'Sessions with registrations cannot be deleted' : null }, 'Delete session');
    del.addEventListener('click', async () => {
      if (!window.confirm(`Delete the session "${s.title}"?`)) return;
      try {
        await api('DELETE', `/api/sessions/${id}`);
        toast('Session deleted');
        go('#/sessions');
      } catch (err) {
        toast((err.data && err.data.message) || errorText(err), true);
      }
    });
    adminCard = h(
      'section',
      { class: 'card' },
      h('h2', null, 'Manage'),
      h(
        'div',
        { class: 'row' },
        h('a', { class: 'btn', href: `#/sessions/${id}/edit` }, 'Edit'),
        h('button', { class: s.registrationOpen ? 'btn' : 'btn btn-primary', type: 'button', onclick: act('PATCH', `/api/sessions/${id}`, { registrationOpen: !s.registrationOpen }, s.registrationOpen ? 'Registration closed' : 'Registration opened') }, s.registrationOpen ? 'Close registration' : 'Open registration'),
        canAny('sessions.export+students.view') ? h('a', { class: 'btn', href: `/api/sessions/${id}/export`, download: '' }, 'Export CSV') : null,
        canDelete ? del : null,
      ),
      canDelete && s.registrations > 0 ? h('p', { class: 'muted small' }, 'Sessions with registrations cannot be deleted; close registration instead.') : null,
    );
  }

  const hrefFor = (n) => `#/sessions/${id}?page=${n}`;
  mount(
    s.title,
    h('div', { class: 'page-head' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/sessions' }, '← Sessions')),
    h('div', { class: 'page-head' }, h('h1', null, s.title), sessionBadge(s)),
    h(
      'div',
      { class: 'detail' },
      h(
        'div',
        { class: 'stack' },
        h('section', { class: 'card' }, dl),
        regs
          ? h('section', { class: 'card card-flush' }, h('h2', null, `Registrations (${regs.total})`), h('div', { class: 'table-wrap' }, registrationsTable(regs.items, { showSession: false })))
          : h('section', { class: 'card' }, h('h2', null, `Registrations (${s.registrations})`), h('p', { class: 'muted small' }, 'Seeing who registered needs the Participant (student) data → View permission.')),
        regs && regs.total > regs.pageSize ? pagerEl(regs, hrefFor) : null,
      ),
      h('div', { class: 'stack' }, codeCard, linkCard, adminCard),
    ),
  );
}

// ------------------------------------------------------------------ view: certificates

export async function viewCertificates(params, stale) {
  const query = new URLSearchParams();
  for (const k of ['q', 'sessionId', 'status', 'emailStatus']) if (params.get(k)) query.set(k, params.get(k));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [{ sessions }, data] = await Promise.all([api('GET', '/api/sessions'), api('GET', `/api/certificates?${query}&page=${page}&pageSize=25`)]);
  if (stale()) return;

  const search = h('input', { type: 'search', name: 'q', placeholder: 'Search name, email, phone, college or certificate ID', value: params.get('q') || '', 'aria-label': 'Search' });
  const sessionSel = selectEl('sessionId', sessions.map((s) => ({ id: s.id, label: `${s.title} (${fmtDate(s.sessionDate)})` })), params.get('sessionId') || '', { empty: 'All sessions' });
  sessionSel.setAttribute('aria-label', 'Session');
  const statusSel = selectEl('status', [{ id: 'issued', label: 'Valid' }, { id: 'revoked', label: 'Revoked' }], params.get('status') || '', { empty: 'Any status' });
  statusSel.setAttribute('aria-label', 'Status');
  const emailSel = selectEl('emailStatus', [{ id: 'sent', label: 'Emailed' }, { id: 'failed', label: 'Email failed' }, { id: 'pending', label: 'Sending' }, { id: 'off', label: 'Not emailed' }], params.get('emailStatus') || '', { empty: 'Any email status' });
  emailSel.setAttribute('aria-label', 'Email status');
  const form = h('form', { class: 'filters filters-cert', role: 'search' }, h('div', { class: 'search' }, search, h('button', { class: 'btn', type: 'submit' }, 'Search')), sessionSel, statusSel, emailSel);
  const apply = () => {
    const p = new URLSearchParams();
    if (search.value.trim()) p.set('q', search.value.trim());
    if (sessionSel.value) p.set('sessionId', sessionSel.value);
    if (statusSel.value) p.set('status', statusSel.value);
    if (emailSel.value) p.set('emailStatus', emailSel.value);
    go(`#/certificates${p.toString() ? `?${p}` : ''}`);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    apply();
  });
  form.addEventListener('change', (e) => {
    if (e.target !== search) apply();
  });
  const hrefFor = (n) => {
    const p = new URLSearchParams(params);
    p.set('page', String(n));
    return `#/certificates?${p}`;
  };
  const hasFilters = ['q', 'sessionId', 'status', 'emailStatus'].some((k) => params.get(k));
  let retry = null;
  if (can('certificates.edit') && params.get('emailStatus') === 'failed' && data.total > 0) {
    retry = h('button', { class: 'btn btn-primary', type: 'button' }, 'Send all failed again');
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      try {
        const r = await api('POST', '/api/certificates/retry-emails', {});
        toast(`Sending ${r.queued} ${r.queued === 1 ? 'email' : 'emails'} again…`);
        setTimeout(() => route(), 2500);
      } catch (err) {
        toast(errorText(err), true);
        retry.disabled = false;
      }
    });
  }
  mount(
    'Certificates',
    h(
      'div',
      { class: 'page-head' },
      h('h1', null, 'Certificates'),
      h('span', { class: 'muted' }, `${data.total} ${data.total === 1 ? 'result' : 'results'}`),
      hasFilters ? h('a', { class: 'btn btn-ghost btn-sm', href: '#/certificates' }, 'Clear filters') : null,
      h('span', { class: 'spacer' }),
      retry,
      can('certificates.export') ? h('a', { class: 'btn', href: `/api/certificates/export?${query}`, download: '' }, 'Export CSV') : null,
    ),
    h('p', { class: 'muted lead' }, 'Career guidance registrations. Each one issues a certificate; the PDF is emailed to the student when email is set up.'),
    form,
    h('div', { class: 'card card-flush' }, h('div', { class: 'table-wrap' }, registrationsTable(data.items, { showSession: true }))),
    pagerEl(data, hrefFor),
  );
}

export async function viewCertificateDetail(id, stale) {
  await ensureMeta();
  const data = await api('GET', `/api/certificates/${id}`);
  if (stale()) return;
  const c = data.certificate;
  const reload = () => {
    const seq = state.seq;
    viewCertificateDetail(id, () => seq !== state.seq).catch((err) => toast(errorText(err), true));
  };

  const dl = h('dl', { class: 'info' });
  const add = (k, v) => {
    if (v === null || v === undefined || v === '') return;
    dl.append(h('dt', null, k), h('dd', null, v));
  };
  add('Certificate ID', h('span', { class: 'row' }, h('span', { class: 'mono' }, c.certificateId), copyBtn(c.certificateId)));
  add('Status', certBadge(c.status));
  add('Revoked because', c.revokedReason);
  add('Session', h('span', null, h('a', { href: `#/sessions/${c.session.id}` }, c.session.title), ` · ${fmtDate(c.session.sessionDate)}`));
  add('Issued', fmtDateTime(c.issuedAt));
  add('Certificate email', h('span', { class: 'row' }, emailBadge(c.emailStatus), c.emailedAt ? h('span', { class: 'muted small' }, `last sent ${fmtDateTime(c.emailedAt)}`) : null));
  add('Email problem', c.emailStatus === 'failed' ? h('span', { class: 'error-text' }, c.emailError) : null);
  add('Design', c.template ? c.template.name : 'Built-in Sloka design');
  add('Downloads', String(c.downloadCount));
  add('Last downloaded', c.lastDownloadedAt ? fmtDateTime(c.lastDownloadedAt) : 'Never');
  add('Email', h('a', { href: `mailto:${c.email}` }, c.email));
  add('Phone', h('a', { href: `tel:${c.phone}` }, c.phone));
  add('College', c.college);
  add('Stream', label('stream', c.stream));
  add('Year of study', label('yearOfStudy', c.yearOfStudy));
  add('Consent given', fmtDateTime(c.consentAt));
  add('Student ID', c.studentId ? h('a', { class: c.studentCode ? 'mono' : null, href: `#/students/${c.studentId}` }, c.studentCode || 'Open student record →') : data.verification ? h('span', { class: 'badge', 'data-status': 'verify' }, 'Pending verification') : null);

  const timeline = h(
    'ol',
    { class: 'timeline' },
    [...data.events].reverse().map((e) =>
      h(
        'li',
        { class: e.type === 'downloaded' || e.type === 'link_rotated' ? 'change' : 'note' },
        h('div', { class: 'meta' }, h('strong', null, EVENT_LABELS[e.type] || e.type), ` · ${fmtDateTime(e.createdAt)} · ${e.actor ? e.actor.name : 'Student'}`),
        e.detail ? h('div', { class: 'body pre' }, e.detail) : null,
      ),
    ),
  );

  // --- actions available to all staff
  const resend = h('button', { class: 'btn', type: 'button', disabled: !data.emailEnabled || c.status === 'revoked' }, c.emailStatus === 'failed' ? 'Try sending again' : 'Email certificate again');
  resend.addEventListener('click', async () => {
    if (!window.confirm(`Email the certificate PDF to ${c.email}? It includes a new download link; the previous link will stop working.`)) return;
    resend.disabled = true;
    try {
      const r = await api('POST', `/api/certificates/${id}/resend`, {});
      if (r.result === 'sent') toast(`Certificate emailed to ${c.email}`);
      else toast(`The email could not be sent: ${r.certificate.emailError || 'unknown error'}`, true);
      reload();
    } catch (err) {
      toast(errorText(err), true);
      resend.disabled = false;
    }
  });
  const actions = h(
    'section',
    { class: 'card' },
    h('h2', null, 'Certificate'),
    h(
      'div',
      { class: 'row' },
      h('a', { class: 'btn btn-primary', href: `/api/certificates/${id}/pdf`, download: '' }, 'Download PDF'),
      resend,
      copyBtn(data.verifyUrl, 'Copy verify link'),
    ),
    !data.emailEnabled ? h('p', { class: 'muted small' }, 'Email is not set up on the server, so certificates cannot be emailed. Download the PDF and send it yourself.') : null,
  );

  // --- manager / admin actions
  let adminCards = [];
  if (can('certificates.edit')) {
    const nameInput = h('input', { name: 'name', value: c.name, maxlength: '80', required: true });
    const emailInput = h('input', { name: 'email', type: 'email', value: c.email, maxlength: '254', required: true });
    const nameForm = h(
      'form',
      { class: 'card', novalidate: true },
      h('h2', null, 'Correct details'),
      h('div', { class: 'stack-sm' }, field('Name as printed on the certificate', nameInput), field('Email the certificate is sent to', emailInput)),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Save')),
      h('p', { class: 'muted small' }, 'After correcting the email, use “Email certificate again”.'),
    );
    nameForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      if (nameInput.value.trim() !== c.name) body.name = nameInput.value;
      if (emailInput.value.trim().toLowerCase() !== c.email) body.email = emailInput.value;
      if (!Object.keys(body).length) return toast('No changes to save');
      try {
        await api('PATCH', `/api/certificates/${id}`, body);
        toast('Details corrected');
        reload();
      } catch (err) {
        showErrors(nameForm, err);
      }
      return undefined;
    });

    let statusCard;
    if (c.status === 'revoked') {
      statusCard = h(
        'section',
        { class: 'card' },
        h('h2', null, 'Reinstate'),
        h('p', { class: 'muted small' }, 'Makes the certificate valid again; the student’s existing link works again.'),
        h(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            onclick: async () => {
              try {
                await api('POST', `/api/certificates/${id}/reinstate`, {});
                toast('Certificate reinstated');
                reload();
              } catch (err) {
                toast(fieldMessage(err), true);
              }
            },
          },
          'Reinstate certificate',
        ),
      );
    } else {
      const reason = h('input', { name: 'reason', maxlength: '300', placeholder: 'e.g. Did not attend the session' });
      statusCard = h(
        'form',
        { class: 'card', novalidate: true },
        h('h2', null, 'Revoke'),
        field('Reason (required)', reason),
        h('p', { class: 'form-error', role: 'alert' }),
        h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-danger', type: 'submit' }, 'Revoke certificate')),
      );
      statusCard.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('POST', `/api/certificates/${id}/revoke`, { reason: reason.value });
          toast('Certificate revoked');
          reload();
        } catch (err) {
          showErrors(statusCard, err);
        }
      });
    }

    const del = h('button', { class: 'btn btn-danger', type: 'button' }, 'Delete permanently');
    del.addEventListener('click', async () => {
      if (!window.confirm(`Permanently delete ${c.name}'s registration and certificate ${c.certificateId}?\n\nThe certificate will no longer verify. This cannot be undone.`)) return;
      try {
        await api('DELETE', `/api/certificates/${id}`);
        toast('Registration deleted');
        go('#/certificates');
      } catch (err) {
        toast(errorText(err), true);
      }
    });
    adminCards = [
      can('certificates.edit') ? nameForm : null,
      statusCard,
      can('certificates.delete')
        ? h('section', { class: 'card danger-zone' }, h('h2', null, 'Erase data'), h('p', { class: 'muted small' }, 'Removes the student’s data and activity log (e.g. on request).'), del)
        : null,
    ];
  }

  mount(
    c.name,
    h('div', { class: 'page-head' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/certificates' }, '← Certificates')),
    h('div', { class: 'page-head' }, h('h1', null, c.name), certBadge(c.status)),
    h(
      'div',
      { class: 'detail' },
      h(
        'div',
        { class: 'stack' },
        data.verification ? verificationPanel(data.verification, { reload, showRecord: false }) : null,
        h('section', { class: 'card' }, dl),
        data.referrals ? referralsCard(data.referrals) : null, // the friends are enquiries: only with Enquiry data → View
        h('section', { class: 'card' }, h('h2', null, 'Activity'), timeline),
      ),
      h('div', { class: 'stack' }, actions, adminCards),
    ),
  );
}

// Friends the student named under "Refer a friend". Each one is an enquiry the admissions team follows up.
export function referralsCard(friends) {
  if (!friends.length) return null;
  const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
  return h(
    'section',
    { class: 'card card-flush' },
    h('h2', null, `Friends referred (${friends.length})`),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'stackable' },
        h('thead', null, h('tr', null, ['Friend', 'Phone', 'Status', 'Assigned'].map((t) => h('th', null, t)))),
        h(
          'tbody',
          null,
          friends.map((f) =>
            h(
              'tr',
              null,
              h('td', { class: 'primary', 'data-label': 'Friend' }, h('a', { class: 'name', href: `#/enquiries/${f.id}` }, f.name), f.college ? h('span', { class: 'sub' }, f.college) : null),
              td('Phone', h('a', { class: 'nowrap', href: `tel:${f.phone}` }, f.phone)),
              td('Status', statusBadge(f.status)),
              td('Assigned', f.assignedTo || h('span', { class: 'muted' }, '—')),
            ),
          ),
        ),
      ),
    ),
  );
}
