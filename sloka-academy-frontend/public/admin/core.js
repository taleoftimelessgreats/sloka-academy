// Shared by every view: DOM helpers, the API client, state, formatting, routing primitives.
// Rendered with DOM APIs / textContent only. Never use innerHTML with data.

// ------------------------------------------------------------------ DOM helpers

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'required', 'readOnly', 'open', 'selected', 'multiple']);
let uid = 0;
/** A fresh element id (f1, f2, ...). */
export const newId = () => `f${++uid}`;

export function h(tag, props, ...children) {
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

export function selectEl(name, list, value, { empty, required } = {}) {
  const s = h('select', { name, required });
  if (empty !== undefined) s.append(h('option', { value: '' }, empty));
  for (const o of list) s.append(h('option', { value: String(o.id), disabled: o.disabled }, o.label));
  s.value = value == null ? '' : String(value);
  return s;
}

export function field(labelText, control, { name, hint, full, required } = {}) {
  const id = newId();
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

export function clearErrors(form) {
  form.querySelectorAll('.error, .form-error').forEach((e) => {
    e.textContent = '';
  });
}

export function showErrors(form, err) {
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

export function errorText(err) {
  if (!err) return 'Something went wrong.';
  const code = err.data && err.data.error;
  const map = {
    invalid_credentials: 'Incorrect email or password.',
    rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
    forbidden: 'You do not have permission to do that.',
    not_found: 'Not found. It may have been deleted.',
    cross_site_request: 'Request blocked. Reload the page and try again.',
    payload_too_large: 'That file is too large (4 MB at most).',
  };
  if (map[code]) return map[code];
  if (err.data && typeof err.data.message === 'string') return err.data.message;
  if (err.status === 0) return 'Network error. Check your connection.';
  return `Something went wrong (${err.status || 'error'}).`;
}

let toastTimer;
export function toast(msg, isError = false) {
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

export class ApiError extends Error {
  constructor(status, data) {
    super((data && data.error) || `HTTP ${status}`);
    this.status = status;
    this.data = data || {};
  }
}

export async function api(method, path, body) {
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
  // Signed in with a temporary password (e.g. reset by an admin meanwhile): choose a new one first.
  if (res.status === 403 && data && data.error === 'password_change_required' && state.me) {
    state.me.mustChangePassword = true;
    go('#/');
    throw new ApiError(403, data);
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ------------------------------------------------------------------ state & formatting

export const state = {
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

export function browserToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export const fmtDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
// Rupees, Indian grouping: 14999 -> ₹14,999; 14999.5 -> ₹14,999.50.
export const fmtMoney = (n) =>
  n == null ? '' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (ymd) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export function label(kind, id) {
  if (id === null || id === undefined || id === '') return '';
  const m = state.labels[kind];
  return (m && m.get(id)) || id;
}

export async function ensureMeta(force = false) {
  if (!force && state.meta && Date.now() - state.metaAt < 5 * 60 * 1000) return;
  const [meta, staff] = await Promise.all([api('GET', '/api/meta'), api('GET', '/api/staff')]);
  state.meta = meta;
  state.metaAt = Date.now();
  state.staff = staff.staff;
  state.scope = staff.scope;
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
    department: toMap(meta.departments),
    gender: toMap(meta.genders),
    paymentMode: toMap(meta.paymentModes),
    paymentStatus: toMap(meta.paymentStatuses),
  };
}

// Permissions ('module.action') come from the server with the signed-in user (backend src/permissions.js).
// They only decide what the portal shows: the API checks them on every request.
export const can = (permission) => Boolean(state.me && state.me.permissions && state.me.permissions.includes(permission));
// Any one of the permissions; 'a+b' needs both (e.g. certificates also show participants' personal data).
export const canAny = (...permissions) => permissions.some((p) => p.split('+').every(can));
export const isClosed = (status) => state.meta && state.meta.closedStatuses.includes(status);

export function statusBadge(status) {
  return h('span', { class: 'badge', 'data-status': status }, label('status', status));
}

export function followUpCell(inq) {
  if (!inq.nextFollowUp) return h('span', { class: 'muted' }, '—');
  let cls = '';
  if (!isClosed(inq.status)) {
    if (inq.nextFollowUp < state.today) cls = 'fu-overdue';
    else if (inq.nextFollowUp === state.today) cls = 'fu-today';
  }
  const text = cls === 'fu-today' ? 'Today' : fmtDate(inq.nextFollowUp);
  return h('span', { class: cls || null, title: cls === 'fu-overdue' ? 'Overdue' : null }, text);
}

// The associates within the signed-in user's data scope: everyone for "All records"; themselves and everyone
// reporting to them for "Team records"; themselves for "Own records". Filters and pickers offer only these.
const scopedStaff = () => state.staff.filter((s) => s.inScope !== false);

/** Options for an assignee / associate picker: active associates in scope (and the current one). */
export function staffOptions(currentId) {
  return state.staff
    .filter((s) => (s.active && s.inScope !== false) || s.id === currentId)
    .map((s) => ({ id: s.id, label: s.active ? s.name : `${s.name} (inactive)` }));
}

/** Options for an associate filter: associates in scope, inactive ones marked. */
export const staffFilterOptions = () => scopedStaff().map((s) => ({ id: s.id, label: s.active ? s.name : `${s.name} (inactive)` }));

// ------------------------------------------------------------------ router

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const i = raw.indexOf('?');
  return { path: i < 0 ? raw : raw.slice(0, i), params: new URLSearchParams(i < 0 ? '' : raw.slice(i + 1)) };
}

// The router (main.js) registers itself, so views can navigate without importing it.
let router = () => {};
export function onNavigate(fn) {
  router = fn;
}

export function go(hash) {
  if (location.hash === hash) router();
  else location.hash = hash;
}

export const $app = document.getElementById('app');

export function mount(title, ...nodes) {
  document.title = `${title} · Sloka Academy Admin`;
  // Like h(): leave out empty slots (replaceChildren would print them as the text "null").
  $app.replaceChildren(...nodes.flat(Infinity).filter((n) => n !== undefined && n !== null && n !== false));
}

export function renderChrome() {
  const bar = document.getElementById('topbar');
  bar.hidden = !state.me;
  if (!state.me) return;
  document.getElementById('who-name').textContent = state.me.name;
  document.getElementById('nav').hidden = Boolean(state.me.mustChangePassword);
  // data-requires: permissions separated by spaces, any one of which shows the link.
  document.querySelectorAll('[data-requires]').forEach((el) => {
    el.hidden = !canAny(...el.dataset.requires.split(' '));
  });
  const { path } = parseHash();
  const first = path.slice(1).split('/')[0];
  const current = path === '/' ? 'overview' : first === 'new' ? 'enquiries' : first;
  document.querySelectorAll('[data-route]').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === current);
  });
}

export async function copyText(text) {
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

export const copyBtn = (text, labelText = 'Copy') =>
  h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(text) }, labelText);

export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function pagerEl(data, hrefFor) {
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

export function fieldMessage(err) {
  const f = err && err.data && err.data.fields;
  return f ? Object.values(f).join(' ') : errorText(err);
}

export const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** POST JSON and get a PDF back as an object URL (for previews). */
export async function pdfUrl(path, body) {
  let res;
  try {
    res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { error: 'network' });
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return URL.createObjectURL(await res.blob());
}
