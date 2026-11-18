// The audit log: permission changes, fee and payment edits, student master edits, template uploads, associate
// changes and deletions, with who made each change, when, and the old -> new values.
// Rendered with DOM APIs / textContent only. Never use innerHTML with data.

import { api, ensureMeta, fmtDateTime, go, h, mount, pagerEl, selectEl, state } from './core.js';

const FILTERS = ['entity', 'actorId', 'from', 'to'];

const show = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

export async function viewAudit(params, stale) {
  await ensureMeta();
  const query = new URLSearchParams();
  for (const k of FILTERS) if (params.get(k)) query.set(k, params.get(k));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const data = await api('GET', `/api/audit?${query}&page=${page}`);
  if (stale()) return;

  // What can be filtered on, with labels, comes from the server (backend src/audit.js).
  const entityLabel = new Map(data.entities.map((e) => [e.id, e.label]));
  const entity = selectEl('entity', data.entities, params.get('entity') || '', { empty: 'Everything' });
  const actor = selectEl('actorId', state.staff.map((s) => ({ id: s.id, label: s.name })), params.get('actorId') || '', { empty: 'Anyone' });
  const from = h('input', { type: 'date', name: 'from', value: params.get('from') || '', 'aria-label': 'From' });
  const to = h('input', { type: 'date', name: 'to', value: params.get('to') || '', 'aria-label': 'To' });
  entity.setAttribute('aria-label', 'What changed');
  actor.setAttribute('aria-label', 'Who');
  const form = h('form', { class: 'filters' }, entity, actor, h('label', { class: 'date-filter' }, h('span', null, 'From'), from), h('label', { class: 'date-filter' }, h('span', null, 'To'), to));
  form.addEventListener('change', () => {
    const p = new URLSearchParams();
    for (const el of [entity, actor, from, to]) if (el.value) p.set(el.name, el.value);
    go(`#/audit${p.toString() ? `?${p}` : ''}`);
  });

  const rows = data.items.map((i) =>
    h(
      'tr',
      null,
      h('td', { 'data-label': 'When' }, h('span', { class: 'nowrap' }, fmtDateTime(i.createdAt))),
      h('td', { 'data-label': 'Who' }, i.actor ? i.actor.name : h('span', { class: 'muted' }, 'System')),
      h('td', { 'data-label': 'What' }, h('span', { class: 'badge' }, entityLabel.get(i.entity) || i.entity), ' ', i.summary),
      h(
        'td',
        { 'data-label': 'Changes' },
        i.changes.length
          ? h('ul', { class: 'changes' }, i.changes.map((c) => h('li', null, h('span', { class: 'field-name' }, c.field), ': ', h('del', null, show(c.from)), ' → ', h('ins', null, show(c.to)))))
          : h('span', { class: 'muted' }, '—'),
      ),
    ),
  );
  const table = h(
    'table',
    { class: 'stackable' },
    h('thead', null, h('tr', null, ['When', 'Who', 'What', 'Old → new'].map((t) => h('th', null, t)))),
    h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: '4', class: 'empty' }, 'Nothing recorded for these filters.'))),
  );
  const hrefFor = (n) => {
    const p = new URLSearchParams(params);
    p.set('page', String(n));
    return `#/audit?${p}`;
  };
  mount(
    'Audit log',
    h('div', { class: 'page-head' }, h('h1', null, 'Audit log'), h('span', { class: 'muted' }, `${data.total} ${data.total === 1 ? 'entry' : 'entries'}`)),
    h('p', { class: 'muted lead' }, 'Who changed what, and when: permissions and roles, fees and payments, student master records, templates, associates and deletions.'),
    form,
    h('div', { class: 'card card-flush' }, h('div', { class: 'table-wrap' }, table)),
    pagerEl(data, hrefFor),
  );
}
