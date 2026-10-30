/* Sloka Academy admin portal: students, career guidance sessions and certificates, internship enquiries.
 * Vanilla JS, no build step.
 * All data is rendered with DOM APIs / textContent. Never use innerHTML with data. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ DOM helpers

  const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'required', 'readOnly', 'open', 'selected', 'multiple']);
  let uid = 0;

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (PROPS.has(k)) el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c === undefined || c === null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function selectEl(name, list, value, { empty, required } = {}) {
    const s = h('select', { name, required });
    if (empty !== undefined) s.append(h('option', { value: '' }, empty));
    for (const o of list) s.append(h('option', { value: String(o.id), disabled: o.disabled }, o.label));
    s.value = value == null ? '' : String(value);
    return s;
  }

  function field(labelText, control, { name, hint, full, required } = {}) {
    const id = `f${++uid}`;
    control.id = id;
    return h(
      'div',
      { class: full ? 'field field-full' : 'field' },
      h('label', { for: id }, labelText, required ? h('span', { class: 'req' }, ' *') : null),
      control,
      hint ? h('small', { class: 'hint' }, hint) : null,
      h('small', { class: 'error', 'data-error-for': name || control.name || '' }),
    );
  }

  function clearErrors(form) {
    form.querySelectorAll('.error, .form-error').forEach((e) => {
      e.textContent = '';
    });
  }

  function showErrors(form, err) {
    clearErrors(form);
    const fields = (err && err.data && err.data.fields) || null;
    const general = form.querySelector('.form-error');
    if (fields) {
      const leftovers = [];
      for (const [key, msg] of Object.entries(fields)) {
        const slot = form.querySelector(`[data-error-for="${CSS.escape(key)}"]`);
        if (slot) slot.textContent = msg;
        else leftovers.push(msg);
      }
      if (general) general.textContent = leftovers.length ? leftovers.join(' ') : 'Please fix the highlighted fields.';
    } else if (general) {
      general.textContent = errorText(err);
    } else {
      toast(errorText(err), true);
    }
  }

  function errorText(err) {
    if (!err) return 'Something went wrong.';
    const code = err.data && err.data.error;
    const map = {
      invalid_credentials: 'Incorrect email or password.',
      rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
      forbidden: 'You do not have permission to do that.',
      not_found: 'Not found. It may have been deleted.',
      cross_site_request: 'Request blocked. Reload the page and try again.',
      payload_too_large: 'That file is too large (10 MB at most).',
    };
    if (map[code]) return map[code];
    if (err.data && typeof err.data.message === 'string') return err.data.message;
    if (err.status === 0) return 'Network error. Check your connection.';
    return `Something went wrong (${err.status || 'error'}).`;
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = isError ? 'toast err' : 'toast';
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.hidden = true;
    }, isError ? 5000 : 2500);
  }

  // ------------------------------------------------------------------ API

  class ApiError extends Error {
    constructor(status, data) {
      super((data && data.error) || `HTTP ${status}`);
      this.status = status;
      this.data = data || {};
    }
  }

  async function api(method, path, body) {
    const opts = { method, headers: {}, credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch {
      throw new ApiError(0, { error: 'network' });
    }
    let data = null;
    if (res.status !== 204) {
      const type = res.headers.get('content-type') || '';
      data = type.includes('application/json') ? await res.json().catch(() => null) : await res.text();
    }
    if (res.status === 401 && path !== '/api/auth/login') {
      state.me = null;
      renderChrome();
      if (parseHash().path !== '/login') go('#/login');
      throw new ApiError(401, data);
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  // ------------------------------------------------------------------ state & formatting

  const state = {
    me: null,
    meta: null,
    metaAt: 0,
    staff: [],
    labels: {},
    today: browserToday(),
    lastListHash: '#/enquiries',
    lastPath: null,
    seq: 0,
  };

  function browserToday() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function addDays(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().slice(0, 10);
  }

  const fmtDateTime = (iso) =>
    iso
      ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
  const fmtDate = (ymd) => {
    if (!ymd) return '';
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  function label(kind, id) {
    if (id === null || id === undefined || id === '') return '';
    const m = state.labels[kind];
    return (m && m.get(id)) || id;
  }

  async function ensureMeta(force = false) {
    if (!force && state.meta && Date.now() - state.metaAt < 5 * 60 * 1000) return;
    const [meta, staff] = await Promise.all([api('GET', '/api/meta'), api('GET', '/api/staff')]);
    state.meta = meta;
    state.metaAt = Date.now();
    state.staff = staff.staff;
    state.today = meta.today || state.today;
    const toMap = (list) => new Map(list.map((o) => [o.id, o.label]));
    state.labels = {
      stream: toMap(meta.streams),
      yearOfStudy: toMap(meta.years),
      plan: toMap(meta.plans),
      source: toMap(meta.sources),
      status: toMap(meta.statuses),
      role: toMap(meta.roles),
      program: toMap(meta.programs),
    };
  }

  // Permissions come from the server with the signed-in user (see PERMISSIONS in src/constants.js).
  const can = (permission) => Boolean(state.me && state.me.permissions && state.me.permissions.includes(permission));
  const isClosed = (status) => state.meta && state.meta.closedStatuses.includes(status);

  function statusBadge(status) {
    return h('span', { class: 'badge', 'data-status': status }, label('status', status));
  }

  function followUpCell(inq) {
    if (!inq.nextFollowUp) return h('span', { class: 'muted' }, '—');
    let cls = '';
    if (!isClosed(inq.status)) {
      if (inq.nextFollowUp < state.today) cls = 'fu-overdue';
      else if (inq.nextFollowUp === state.today) cls = 'fu-today';
    }
    const text = cls === 'fu-today' ? 'Today' : fmtDate(inq.nextFollowUp);
    return h('span', { class: cls || null, title: cls === 'fu-overdue' ? 'Overdue' : null }, text);
  }

  function staffOptions(currentId) {
    return state.staff
      .filter((s) => s.active || s.id === currentId)
      .map((s) => ({ id: s.id, label: s.active ? s.name : `${s.name} (inactive)` }));
  }

  // ------------------------------------------------------------------ router

  function parseHash() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const i = raw.indexOf('?');
    return { path: i < 0 ? raw : raw.slice(0, i), params: new URLSearchParams(i < 0 ? '' : raw.slice(i + 1)) };
  }

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  const $app = document.getElementById('app');

  function mount(title, ...nodes) {
    document.title = `${title} · Sloka Academy Admin`;
    // Like h(): leave out empty slots (replaceChildren would print them as the text "null").
    $app.replaceChildren(...nodes.flat(Infinity).filter((n) => n !== undefined && n !== null && n !== false));
  }

  function renderChrome() {
    const bar = document.getElementById('topbar');
    bar.hidden = !state.me;
    if (!state.me) return;
    document.getElementById('who-name').textContent = state.me.name;
    document.querySelectorAll('[data-requires]').forEach((el) => {
      el.hidden = !can(el.dataset.requires);
    });
    const { path } = parseHash();
    const first = path.slice(1).split('/')[0];
    const current = path === '/' ? 'overview' : first === 'new' ? 'enquiries' : first;
    document.querySelectorAll('[data-route]').forEach((a) => {
      a.classList.toggle('active', a.dataset.route === current);
    });
  }

  async function route() {
    const seq = ++state.seq;
    const { path, params } = parseHash();
    if (!state.me && path !== '/login') {
      go('#/login');
      return;
    }
    renderChrome();
    if (path !== state.lastPath) window.scrollTo(0, 0);
    state.lastPath = path;
    const stale = () => seq !== state.seq;
    try {
      let m;
      if (path === '/login') {
        if (state.me) return go('#/');
        viewLogin();
      } else if (path === '/') await viewOverview(stale);
      else if (path === '/enquiries') await viewList(params, stale);
      else if ((m = path.match(/^\/enquiries\/(\d+)$/))) await viewDetail(Number(m[1]), stale);
      else if (path === '/new') await viewNew(stale);
      else if (path === '/sessions') await viewSessions(stale);
      else if (path === '/sessions/new') await viewSessionForm(null, stale);
      else if ((m = path.match(/^\/sessions\/(\d+)\/edit$/))) await viewSessionForm(Number(m[1]), stale);
      else if ((m = path.match(/^\/sessions\/(\d+)$/))) await viewSessionDetail(Number(m[1]), params, stale);
      else if (path === '/certificates') await viewCertificates(params, stale);
      else if ((m = path.match(/^\/certificates\/(\d+)$/))) await viewCertificateDetail(Number(m[1]), stale);
      else if (path === '/students') await viewStudents(params, stale);
      else if (path === '/students/verifications') await viewVerifications(params, stale);
      else if ((m = path.match(/^\/students\/(\d+)$/))) await viewStudentDetail(Number(m[1]), stale);
      else if (path === '/settings' || path.startsWith('/settings/')) {
        if (!can('manage')) mount('Not allowed', h('p', { class: 'muted' }, 'Only managers and admins can change settings.'));
        else if ((m = path.match(/^\/settings\/templates\/(\d+)$/))) await viewTemplateEditor(Number(m[1]), stale);
        else await viewSettings(stale);
      } else if (path === '/users') {
        if (!can('manage')) mount('Not allowed', h('p', { class: 'muted' }, 'Only managers and admins can manage users.'));
        else await viewUsers(stale);
      } else if (path === '/account') viewAccount();
      else mount('Not found', h('p', { class: 'muted' }, 'Page not found. '), h('a', { href: '#/' }, 'Go to overview'));
      if (!stale() && !$app.contains(document.activeElement)) $app.focus({ preventScroll: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (stale()) return;
      mount('Error', h('div', { class: 'card' }, h('p', null, errorText(err)), h('a', { href: '#/' }, 'Back to overview')));
    }
  }

  // ------------------------------------------------------------------ views: login & account

  function viewLogin() {
    const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true });
    const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');
    const form = h(
      'form',
      { class: 'card login', novalidate: true },
      h('div', { class: 'brand-lg' }, 'Sloka Academy ', h('span', null, 'Admin')),
      field('Email', email, { name: 'email' }),
      field('Password', password, { name: 'password' }),
      h('p', { class: 'form-error', role: 'alert' }),
      submit,
      h('p', { class: 'muted small' }, 'Staff only. Ask an admin if you need an account.'),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      submit.disabled = true;
      try {
        const { user } = await api('POST', '/api/auth/login', { email: email.value, password: password.value });
        state.me = user;
        await ensureMeta(true);
        go('#/');
      } catch (err) {
        showErrors(form, err);
        password.value = '';
        password.focus();
      } finally {
        submit.disabled = false;
      }
    });
    mount('Sign in', h('div', { class: 'login-wrap' }, form));
    email.focus();
  }

  function viewAccount() {
    const current = h('input', { type: 'password', name: 'currentPassword', autocomplete: 'current-password', required: true });
    const next = h('input', { type: 'password', name: 'newPassword', autocomplete: 'new-password', required: true, minlength: '10' });
    const confirmPw = h('input', { type: 'password', name: 'confirm', autocomplete: 'new-password', required: true });
    const form = h(
      'form',
      { class: 'card', novalidate: true },
      h('h2', null, 'Change password'),
      h(
        'div',
        { class: 'form-grid' },
        field('Current password', current),
        field('New password', next, { hint: 'At least 10 characters.' }),
        field('Confirm new password', confirmPw),
      ),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Update password')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      if (next.value !== confirmPw.value) {
        form.querySelector('[data-error-for="confirm"]').textContent = 'Passwords do not match.';
        return;
      }
      try {
        await api('POST', '/api/auth/password', { currentPassword: current.value, newPassword: next.value });
        form.reset();
        toast('Password updated. Other sessions have been signed out.');
      } catch (err) {
        showErrors(form, err);
      }
    });
    mount(
      'Account',
      h('div', { class: 'page-head' }, h('h1', null, 'Account')),
      h(
        'div',
        { class: 'stack' },
        h(
          'div',
          { class: 'card' },
          h(
            'dl',
            { class: 'info' },
            h('dt', null, 'Name'),
            h('dd', null, state.me.name),
            h('dt', null, 'Email'),
            h('dd', null, state.me.email),
            h('dt', null, 'Role'),
            h('dd', null, label('role', state.me.role) || state.me.role),
          ),
        ),
        form,
      ),
    );
  }

  // ------------------------------------------------------------------ view: overview

  function conversionTable(title, rows, keyLabel) {
    const table = h(
      'table',
      null,
      h(
        'thead',
        null,
        h('tr', null, h('th', null, keyLabel), h('th', { class: 'num' }, 'Enquiries'), h('th', { class: 'num' }, 'Pre-registered'), h('th', { class: 'num' }, 'Enrolled'), h('th', { class: 'num' }, 'Enrolled %')),
      ),
      h(
        'tbody',
        null,
        rows.length
          ? rows.map((r) =>
              h('tr', null, h('td', null, r.label), h('td', { class: 'num' }, r.total), h('td', { class: 'num' }, r.preRegistered), h('td', { class: 'num' }, r.enrolled), h('td', { class: 'num' }, `${r.enrolledPct}%`)),
            )
          : h('tr', null, h('td', { colspan: '5', class: 'empty' }, 'No enquiries yet.')),
      ),
    );
    return h('section', { class: 'card card-flush' }, h('h2', null, title), h('div', { class: 'table-wrap' }, table));
  }

  async function viewOverview(stale) {
    const [s] = await Promise.all([api('GET', '/api/stats'), ensureMeta()]);
    if (stale()) return;
    state.today = s.today;
    const c = s.certificates;
    const sys = s.system;
    const card = (num, lbl, href, hot) =>
      h('a', { class: hot && num > 0 ? 'stat hot' : 'stat', href }, h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, lbl));

    // Things that need someone's attention.
    const alerts = [];
    if (c.emailFailed > 0) {
      alerts.push(
        h('a', { class: 'alert', href: '#/certificates?emailStatus=failed' }, h('strong', null, `${c.emailFailed} certificate ${c.emailFailed === 1 ? 'email' : 'emails'} failed.`), ' Open the list to check the addresses and send again.'),
      );
    }
    if (sys.sheet.configured && sys.sheet.lastError) {
      alerts.push(h('a', { class: 'alert', href: '#/settings' }, h('strong', null, 'Google Sheet sync is failing. '), sys.sheet.lastError));
    }
    if (s.pendingVerifications > 0) {
      alerts.push(
        h(
          'a',
          { class: 'alert alert-warn', href: '#/students/verifications' },
          h('strong', null, `${s.pendingVerifications} ${s.pendingVerifications === 1 ? 'registration or enquiry is' : 'registrations or enquiries are'} waiting for profile verification. `),
          'The email or mobile number matches an existing student but other details differ. Review →',
        ),
      );
    }

    const recent = s.recentRegistrations;
    const td = (lbl, ...x) => h('td', { 'data-label': lbl }, ...x);
    const recentTable = h(
      'table',
      { class: 'stackable' },
      h('thead', null, h('tr', null, ['Student', 'Session', 'Certificate', 'Email', 'Registered'].map((t) => h('th', null, t)))),
      h(
        'tbody',
        null,
        recent.length
          ? recent.map((r) =>
              h(
                'tr',
                null,
                h(
                  'td',
                  { class: 'primary', 'data-label': 'Student' },
                  h('a', { class: 'name', href: `#/certificates/${r.id}` }, r.name),
                  h('span', { class: 'sub' }, r.college),
                  r.studentId ? null : h('span', { class: 'badge', 'data-status': 'verify' }, 'Pending verification'),
                ),
                td('Session', r.session.title, h('span', { class: 'sub' }, fmtDate(r.session.sessionDate))),
                td('Certificate', h('span', { class: 'mono nowrap' }, r.certificateId), r.status === 'revoked' ? certBadge(r.status) : null),
                td('Email', emailBadge(r.emailStatus)),
                td('Registered', h('span', { class: 'nowrap' }, fmtDateTime(r.createdAt))),
              ),
            )
          : h('tr', null, h('td', { colspan: '5', class: 'empty' }, 'No registrations yet. Create a session, then share its student link.')),
      ),
    );

    const sessionList = s.sessions.length
      ? h(
          'ul',
          { class: 'plain-list' },
          s.sessions.map((x) =>
            h(
              'li',
              null,
              h('div', null, h('a', { class: 'name', href: `#/sessions/${x.id}` }, x.title), h('span', { class: 'sub' }, `${fmtDate(x.sessionDate)} · ${x.mode === 'online' ? 'Online' : x.venue || 'In person'}`)),
              h('div', { class: 'row' }, sessionBadge(x), h('span', { class: 'muted nowrap' }, `${x.registrations} registered`)),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'No sessions yet.');

    const statusLine = (name, ok, text, href) =>
      h('div', { class: 'status-line' }, h('span', { class: ok ? 'dot dot-ok' : 'dot dot-off' }), h('span', { class: 'status-name' }, name), can('manage') && href ? h('a', { href }, text) : h('span', { class: 'muted' }, text));
    let sheetText;
    if (!sys.sheet.connected) sheetText = 'Not connected on the server';
    else if (!sys.sheet.configured) sheetText = 'No sheet linked yet';
    else if (sys.sheet.lastError) sheetText = 'Sync failing, see Settings';
    else sheetText = sys.sheet.pending ? `${sys.sheet.pending} waiting to sync` : `Up to date${sys.sheet.lastSyncAt ? ` (${fmtDateTime(sys.sheet.lastSyncAt)})` : ''}`;
    const systemCard = h(
      'section',
      { class: 'card' },
      h('h2', null, 'Certificate delivery'),
      statusLine('Email to students', sys.emailEnabled, sys.emailEnabled ? 'On: the PDF is emailed on registration' : 'Off: students download only', '#/settings'),
      statusLine('Google Sheet', sys.sheet.configured && sys.sheet.connected && !sys.sheet.lastError, sheetText, '#/settings'),
      statusLine('Certificate design', true, sys.defaultTemplate || 'Built-in Sloka design', '#/settings'),
    );

    mount(
      'Overview',
      h(
        'div',
        { class: 'page-head' },
        h('h1', null, 'Overview'),
        h('span', { class: 'muted' }, fmtDate(s.today)),
        h('span', { class: 'spacer' }),
        can('manage') ? h('a', { class: 'btn btn-primary', href: '#/sessions/new' }, '+ New session') : null,
      ),
      alerts.length ? h('div', { class: 'stack alerts' }, alerts) : null,
      h(
        'div',
        { class: 'stats' },
        card(s.students, 'Students', '#/students', false),
        card(c.registrationsThisWeek, 'Registrations this week', '#/certificates', false),
        card(c.issuedTotal, 'Certificates issued', '#/certificates', false),
        card(c.openSessions, 'Open sessions', '#/sessions', false),
      ),
      h(
        'div',
        { class: 'detail' },
        h(
          'section',
          { class: 'card card-flush' },
          h('div', { class: 'card-head' }, h('h2', null, 'Latest registrations'), h('a', { class: 'small', href: '#/certificates' }, 'All certificates →')),
          h('div', { class: 'table-wrap' }, recentTable),
        ),
        h(
          'div',
          { class: 'stack' },
          h('section', { class: 'card' }, h('div', { class: 'card-head flush' }, h('h2', null, 'Sessions'), h('a', { class: 'small', href: '#/sessions' }, 'All sessions →')), sessionList),
          systemCard,
          h(
            'a',
            { class: 'card card-link', href: s.newCount ? '#/enquiries?status=new' : '#/enquiries' },
            h('span', null, h('strong', null, 'Internship enquiries'), h('span', { class: 'sub' }, 'Pre-registrations, contact and brochure requests')),
            h('span', { class: s.newCount ? 'badge' : 'muted', 'data-status': s.newCount ? 'new' : null }, s.newCount ? `${s.newCount} new` : `${s.total} total`),
          ),
        ),
      ),
    );
  }

  // Internship enquiry pipeline summary, shown on the enquiries page.
  function pipelineSummary(s) {
    const statusTable = h(
      'table',
      null,
      h('thead', null, h('tr', null, h('th', null, 'Status'), h('th', { class: 'num' }, 'Enquiries'))),
      h(
        'tbody',
        null,
        s.byStatus.map((r) =>
          h('tr', null, h('td', null, h('a', { href: `#/enquiries?status=${encodeURIComponent(r.status)}` }, statusBadge(r.status))), h('td', { class: 'num' }, r.count)),
        ),
      ),
    );
    return h(
      'details',
      { class: 'card summary-card' },
      h('summary', null, h('strong', null, 'Pipeline summary'), h('span', { class: 'muted' }, ` · ${s.newCount} new · ${s.dueToday} follow-ups due today · ${s.overdue} overdue`)),
      h(
        'div',
        { class: 'stack' },
        h('div', { class: 'grid-2' }, conversionTable('Conversion by stream', s.byStream, 'Stream'), conversionTable('Conversion by plan', s.byPlan, 'Plan')),
        h('section', { class: 'card card-flush' }, h('h2', null, 'Enquiries by status'), h('div', { class: 'table-wrap' }, statusTable)),
      ),
    );
  }

  // ------------------------------------------------------------------ view: list

  const FILTER_KEYS = ['q', 'status', 'source', 'stream', 'plan', 'assignedTo', 'followUp', 'sort', 'dir'];
  const SORTS = [
    { id: 'createdAt:desc', label: 'Newest first' },
    { id: 'createdAt:asc', label: 'Oldest first' },
    { id: 'updatedAt:desc', label: 'Recently updated' },
    { id: 'nextFollowUp:asc', label: 'Follow-up date' },
    { id: 'name:asc', label: 'Name A–Z' },
  ];

  async function viewList(params, stale) {
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
        td('Source', label('source', i.source)),
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
        can('export') ? h('a', { class: 'btn', href: `/api/inquiries/export?${query}`, download: '' }, 'Export CSV') : null,
        h('a', { class: 'btn btn-primary', href: '#/new' }, '+ Add enquiry'),
      ),
      h('p', { class: 'muted lead' }, 'Internship Course Program pre-registrations, contact-form messages, brochure requests, calls and walk-ins. Each enquirer is also in Students.'),
      pipelineSummary(stats),
      filterForm,
      h('div', { class: 'card card-flush' }, h('div', { class: 'table-wrap' }, table)),
      pager,
    );
  }

  // ------------------------------------------------------------------ view: detail

  async function viewDetail(id, stale) {
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
    add('Brochure', inq.brochure);
    add('Received', `${fmtDateTime(inq.createdAt)}${inq.createdBy ? ` · added by ${inq.createdBy.name}` : ' · website form'}`);
    add('Consent given', fmtDateTime(inq.consentAt));
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
    if (can('deleteRecords')) {
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
  }

  function domainList() {
    return h('datalist', { id: 'domain-list' }, (state.meta.domains || []).map((d) => h('option', { value: d })));
  }

  // ------------------------------------------------------------------ view: add enquiry

  async function viewNew(stale) {
    await ensureMeta();
    if (stale()) return;
    const meta = state.meta;
    const consent = h('input', { type: 'checkbox', name: 'consent', id: `f${++uid}` });
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

  // ------------------------------------------------------------------ view: users (admin)

  async function viewUsers(stale) {
    await ensureMeta();
    const { users } = await api('GET', '/api/users');
    if (stale()) return;
    const meta = state.meta;
    const reload = async () => {
      const seq = state.seq;
      try {
        await ensureMeta(true);
        await viewUsers(() => seq !== state.seq);
      } catch (err) {
        toast(errorText(err), true);
      }
    };

    // Managers cannot create, change or reset admins; deactivating staff is admin-only.
    const roles = can('manageAdmins') ? meta.roles : meta.roles.filter((r) => r.id !== 'admin');
    const nu = {
      name: h('input', { name: 'name', maxlength: '100', required: true, autocomplete: 'off' }),
      email: h('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' }),
      role: selectEl('role', roles, 'counsellor'),
      password: h('input', { name: 'password', type: 'password', required: true, autocomplete: 'new-password', minlength: '10' }),
    };
    const createForm = h(
      'form',
      { class: 'card', novalidate: true },
      h('h2', null, 'Add staff member'),
      h(
        'div',
        { class: 'form-grid' },
        field('Name', nu.name, { required: true }),
        field('Email', nu.email, { required: true }),
        field('Role', nu.role),
        field('Temporary password', nu.password, { required: true, hint: 'At least 10 characters. Ask them to change it under Account.' }),
      ),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create user')),
    );
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/users', { name: nu.name.value, email: nu.email.value, role: nu.role.value, password: nu.password.value });
        toast('User created');
        reload();
      } catch (err) {
        showErrors(createForm, err);
      }
    });

    const rows = users.map((u) => {
      const self = u.id === state.me.id;
      const locked = u.role === 'admin' && !can('manageAdmins');
      const roleSel = selectEl('role', locked ? meta.roles : roles, u.role);
      roleSel.disabled = self || locked;
      roleSel.setAttribute('aria-label', `Role for ${u.name}`);
      roleSel.addEventListener('change', async () => {
        try {
          await api('PATCH', `/api/users/${u.id}`, { role: roleSel.value });
          toast('Role updated');
          reload();
        } catch (err) {
          roleSel.value = u.role;
          toast(fieldMessage(err), true);
        }
      });
      const toggle = h('button', { class: u.active ? 'btn btn-sm btn-danger' : 'btn btn-sm', type: 'button', disabled: self }, u.active ? 'Deactivate' : 'Activate');
      toggle.addEventListener('click', async () => {
        if (u.active && !window.confirm(`Deactivate ${u.name}? They will be signed out immediately.`)) return;
        try {
          await api('PATCH', `/api/users/${u.id}`, { active: !u.active });
          toast(u.active ? 'User deactivated' : 'User activated');
          reload();
        } catch (err) {
          toast(fieldMessage(err), true);
        }
      });
      const pw = h('input', { type: 'password', placeholder: 'New password (min 10)', autocomplete: 'new-password', 'aria-label': `New password for ${u.name}` });
      const resetForm = h('form', { class: 'inline-form', hidden: true, novalidate: true }, pw, h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, 'Set'));
      resetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('POST', `/api/users/${u.id}/password`, { password: pw.value });
          toast(`Password reset for ${u.name}`);
          resetForm.hidden = true;
          pw.value = '';
        } catch (err) {
          toast(fieldMessage(err), true);
        }
      });
      const resetBtn = locked ? null : h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { resetForm.hidden = !resetForm.hidden; if (!resetForm.hidden) pw.focus(); } }, 'Reset password');
      const actions = [resetBtn, can('deactivateUsers') ? toggle : null].filter(Boolean);
      return h(
        'tr',
        null,
        h('td', { class: 'primary', 'data-label': 'Name' }, u.name, self ? h('span', { class: 'sub' }, 'You') : null),
        h('td', { 'data-label': 'Email' }, u.email),
        h('td', { 'data-label': 'Role' }, roleSel),
        h('td', { 'data-label': 'Status' }, u.active ? 'Active' : h('span', { class: 'muted' }, 'Inactive')),
        h('td', { 'data-label': 'Last login' }, u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : h('span', { class: 'muted' }, 'Never')),
        h('td', { 'data-label': 'Actions' }, actions.length ? h('div', null, h('div', { class: 'row' }, actions), resetForm) : h('span', { class: 'muted' }, '—')),
      );
    });
    const table = h(
      'table',
      { class: 'stackable' },
      h('thead', null, h('tr', null, ['Name', 'Email', 'Role', 'Status', 'Last login', 'Actions'].map((t) => h('th', null, t)))),
      h('tbody', null, rows),
    );
    mount(
      'Users',
      h('div', { class: 'page-head' }, h('h1', null, 'Users')),
      h('p', { class: 'muted lead' }, 'Counsellors work enquiries and view students, sessions and certificates. Managers can also run sessions, certificate designs, settings and staff accounts, and revoke certificates. Only admins can export data, edit or delete records, deactivate staff and manage admin accounts.'),
      h('div', { class: 'stack' }, h('div', { class: 'card card-flush' }, h('div', { class: 'table-wrap' }, table)), createForm),
    );
  }

  // ------------------------------------------------------------------ certificates: shared helpers

  const EVENT_LABELS = {
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

  const EMAIL_BADGES = {
    sent: ['Emailed', 'issued'],
    pending: ['Sending', 'pending'],
    failed: ['Failed', 'revoked'],
    off: ['Not emailed', 'closed'],
  };
  function emailBadge(status) {
    const b = EMAIL_BADGES[status];
    if (!b) return h('span', { class: 'muted' }, '—');
    return h('span', { class: 'badge', 'data-status': b[1], title: status === 'off' ? 'Email is not set up on the server' : null }, b[0]);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      const ta = h('textarea', { class: 'offscreen', readOnly: true });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      toast(ok ? 'Copied' : 'Could not copy. Select the text and copy it manually.', !ok);
    }
  }

  const copyBtn = (text, labelText = 'Copy') =>
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(text) }, labelText);

  const certBadge = (status) => h('span', { class: 'badge', 'data-status': status }, status === 'revoked' ? 'Revoked' : 'Valid');
  const sessionBadge = (s) =>
    s.acceptingNow
      ? h('span', { class: 'badge', 'data-status': 'open' }, 'Open')
      : h('span', { class: 'badge', 'data-status': 'closed' }, s.registrationOpen ? 'Closed (deadline passed)' : 'Closed');
  const modeLabel = (m) => (m === 'online' ? 'Online' : 'In person');

  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function pagerEl(data, hrefFor) {
    const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
    const to = Math.min(data.total, data.page * data.pageSize);
    const last = Math.max(1, Math.ceil(data.total / data.pageSize));
    const btn = (enabled, href, text) =>
      enabled ? h('a', { class: 'btn btn-sm', href }, text) : h('button', { class: 'btn btn-sm', type: 'button', disabled: true }, text);
    return h(
      'div',
      { class: 'pager' },
      h('span', null, `${from}–${to} of ${data.total}`),
      btn(data.page > 1, hrefFor(data.page - 1), '← Prev'),
      btn(data.page < last, hrefFor(data.page + 1), 'Next →'),
    );
  }

  function registrationsTable(items, { showSession }) {
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

  async function viewSessions(stale) {
    const { sessions } = await api('GET', '/api/sessions');
    if (stale()) return;
    const reload = () => {
      const seq = state.seq;
      viewSessions(() => seq !== state.seq).catch((err) => toast(errorText(err), true));
    };
    const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
    const rows = sessions.map((s) => {
      let regCell = sessionBadge(s);
      if (can('manage')) {
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
        can('manage') ? h('a', { class: 'btn btn-primary', href: '#/sessions/new' }, '+ New session') : null,
      ),
      h('div', { class: 'card card-flush' }, h('div', { class: 'table-wrap' }, table)),
    );
  }

  async function viewSessionForm(id, stale) {
    if (!can('manage')) return mount('Not allowed', h('p', { class: 'muted' }, 'Only managers and admins can create or edit sessions.'));
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
    const open = h('input', { type: 'checkbox', name: 'registrationOpen', id: `f${++uid}`, checked: s ? s.registrationOpen : true });
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

  async function viewSessionDetail(id, params, stale) {
    const page = Math.max(1, Number(params.get('page')) || 1);
    const [{ session: s }, regs, designs] = await Promise.all([
      api('GET', `/api/sessions/${id}`),
      api('GET', `/api/certificates?sessionId=${id}&page=${page}&pageSize=50`),
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
      can('manage')
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

    const linkCard = h(
      'section',
      { class: 'card' },
      h('h2', null, 'Student link'),
      h('p', { class: 'muted small' }, 'Share this link (or a QR code of it) with the students.'),
      h('div', { class: 'row' }, h('a', { class: 'mono break', href: s.studentLink, target: '_blank', rel: 'noopener noreferrer' }, s.studentLink), copyBtn(s.studentLink)),
    );

    let adminCard = null;
    if (can('manage')) {
      const canDelete = can('deleteRecords');
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
          can('export') ? h('a', { class: 'btn', href: `/api/sessions/${id}/export`, download: '' }, 'Export CSV') : null,
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
          h(
            'section',
            { class: 'card card-flush' },
            h('h2', null, `Registrations (${regs.total})`),
            h('div', { class: 'table-wrap' }, registrationsTable(regs.items, { showSession: false })),
          ),
          regs.total > regs.pageSize ? pagerEl(regs, hrefFor) : null,
        ),
        h('div', { class: 'stack' }, codeCard, linkCard, adminCard),
      ),
    );
  }

  // ------------------------------------------------------------------ view: certificates

  async function viewCertificates(params, stale) {
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
    if (can('manage') && params.get('emailStatus') === 'failed' && data.total > 0) {
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
        can('export') ? h('a', { class: 'btn', href: `/api/certificates/export?${query}`, download: '' }, 'Export CSV') : null,
      ),
      h('p', { class: 'muted lead' }, 'Career guidance registrations. Each one issues a certificate; the PDF is emailed to the student when email is set up.'),
      form,
      h('div', { class: 'card card-flush' }, h('div', { class: 'table-wrap' }, registrationsTable(data.items, { showSession: true }))),
      pagerEl(data, hrefFor),
    );
  }

  async function viewCertificateDetail(id, stale) {
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
    if (can('manage')) {
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
        can('editRecords') ? nameForm : null,
        statusCard,
        can('deleteRecords')
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
          h('section', { class: 'card' }, h('h2', null, 'Activity'), timeline),
        ),
        h('div', { class: 'stack' }, actions, adminCards),
      ),
    );
  }

  function fieldMessage(err) {
    const f = err && err.data && err.data.fields;
    return f ? Object.values(f).join(' ') : errorText(err);
  }

  // ------------------------------------------------------------------ view: students (master database)

  const STUDENT_FILTERS = ['q', 'program', 'stream', 'yearOfStudy', 'sort'];

  const programTag = (id, extra) => h('span', { class: 'badge program' }, label('program', id), extra ? ` · ${extra}` : null);

  // ------------------------------------------------------------------ profile verification

  const VERIFY_STATUS = {
    pending: 'Waiting for the student’s code',
    failed: 'Code not confirmed',
    verified: 'Confirmed by the student',
    resolved: 'Settled by staff',
  };
  const RESOLUTION_TEXT = {
    code: 'The student confirmed it with the emailed code; the profile was updated with the submitted details.',
    link: 'Linked to the profile, which was kept as it was.',
    update: 'Linked to the profile, which was updated with the submitted details.',
    new_profile: 'A different person: given a profile of their own.',
    edited: 'Settled when the record itself was edited.',
  };

  function verificationBadge(v) {
    const open = v.status === 'pending' || v.status === 'failed';
    const text = v.status === 'pending' && !v.codesSent ? 'Pending verification' : VERIFY_STATUS[v.status];
    return h('span', { class: 'badge', 'data-status': open ? 'verify' : v.status === 'verified' ? 'issued' : 'closed' }, text);
  }

  /**
   * A registration or enquiry whose email or mobile number belongs to a profile with different details:
   * the profile next to what was submitted, and the staff decision.
   */
  function verificationPanel(v, { reload, showRecord = true } = {}) {
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
      act('link', 'Same person: keep the profile', `Link this record to ${v.student.name} and keep the profile as it is?`, 'manage');
      act('update', 'Same person: update the profile', `Link this record to ${v.student.name} and replace the profile’s details with the submitted ones?`, 'editRecords');
      act('new_profile', 'Different person: new profile', 'Give this person a profile and Student ID of their own? The email or mobile number that belongs to the existing profile stays with it.', 'manage');
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

  async function viewVerifications(params, stale) {
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

  async function viewStudents(params, stale) {
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
            st.pendingVerifications ? h('span', { class: 'badge', 'data-status': 'verify' }, `${st.pendingVerifications} to verify`) : null,
            !st.certificates && !st.enquiries && !st.pendingVerifications ? dash() : null,
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
        can('export') ? h('a', { class: 'btn', href: `/api/students/export?${query}`, download: '' }, 'Export CSV') : null,
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

  async function viewStudentDetail(id, stale) {
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
    add('Stream', label('stream', st.stream));
    add('Year of study', label('yearOfStudy', st.yearOfStudy));
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
    if (can('editRecords')) {
      const f = {
        name: h('input', { name: 'name', value: st.name, maxlength: '100', required: true }),
        email: h('input', { name: 'email', type: 'email', value: st.email || '', maxlength: '254' }),
        phone: h('input', { name: 'phone', type: 'tel', value: st.phone || '' }),
        college: h('input', { name: 'college', value: st.college || '', maxlength: '150' }),
        stream: selectEl('stream', meta.streams, st.stream || '', { empty: 'Not specified' }),
        yearOfStudy: selectEl('yearOfStudy', meta.years, st.yearOfStudy || '', { empty: 'Not specified' }),
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
          field('Stream', f.stream),
          field('Year of study', f.yearOfStudy),
        ),
        h('p', { class: 'form-error', role: 'alert' }),
        h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save profile')),
        h('p', { class: 'muted small' }, 'Changes the master record only. A certificate’s printed name and email are corrected on the certificate itself.'),
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
    if (can('deleteRecords')) {
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
        h('section', { class: 'card danger-zone' }, h('h2', null, 'Erase data'), h('p', { class: 'muted small' }, 'Removes this student, their certificates and enquiries, with all activity logs (e.g. on the student’s request).'), del),
      );
    }

    mount(
      st.name,
      h('div', { class: 'page-head' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/students' }, '← Students')),
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, st.name), tags, contact)),
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

  // ------------------------------------------------------------------ view: settings (admin)

  const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  /** POST JSON and get a PDF back as an object URL (for previews). */
  async function pdfUrl(path, body) {
    let res;
    try {
      res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new ApiError(0, { error: 'network' });
    }
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    return URL.createObjectURL(await res.blob());
  }

  async function viewSettings(stale) {
    const [settings, designs] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/templates')]);
    if (stale()) return;
    const reload = () => {
      const seq = state.seq;
      viewSettings(() => seq !== state.seq).catch((err) => toast(errorText(err), true));
    };
    mount(
      'Settings',
      h('div', { class: 'page-head' }, h('h1', null, 'Settings')),
      h('div', { class: 'stack' }, sheetCard(settings, reload), designsCard(designs, reload), emailCard(settings.email)),
    );
  }

  function sheetCard(settings, reload) {
    const g = settings.googleSheet;
    const card = h('section', { class: 'card', id: 'google-sheet' }, h('h2', null, 'Google Sheet'));
    card.append(h('p', { class: 'muted' }, `Every career guidance registration is added as a row to the “${g.tab}” tab of the sheet linked here. Registrations made before you link a sheet are copied across too.`));
    if (!g.connected) {
      card.append(
        h(
          'div',
          { class: 'notice' },
          h('strong', null, 'Not connected on the server. '),
          g.keyError || 'Add a Google service-account key to the backend’s .env (GOOGLE_SERVICE_ACCOUNT_FILE) and restart it. The README explains the one-time setup.',
        ),
      );
    } else {
      card.append(
        h(
          'ol',
          { class: 'steps' },
          h('li', null, 'Open your Google Sheet, click Share, and add this address as an Editor: ', h('span', { class: 'row inline' }, h('span', { class: 'mono break' }, g.serviceAccountEmail), copyBtn(g.serviceAccountEmail))),
          h('li', null, 'Copy the sheet’s link from the browser’s address bar and paste it below.'),
        ),
      );
    }
    // The linked sheet receives every registration, so only those who may export data can change it.
    const canChange = can('export');
    const url = h('input', { name: 'url', type: 'url', value: g.sheetUrl || '', placeholder: 'https://docs.google.com/spreadsheets/d/…/edit', autocomplete: 'off', readOnly: !canChange });
    const save = canChange ? h('button', { class: 'btn btn-primary', type: 'submit' }, g.sheetUrl ? 'Update link' : 'Save link') : null;
    const form = h(
      'form',
      { class: 'sheet-form', novalidate: true },
      field('Google Sheet link', url, { name: 'url', hint: canChange ? null : 'Only admins can change the linked sheet.' }),
      h('div', { class: 'form-actions' }, save, g.sheetUrl ? h('a', { class: 'btn', href: g.sheetUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Open sheet ↗') : null),
      h('p', { class: 'form-error', role: 'alert' }),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!canChange) return;
      clearErrors(form);
      save.disabled = true;
      try {
        const r = await api('PUT', '/api/settings/google-sheet', { url: url.value.trim() });
        if (!url.value.trim()) toast('Sheet link removed');
        else if (!r.check) toast('Link saved. It will be used once Google Sheets is connected on the server.');
        else if (r.check.ok) toast(`Linked to “${r.check.title}”. Registrations are being copied.`);
        else toast(`Saved, but Google said: ${r.check.message}`, true);
        setTimeout(reload, r.check && r.check.ok ? 1500 : 0);
      } catch (err) {
        showErrors(form, err);
      } finally {
        save.disabled = false;
      }
    });
    card.append(form);

    if (g.sheetId) {
      const dl = h('dl', { class: 'info' });
      dl.append(h('dt', null, 'Last copied'), h('dd', null, g.lastSyncAt ? fmtDateTime(g.lastSyncAt) : 'Not yet'));
      dl.append(h('dt', null, 'Waiting'), h('dd', null, g.pending === null ? '—' : `${g.pending} ${g.pending === 1 ? 'registration' : 'registrations'}`));
      if (g.lastError) dl.append(h('dt', null, 'Problem'), h('dd', { class: 'error-text' }, `${g.lastError}${g.lastErrorAt ? ` (${fmtDateTime(g.lastErrorAt)})` : ''}`));
      const test = h('button', { class: 'btn', type: 'button', disabled: !g.connected }, 'Test connection');
      test.addEventListener('click', async () => {
        test.disabled = true;
        try {
          const r = await api('POST', '/api/settings/google-sheet/test', {});
          toast(r.ok ? `Connected to “${r.title}”` : r.message, !r.ok);
        } catch (err) {
          toast(fieldMessage(err), true);
        } finally {
          test.disabled = false;
        }
      });
      const sync = h('button', { class: 'btn', type: 'button', disabled: !g.connected }, 'Sync now');
      sync.addEventListener('click', async () => {
        sync.disabled = true;
        try {
          const r = await api('POST', '/api/settings/google-sheet/sync', {});
          toast(r.ok ? (r.synced ? `Copied ${r.synced} ${r.synced === 1 ? 'registration' : 'registrations'}` : 'Already up to date') : r.message, !r.ok);
          reload();
        } catch (err) {
          toast(errorText(err), true);
          sync.disabled = false;
        }
      });
      card.append(h('div', { class: 'sync-status' }, dl, h('div', { class: 'row' }, test, sync)));
    }
    card.append(h('p', { class: 'muted small' }, 'Rows are added, never changed: later corrections, revocations and deletions in this portal are not copied to the sheet. When a student asks for their data to be deleted, delete their rows in the sheet too.'));
    return card;
  }

  function designsCard(designs, reload) {
    const card = h('section', { class: 'card card-flush', id: 'designs' }, h('h2', null, 'Certificate designs'));
    card.append(h('p', { class: 'muted pad' }, 'Upload the certificate artwork without the student’s details, then choose where the name, session and other details are printed. New certificates use the default design unless their session picks another. Certificates keep the design they were issued with.'));

    const makeDefault = (id) => async () => {
      try {
        await api('PUT', '/api/templates/default', { id });
        toast('Default design changed');
        reload();
      } catch (err) {
        toast(fieldMessage(err), true);
      }
    };
    const preview = (templateId) => async () => {
      try {
        window.open(await pdfUrl('/api/templates/preview', { templateId }), '_blank', 'noopener');
      } catch (err) {
        toast(fieldMessage(err), true);
      }
    };
    const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
    const defaultBadge = h('span', { class: 'badge', 'data-status': 'open' }, 'Default');
    const rows = [
      h(
        'tr',
        null,
        h('td', { class: 'primary', 'data-label': 'Design' }, h('span', { class: 'name' }, 'Sloka standard'), h('span', { class: 'sub' }, 'Built in: logo band, name, session, venue and date')),
        td('File', h('span', { class: 'muted' }, '—')),
        td('Used by', h('span', { class: 'muted' }, '—')),
        td('Default', designs.builtInIsDefault ? defaultBadge.cloneNode(true) : h('button', { class: 'btn btn-sm', type: 'button', onclick: makeDefault(null) }, 'Make default')),
        td('Actions', h('button', { class: 'btn btn-sm', type: 'button', onclick: preview(null) }, 'Preview')),
      ),
      ...designs.templates.map((t) => {
        const actions = h('div', { class: 'row' }, h('a', { class: 'btn btn-sm', href: `#/settings/templates/${t.id}` }, 'Edit layout'), h('button', { class: 'btn btn-sm', type: 'button', onclick: preview(t.id) }, 'Preview'));
        const archive = h('button', { class: 'btn btn-sm btn-ghost', type: 'button' }, t.archived ? 'Restore' : 'Archive');
        archive.addEventListener('click', async () => {
          try {
            await api('PATCH', `/api/templates/${t.id}`, { archived: !t.archived });
            toast(t.archived ? 'Design restored' : 'Design archived');
            reload();
          } catch (err) {
            toast(fieldMessage(err), true);
          }
        });
        actions.append(archive);
        if (can('deleteRecords') && !t.usedBy.certificates && !t.usedBy.sessions) {
          const del = h('button', { class: 'btn btn-sm btn-danger', type: 'button' }, 'Delete');
          del.addEventListener('click', async () => {
            if (!window.confirm(`Delete the design “${t.name}”?`)) return;
            try {
              await api('DELETE', `/api/templates/${t.id}`);
              toast('Design deleted');
              reload();
            } catch (err) {
              toast(errorText(err), true);
            }
          });
          actions.append(del);
        }
        const used = [t.usedBy.certificates ? `${t.usedBy.certificates} certificates` : null, t.usedBy.sessions ? `${t.usedBy.sessions} sessions` : null].filter(Boolean).join(', ');
        return h(
          'tr',
          { class: t.archived ? 'archived' : null },
          h('td', { class: 'primary', 'data-label': 'Design' }, h('a', { class: 'name', href: `#/settings/templates/${t.id}` }, t.name), h('span', { class: 'sub' }, `Uploaded ${fmtDateTime(t.createdAt)}${t.createdBy ? ` by ${t.createdBy.name}` : ''}${t.archived ? ' · archived' : ''}`)),
          td('File', `${t.fileType.toUpperCase()} · ${fmtBytes(t.fileSize)}`),
          td('Used by', used || h('span', { class: 'muted' }, 'Not used yet')),
          td('Default', t.isDefault ? defaultBadge.cloneNode(true) : t.archived ? h('span', { class: 'muted' }, '—') : h('button', { class: 'btn btn-sm', type: 'button', onclick: makeDefault(t.id) }, 'Make default')),
          td('Actions', actions),
        );
      }),
    ];
    card.append(
      h(
        'div',
        { class: 'table-wrap' },
        h('table', { class: 'stackable' }, h('thead', null, h('tr', null, ['Design', 'File', 'Used by', 'Default', 'Actions'].map((t) => h('th', null, t)))), h('tbody', null, rows)),
      ),
    );

    // Upload
    const name = h('input', { name: 'name', maxlength: '80', placeholder: 'e.g. Career guidance 2026', required: true });
    const file = h('input', { name: 'file', type: 'file', accept: '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg', required: true });
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Upload design');
    const form = h(
      'form',
      { class: 'pad upload-form', novalidate: true },
      h('h2', null, 'Upload a design'),
      h(
        'div',
        { class: 'form-grid' },
        field('Name', name, { name: 'name', required: true }),
        field('File', file, { name: 'file', required: true, hint: `PDF (first page is used), PNG or JPEG, up to ${fmtBytes(designs.maxBytes)}. Keep it under 2 MB so emails stay small.` }),
      ),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, submit),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      const f = file.files[0];
      if (!f) {
        form.querySelector('[data-error-for="file"]').textContent = 'Choose a file.';
        return;
      }
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const type = f.type || { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || 'application/octet-stream';
      submit.disabled = true;
      submit.textContent = 'Uploading…';
      try {
        let res;
        try {
          res = await fetch(`/api/templates?name=${encodeURIComponent(name.value.trim())}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': type }, body: f });
        } catch {
          throw new ApiError(0, { error: 'network' });
        }
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new ApiError(res.status, body);
        toast('Design uploaded. Now place the details.');
        go(`#/settings/templates/${body.template.id}`);
      } catch (err) {
        showErrors(form, err);
      } finally {
        submit.disabled = false;
        submit.textContent = 'Upload design';
      }
    });
    card.append(form);
    return card;
  }

  function emailCard(email) {
    return h(
      'section',
      { class: 'card' },
      h('h2', null, 'Certificate email'),
      email.enabled
        ? h('p', null, h('span', { class: 'dot dot-ok' }), ` On. Each student is emailed their certificate PDF (and a personal download link) from ${email.from} as soon as they register.`)
        : h(
            'div',
            { class: 'notice' },
            h('strong', null, 'Off. '),
            'Students can still download their certificate on the website straight away. To email it as well, set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and NOTIFY_FROM in the backend’s .env and restart it.',
          ),
      email.dailyLimit
        ? h(
            'p',
            { class: 'muted small' },
            `Daily limit: at most ${email.dailyLimit} emails per address per day, whatever they are for (certificates, re-sends, verification codes, team notifications). It resets at midnight. An email over the limit is not sent; for a certificate it shows as failed and can be sent again the next day.`,
          )
        : null,
    );
  }

  // ------------------------------------------------------------------ view: template layout editor (admin)

  async function viewTemplateEditor(id, stale) {
    const [{ template: t }, designs] = await Promise.all([api('GET', `/api/templates/${id}`), api('GET', '/api/templates')]);
    if (stale()) return;
    const layout = structuredClone(t.layout);
    const fonts = designs.fonts;
    const aligns = designs.aligns.map((a) => ({ id: a, label: a[0].toUpperCase() + a.slice(1) }));

    const frame = h('iframe', { class: 'preview-frame', title: 'Certificate preview' });
    let currentUrl = null;
    const refresh = async () => {
      try {
        const next = await pdfUrl('/api/templates/preview', { templateId: id, layout: collect() });
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = next;
        frame.src = `${next}#toolbar=0&navpanes=0&view=Fit`;
        clearErrors(form);
      } catch (err) {
        showErrors(form, err);
      }
    };

    const inputs = {};
    const num = (name, value, min, max, step = '0.5') => h('input', { type: 'number', name, value: String(value), min: String(min), max: String(max), step, class: 'num-input' });
    const rows = designs.fields.map(({ id: fid, label: flabel }) => {
      const f = layout.fields[fid];
      const show = h('input', { type: 'checkbox', name: `${fid}.show`, checked: f.show, 'aria-label': `Print ${flabel}` });
      const color = h('input', { type: 'color', name: `${fid}.color`, value: f.color, class: 'color-input', 'aria-label': `${flabel} colour` });
      const font = selectEl(`${fid}.font`, fonts, f.font);
      const align = selectEl(`${fid}.align`, aligns, f.align);
      const prefix = h('input', { name: `${fid}.prefix`, value: f.prefix || '', maxlength: '60', placeholder: '—', class: 'prefix-input' });
      inputs[fid] = { show, x: num(`${fid}.x`, f.x, 0, 100), y: num(`${fid}.y`, f.y, 0, 100), size: num(`${fid}.size`, f.size, 4, 120), font, color, align, maxWidth: num(`${fid}.maxWidth`, f.maxWidth, 5, 100, '1'), prefix };
      const cell = (lbl, el, prop) => h('td', { 'data-label': lbl }, el, h('small', { class: 'error', 'data-error-for': `${fid}.${prop}` }));
      return h(
        'tr',
        null,
        h('td', { class: 'primary', 'data-label': 'Detail' }, h('label', { class: 'check' }, show, h('span', null, flabel)), h('small', { class: 'error', 'data-error-for': `${fid}.show` })),
        cell('Across %', inputs[fid].x, 'x'),
        cell('Down %', inputs[fid].y, 'y'),
        cell('Size', inputs[fid].size, 'size'),
        cell('Font', font, 'font'),
        cell('Colour', color, 'color'),
        cell('Align', align, 'align'),
        cell('Max width %', inputs[fid].maxWidth, 'maxWidth'),
        cell('Text before', prefix, 'prefix'),
      );
    });

    function collect() {
      const fields = {};
      for (const [fid, i] of Object.entries(inputs)) {
        fields[fid] = {
          show: i.show.checked,
          x: Number(i.x.value),
          y: Number(i.y.value),
          size: Number(i.size.value),
          font: i.font.value,
          color: i.color.value,
          align: i.align.value,
          maxWidth: Number(i.maxWidth.value),
          prefix: i.prefix.value,
        };
      }
      return { fields };
    }

    const nameInput = h('input', { name: 'name', value: t.name, maxlength: '80' });
    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save layout');
    const form = h(
      'form',
      { class: 'card card-flush', novalidate: true },
      h(
        'div',
        { class: 'pad' },
        h('h2', null, 'Where the details are printed'),
        h('p', { class: 'muted small' }, '“Across” and “Down” are percentages of the page measured from the top-left corner; “Down” is where the bottom of the letters sits. Text longer than “Max width” shrinks to fit. Fonts are the standard PDF fonts.'),
        h('div', { class: 'form-grid' }, field('Design name', nameInput, { name: 'name' })),
      ),
      h('div', { class: 'table-wrap' }, h('table', { class: 'stackable layout-table' }, h('thead', null, h('tr', null, ['Detail', 'Across %', 'Down %', 'Size', 'Font', 'Colour', 'Align', 'Max width %', 'Text before'].map((x) => h('th', null, x)))), h('tbody', null, rows))),
      h(
        'div',
        { class: 'pad' },
        h('p', { class: 'form-error', role: 'alert' }),
        h(
          'div',
          { class: 'form-actions' },
          save,
          h('button', { class: 'btn', type: 'button', onclick: refresh }, 'Update preview'),
          h(
            'button',
            {
              class: 'btn btn-ghost',
              type: 'button',
              onclick: () => {
                if (!window.confirm('Reset every detail to the default positions?')) return;
                for (const [fid, i] of Object.entries(inputs)) {
                  const d = designs.defaultLayout.fields[fid];
                  i.show.checked = d.show;
                  for (const k of ['x', 'y', 'size', 'font', 'color', 'align', 'maxWidth', 'prefix']) i[k].value = String(d[k] ?? '');
                }
                refresh();
              },
            },
            'Reset to defaults',
          ),
        ),
      ),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await api('PATCH', `/api/templates/${id}`, { name: nameInput.value, layout: collect() });
        toast('Layout saved');
        clearErrors(form);
        refresh();
      } catch (err) {
        showErrors(form, err);
      } finally {
        save.disabled = false;
      }
    });
    let timer;
    form.addEventListener('change', () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    });

    const used = t.usedBy.certificates;
    mount(
      t.name,
      h('div', { class: 'page-head' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/settings' }, '← Settings')),
      h(
        'div',
        { class: 'page-head' },
        h('h1', null, t.name),
        t.isDefault ? h('span', { class: 'badge', 'data-status': 'open' }, 'Default') : null,
        t.archived ? h('span', { class: 'badge', 'data-status': 'closed' }, 'Archived') : null,
        h('span', { class: 'spacer' }),
        h('a', { class: 'btn btn-sm', href: `/api/templates/${id}/file`, download: '' }, 'Download original'),
      ),
      used ? h('div', { class: 'notice' }, `${used} issued ${used === 1 ? 'certificate uses' : 'certificates use'} this design. Saving a new layout changes how they look when downloaded again.`) : null,
      h('div', { class: 'stack' }, form, h('section', { class: 'card' }, h('h2', null, 'Preview (sample student)'), frame)),
    );
    refresh();
  }

  // ------------------------------------------------------------------ boot

  document.getElementById('logout').addEventListener('click', async () => {
    try {
      await api('POST', '/api/auth/logout');
    } catch {
      /* ignore */
    }
    state.me = null;
    state.meta = null;
    renderChrome();
    go('#/login');
  });

  window.addEventListener('hashchange', route);

  (async function boot() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) {
        state.me = (await res.json()).user;
        await ensureMeta(true);
      }
    } catch {
      /* treated as signed out */
    }
    route();
  })();
})();
