// Roles & permissions (Super Admin): every permission (module x action) against every role, a checkbox per role,
// the data scope of each role, and custom roles. Changes apply at once, and to the API, not just the screen.
// Rendered with DOM APIs / textContent only. Never use innerHTML with data.

import { api, can, ensureMeta, field, fieldMessage, go, h, mount, selectEl, showErrors, toast } from './core.js';

export async function viewRoles(stale) {
  const data = await api('GET', '/api/roles');
  if (stale()) return;
  const editable = can('roles.edit');
  const reload = async () => {
    await ensureMeta(true);
    go(`#/roles?r=${Date.now()}`);
  };

  // What each role will be saved as.
  const draft = Object.fromEntries(data.roles.map((r) => [r.key, { permissions: new Set(r.permissions), scope: r.scope }]));
  const changed = new Set();
  const save = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Save changes');
  const markChanged = (key) => {
    changed.add(key);
    save.disabled = false;
    save.textContent = `Save changes (${changed.size} ${changed.size === 1 ? 'role' : 'roles'})`;
  };

  const head = h(
    'tr',
    null,
    h('th', { class: 'sticky-col' }, 'Module / action'),
    data.roles.map((r) => {
      let del = null;
      if (editable && !r.system) {
        del = h('button', { class: 'link-btn', type: 'button', title: r.associates ? 'Associates have this role' : 'Delete this role', disabled: r.associates > 0 }, 'Delete');
        del.addEventListener('click', async () => {
          if (!window.confirm(`Delete the role "${r.name}"?`)) return;
          try {
            await api('DELETE', `/api/roles/${r.key}`);
            toast('Role deleted');
            reload();
          } catch (err) {
            toast(fieldMessage(err), true);
          }
        });
      }
      return h('th', { class: 'role-col', title: r.description || '' }, h('span', { class: 'role-name' }, r.name), h('span', { class: 'sub' }, `${r.associates} associate${r.associates === 1 ? '' : 's'}`), del);
    }),
  );

  const scopeRow = h(
    'tr',
    { class: 'scope-row' },
    h('th', { class: 'sticky-col' }, 'Data scope', h('span', { class: 'sub' }, 'Registrations & offer letters')),
    data.roles.map((r) => {
      const sel = selectEl(`scope-${r.key}`, data.scopes, r.scope);
      sel.disabled = !editable || r.locked;
      sel.setAttribute('aria-label', `Data scope for ${r.name}`);
      sel.addEventListener('change', () => {
        draft[r.key].scope = sel.value;
        markChanged(r.key);
      });
      return h('td', null, sel);
    }),
  );

  const body = [];
  for (const m of data.modules) {
    body.push(h('tr', { class: 'module-row' }, h('th', { class: 'sticky-col', colspan: String(data.roles.length + 1) }, m.label)));
    for (const act of m.actions) {
      const p = `${m.id}.${act.id}`;
      const actionLabel = data.actions.find((a) => a.id === act.id).label;
      body.push(
        h(
          'tr',
          null,
          h('th', { class: 'sticky-col action', scope: 'row', title: act.description }, actionLabel, h('span', { class: 'sub' }, act.description)),
          data.roles.map((r) => {
            const box = h('input', { type: 'checkbox', checked: draft[r.key].permissions.has(p), disabled: !editable || r.locked, 'aria-label': `${r.name}: ${m.label} ${actionLabel}` });
            box.addEventListener('change', () => {
              if (box.checked) draft[r.key].permissions.add(p);
              else draft[r.key].permissions.delete(p);
              markChanged(r.key);
            });
            return h('td', { class: 'check-cell' }, box);
          }),
        ),
      );
    }
  }

  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      for (const key of changed) {
        const d = draft[key];
        const role = data.roles.find((r) => r.key === key);
        await api('PATCH', `/api/roles/${key}`, role.locked ? { scope: 'all' } : { scope: d.scope, permissions: [...d.permissions] });
      }
      toast('Roles saved. The changes apply at once.');
      reload();
    } catch (err) {
      save.disabled = false;
      toast(fieldMessage(err), true);
    }
  });

  // New custom role.
  let createForm = null;
  if (editable) {
    const nr = {
      name: h('input', { name: 'name', maxlength: '60', required: true }),
      description: h('input', { name: 'description', maxlength: '500' }),
      scope: selectEl('scope', data.scopes, 'own'),
      copyFrom: selectEl('copyFrom', data.roles.filter((r) => !r.locked).map((r) => ({ id: r.key, label: r.name })), '', { empty: 'No permissions' }),
    };
    createForm = h(
      'form',
      { class: 'card', novalidate: true },
      h('h2', null, 'New role'),
      h(
        'div',
        { class: 'form-grid' },
        field('Role name', nr.name, { required: true }),
        field('Description', nr.description),
        field('Data scope', nr.scope),
        field('Start with the permissions of', nr.copyFrom),
      ),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create role')),
    );
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const from = data.roles.find((r) => r.key === nr.copyFrom.value);
      try {
        await api('POST', '/api/roles', { name: nr.name.value, description: nr.description.value, scope: nr.scope.value, permissions: from ? from.permissions : [] });
        toast('Role created');
        reload();
      } catch (err) {
        showErrors(createForm, err);
      }
    });
  }

  mount(
    'Roles & permissions',
    h('div', { class: 'page-head' }, h('h1', null, 'Roles & permissions'), h('span', { class: 'spacer' }), editable ? save : null),
    h(
      'p',
      { class: 'muted lead' },
      'Tick what each role may do. The portal and the API both enforce it, and changes apply to signed-in associates at once. Data scope limits which registrations and offer letters a role sees: its own, its team’s (everyone who reports to them), or all. Super Admin always has everything. Single associates can be given or denied a permission on their page under Associates.',
    ),
    h('div', { class: 'card card-flush' }, h('div', { class: 'table-wrap matrix-wrap' }, h('table', { class: 'matrix' }, h('thead', null, head), h('tbody', null, scopeRow, body)))),
    createForm,
  );
}
