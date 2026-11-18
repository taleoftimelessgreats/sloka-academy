// Associates: the people who sign in to the portal (formerly "Users"). Add Associate sends the invite; they are
// deactivated, never deleted. Super Admins can grant or revoke single permissions per associate.
// Rendered with DOM APIs / textContent only. Never use innerHTML with data.

import { api, can, clearErrors, copyBtn, ensureMeta, field, fieldMessage, fmtDate, fmtDateTime, go, h, label, mount, selectEl, showErrors, state, toast } from './core.js';

const isSuperAdmin = () => state.me && state.me.role === 'super_admin';
// Roles the signed-in associate may hand out (the server checks too: never more than their own permissions).
const roleOptions = () => state.meta.roles.filter((r) => r.id !== 'super_admin' || isSuperAdmin());

/** After an invite or a reset: the temporary password is shown only if it could not be emailed. */
function inviteNotice(name, invite) {
  if (invite.emailed) return null;
  return h(
    'div',
    { class: 'notice notice-warn' },
    h('strong', null, `The sign-in details for ${name} could not be emailed`),
    invite.error ? ` (${invite.error.replace(/\.$/, '')}).` : '.',
    ' Give them this temporary password yourself; it is not shown again. They must choose their own when they sign in: ',
    h('span', { class: 'mono code' }, invite.tempPassword),
    ' ',
    copyBtn(invite.tempPassword),
  );
}

function associateFields(a = {}) {
  const meta = state.meta;
  const managers = state.staff.filter((s) => s.active && s.id !== a.id).map((s) => ({ id: s.id, label: s.name }));
  return {
    name: h('input', { name: 'name', maxlength: '100', required: true, value: a.name || '', autocomplete: 'off' }),
    employeeId: h('input', { name: 'employeeId', maxlength: '40', required: true, value: a.employeeId || '', autocomplete: 'off' }),
    email: h('input', { name: 'email', type: 'email', required: true, value: a.email || '', autocomplete: 'off' }),
    mobile: h('input', { name: 'mobile', type: 'tel', inputmode: 'tel', required: true, value: a.mobile || '', autocomplete: 'off' }),
    department: selectEl('department', meta.departments, a.department || '', { empty: 'Select' }),
    designation: h('input', { name: 'designation', maxlength: '100', required: true, value: a.designation || '', autocomplete: 'off' }),
    role: selectEl('role', roleOptions(), a.role || 'bd_associate'),
    reportingManagerId: selectEl('reportingManagerId', managers, a.reportingManager ? a.reportingManager.id : '', { empty: 'None' }),
    dateOfJoining: h('input', { name: 'dateOfJoining', type: 'date', required: true, value: a.dateOfJoining || '' }),
  };
}

const fieldGrid = (f) =>
  h(
    'div',
    { class: 'form-grid' },
    field('Full name', f.name, { required: true }),
    field('Employee ID', f.employeeId, { required: true }),
    field('Official email', f.email, { required: true }),
    field('Mobile', f.mobile, { required: true }),
    field('Department', f.department, { required: true }),
    field('Designation', f.designation, { required: true }),
    field('Role', f.role, { required: true }),
    field('Reporting manager', f.reportingManagerId, { hint: 'A BD Manager sees the registrations of everyone who reports to them.' }),
    field('Date of joining', f.dateOfJoining, { required: true }),
  );

const values = (f) => ({
  ...Object.fromEntries(Object.entries(f).map(([k, input]) => [k, input.value.trim() === '' ? null : input.value.trim()])),
  reportingManagerId: f.reportingManagerId.value ? Number(f.reportingManagerId.value) : null,
});

export async function viewAssociates(stale) {
  await ensureMeta(true);
  const { associates } = await api('GET', '/api/associates');
  if (stale()) return;

  let createForm = null;
  if (can('associates.create')) {
    const f = associateFields();
    const result = h('div');
    createForm = h(
      'form',
      { class: 'card', novalidate: true },
      h('h2', null, 'Add Associate'),
      h('p', { class: 'muted small' }, 'Creates their portal login and emails the invite with a temporary password; they choose their own password when they first sign in.'),
      fieldGrid(f),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add Associate')),
      result,
    );
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(createForm);
      try {
        const r = await api('POST', '/api/associates', values(f));
        toast(r.invite.emailed ? `Associate added; the invite was emailed to ${r.associate.email}` : 'Associate added');
        const notice = inviteNotice(r.associate.name, r.invite);
        await ensureMeta(true);
        if (notice) {
          // Keep the temporary password on screen: re-render the list below the notice.
          await viewAssociates(() => false);
          document.querySelector('#app .page-head').after(notice);
        } else go('#/associates');
      } catch (err) {
        showErrors(createForm, err);
      }
    });
  }

  const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
  const dash = () => h('span', { class: 'muted' }, '—');
  const rows = associates.map((a) =>
    h(
      'tr',
      { class: a.active ? null : 'inactive' },
      h(
        'td',
        { class: 'primary', 'data-label': 'Name' },
        h('a', { class: 'name', href: `#/associates/${a.id}` }, a.name),
        a.id === state.me.id ? h('span', { class: 'sub' }, 'You') : null,
        a.mustChangePassword ? h('span', { class: 'sub' }, 'Invited: has not chosen a password yet') : null,
      ),
      td('Employee ID', a.employeeId ? h('span', { class: 'mono' }, a.employeeId) : dash()),
      td('Contact', a.email, a.mobile ? h('span', { class: 'sub' }, a.mobile) : null),
      td('Department', a.department ? label('department', a.department) : dash(), a.designation ? h('span', { class: 'sub' }, a.designation) : null),
      td('Role', a.roleName, a.overrides ? h('span', { class: 'sub' }, `+ ${a.overrides} override${a.overrides === 1 ? '' : 's'}`) : null),
      td('Reports to', a.reportingManager ? a.reportingManager.name : dash()),
      td('Status', a.active ? 'Active' : h('span', { class: 'muted' }, 'Inactive')),
      td('Last sign-in', a.lastLoginAt ? h('span', { class: 'nowrap' }, fmtDateTime(a.lastLoginAt)) : h('span', { class: 'muted' }, 'Never')),
    ),
  );
  const heads = ['Name', 'Employee ID', 'Contact', 'Department', 'Role', 'Reports to', 'Status', 'Last sign-in'];
  const table = h('table', { class: 'stackable' }, h('thead', null, h('tr', null, heads.map((t) => h('th', null, t)))), h('tbody', null, rows));
  mount(
    'Associates',
    h('div', { class: 'page-head' }, h('h1', null, 'Associates'), h('span', { class: 'muted' }, `${associates.filter((a) => a.active).length} active`), h('span', { class: 'spacer' }), can('roles.view') ? h('a', { class: 'btn', href: '#/roles' }, 'Roles & permissions') : null),
    h('p', { class: 'muted lead' }, 'Only active associates can sign in. Deactivating someone signs them out at once and keeps their records: registrations stay tagged to them. Associates are never deleted.'),
    h('div', { class: 'stack' }, h('div', { class: 'card card-flush' }, h('div', { class: 'table-wrap' }, table)), createForm),
  );
}

/** Per-associate overrides: each permission comes from the role, or is granted or revoked for this associate. */
function overridesCard(a, overrides, rolesData, reload) {
  const role = rolesData.roles.find((r) => r.key === a.role);
  const fromRole = new Set(role ? role.permissions : []);
  const choice = {};
  const rows = rolesData.modules.map((m) =>
    h(
      'tr',
      null,
      h('th', { scope: 'row' }, m.label),
      rolesData.actions.map((act) => {
        const def = m.actions.find((x) => x.id === act.id);
        if (!def) return h('td', { class: 'na' }, '');
        const p = `${m.id}.${act.id}`;
        const inherited = fromRole.has(p);
        const current = Object.hasOwn(overrides, p) ? (overrides[p] ? 'grant' : 'revoke') : 'role';
        const sel = h(
          'select',
          { 'aria-label': `${m.label}: ${act.label}`, title: def.description, class: `override override-${current}` },
          h('option', { value: 'role' }, inherited ? '✓ role' : '— role'),
          h('option', { value: 'grant' }, '+ grant'),
          h('option', { value: 'revoke' }, '− revoke'),
        );
        sel.value = current;
        sel.addEventListener('change', () => {
          sel.className = `override override-${sel.value}`;
        });
        choice[p] = sel;
        return h('td', null, sel);
      }),
    ),
  );
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save overrides');
  save.addEventListener('click', async () => {
    const out = {};
    for (const [p, sel] of Object.entries(choice)) if (sel.value !== 'role') out[p] = sel.value === 'grant';
    try {
      await api('PUT', `/api/associates/${a.id}/permissions`, { overrides: out });
      toast('Permissions saved; they apply at once');
      reload();
    } catch (err) {
      toast(fieldMessage(err), true);
    }
  });
  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'Permissions for this associate'),
    h('p', { class: 'muted small' }, `From their role (${a.roleName}) unless granted or revoked here. Hover a cell for what it allows.`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid-table' }, h('thead', null, h('tr', null, h('th', null, 'Module'), rolesData.actions.map((x) => h('th', null, x.label)))), h('tbody', null, rows))),
    h('div', { class: 'form-actions' }, save),
  );
}

export async function viewAssociateDetail(id, stale) {
  await ensureMeta(true);
  const [{ associate: a, overrides }, rolesData] = await Promise.all([api('GET', `/api/associates/${id}`), can('roles.view') ? api('GET', '/api/roles') : null]);
  if (stale()) return;
  const reload = () => go(`#/associates/${id}?r=${Date.now()}`);
  const self = a.id === state.me.id;

  let editForm = null;
  if (can('associates.edit')) {
    const f = associateFields(a);
    if (self) f.role.disabled = true;
    editForm = h(
      'form',
      { class: 'card', novalidate: true },
      h('h2', null, 'Details'),
      fieldGrid(f),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'), h('span', { class: 'muted small' }, 'A role change signs them out everywhere.')),
    );
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = values(f);
      if (self) delete v.role;
      try {
        await api('PATCH', `/api/associates/${id}`, v);
        toast('Saved');
        await ensureMeta(true);
        reload();
      } catch (err) {
        showErrors(editForm, err);
      }
    });
  }

  const actions = [];
  const notices = h('div');
  if (can('associates.edit') && !self) {
    const reset = h('button', { class: 'btn', type: 'button' }, 'Reset password');
    reset.addEventListener('click', async () => {
      if (!window.confirm(`Send ${a.name} a new temporary password? Their current password stops working and they are signed out.`)) return;
      try {
        const r = await api('POST', `/api/associates/${id}/reset-password`);
        toast(r.invite.emailed ? `A temporary password was emailed to ${a.email}` : 'Password reset');
        notices.replaceChildren(inviteNotice(a.name, r.invite) || '');
      } catch (err) {
        toast(fieldMessage(err), true);
      }
    });
    actions.push(reset);
  }
  if (can('associates.delete') && !self) {
    const toggle = h('button', { class: a.active ? 'btn btn-danger' : 'btn btn-primary', type: 'button' }, a.active ? 'Deactivate' : 'Reactivate');
    toggle.addEventListener('click', async () => {
      if (a.active && !window.confirm(`Deactivate ${a.name}? They are signed out at once and cannot sign in; their records stay.`)) return;
      try {
        await api('PATCH', `/api/associates/${id}`, { active: !a.active });
        toast(a.active ? 'Deactivated' : 'Reactivated');
        await ensureMeta(true);
        reload();
      } catch (err) {
        toast(fieldMessage(err), true);
      }
    });
    actions.push(toggle);
  }

  mount(
    a.name,
    h(
      'div',
      { class: 'page-head' },
      h('a', { class: 'btn btn-ghost btn-sm', href: '#/associates' }, '← Associates'),
      h('h1', null, a.name),
      h('span', { class: 'badge', 'data-status': a.active ? 'open' : 'closed' }, a.active ? 'Active' : 'Inactive'),
      h('span', { class: 'spacer' }),
      actions,
    ),
    notices,
    h(
      'div',
      { class: 'stack' },
      h(
        'section',
        { class: 'card' },
        h(
          'dl',
          { class: 'info' },
          h('dt', null, 'Role'),
          h('dd', null, a.roleName),
          h('dt', null, 'Joined'),
          h('dd', null, a.dateOfJoining ? fmtDate(a.dateOfJoining) : '—'),
          h('dt', null, 'Last sign-in'),
          h('dd', null, a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : 'Never'),
          a.mustChangePassword ? [h('dt', null, 'Password'), h('dd', null, 'Temporary: they have not chosen their own yet')] : null,
        ),
        !a.employeeId ? h('p', { class: 'muted small' }, 'This account was created before associate details were recorded; fill them in below.') : null,
      ),
      editForm,
      rolesData && overrides && can('roles.edit') && a.role !== 'super_admin' ? overridesCard(a, overrides, rolesData, reload) : null,
      rolesData && a.role === 'super_admin' ? h('p', { class: 'muted' }, 'Super Admins always have every permission.') : null,
    ),
  );
}

