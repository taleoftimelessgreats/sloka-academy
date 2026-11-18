// Settings: integrations, certificate designs, offer letter templates (each with their placeholder mapping), the
// course master and the offer letter signatory.
// Rendered with DOM APIs / textContent only. Never use innerHTML with data.

import { ApiError, api, can, clearErrors, copyBtn, errorText, field, fieldMessage, fmtBytes, fmtDateTime, go, h, mount, pdfUrl, selectEl, showErrors, state, toast } from './core.js';

// ------------------------------------------------------------------ view: settings (admin)

export async function viewSettings(stale) {
  // Each card for those allowed to see it.
  const [settings, designs, sheetScript, offers, courses] = await Promise.all([
    can('settings.view') ? api('GET', '/api/settings') : null,
    can('certTemplates.view') ? api('GET', '/api/templates') : null,
    can('settings.edit') ? api('GET', '/api/settings/google-sheet/script') : null,
    can('offerTemplates.view') ? api('GET', '/api/offer-templates') : null,
    can('courses.view') ? api('GET', '/api/courses') : null,
  ]);
  if (stale()) return;
  const reload = () => {
    const seq = state.seq;
    viewSettings(() => seq !== state.seq).catch((err) => toast(errorText(err), true));
  };
  mount(
    'Settings',
    h('div', { class: 'page-head' }, h('h1', null, 'Settings')),
    h(
      'div',
      { class: 'stack' },
      offers ? offerLettersCard(offers, reload) : null,
      courses ? coursesCard(courses.courses, offers ? offers.templates : [], reload) : null,
      settings ? sheetCard(settings, sheetScript && sheetScript.script, reload) : null,
      designs ? designsCard(designs, reload) : null,
      settings ? emailCard(settings.email) : null,
    ),
  );
}

export function sheetCard(settings, script, reload) {
  const g = settings.googleSheet;
  const card = h('section', { class: 'card', id: 'google-sheet' }, h('h2', null, 'Google Sheet'));
  card.append(
    h(
      'p',
      { class: 'muted' },
      `Every career guidance registration is added as a row to the “${g.tab}” tab of the sheet connected here, and every friend a student refers to the “${g.referralTab}” tab. Registrations made before you connect a sheet are copied across too.`,
    ),
  );
  // Connecting a sheet sends it every registration, so only those who may export data see the script and can change it.
  const canChange = can('settings.edit');
  if (canChange) {
    const code = h('textarea', { class: 'mono script-box', readOnly: true, rows: '8', spellcheck: 'false', 'aria-label': 'Apps Script code' });
    code.value = script || '';
    const steps = h(
      'ol',
      { class: 'steps' },
      h('li', null, 'Open the Google Sheet. Its sharing can stay Restricted to your staff: the script does not need link sharing.'),
      h('li', null, 'Click Extensions → Apps Script, delete the code that is there and paste this script: ', copyBtn(script || '', 'Copy script'), code),
      h('li', null, 'Click Deploy → New deployment → Select type: Web app. Set Execute as: Me and Who has access: Anyone, then Deploy. Allow access when Google asks (if it says the app isn’t verified, click Advanced → Go to the project: it is your own script).'),
      h('li', null, 'Copy the Web app URL (it ends in /exec) and paste it below.'),
    );
    card.append(
      g.configured
        ? h('details', { class: 'more' }, h('summary', null, 'Set-up steps and script'), steps)
        : steps,
    );
  }
  const url = h('input', { name: 'url', type: 'url', value: g.webAppUrl || '', placeholder: 'https://script.google.com/macros/s/…/exec', autocomplete: 'off', readOnly: !canChange });
  const save = canChange ? h('button', { class: 'btn btn-primary', type: 'submit' }, g.configured ? 'Update' : 'Connect') : null;
  const form = h(
    'form',
    { class: 'sheet-form', novalidate: true },
    field('Web app URL', url, { name: 'url', hint: canChange ? null : 'Only associates allowed to edit settings can connect or change the sheet.' }),
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
      if (!url.value.trim()) toast('Sheet disconnected');
      else if (r.check && r.check.ok) toast(`Connected to “${r.check.title}”. Registrations are being copied.`);
      else toast(`Saved, but the sheet did not answer: ${r.check ? r.check.message : 'unknown error'}`, true);
      setTimeout(reload, r.check && r.check.ok ? 1500 : 0);
    } catch (err) {
      showErrors(form, err);
    } finally {
      save.disabled = false;
    }
  });
  card.append(form);

  if (g.configured) {
    const dl = h('dl', { class: 'info' });
    if (g.sheetTitle) dl.append(h('dt', null, 'Sheet'), h('dd', null, g.sheetTitle));
    dl.append(h('dt', null, 'Last copied'), h('dd', null, g.lastSyncAt ? fmtDateTime(g.lastSyncAt) : 'Not yet'));
    dl.append(h('dt', null, 'Waiting'), h('dd', null, g.pending === null ? '—' : `${g.pending} ${g.pending === 1 ? 'registration' : 'registrations'}`));
    if (g.lastError) dl.append(h('dt', null, 'Problem'), h('dd', { class: 'error-text' }, `${g.lastError}${g.lastErrorAt ? ` (${fmtDateTime(g.lastErrorAt)})` : ''}`));
    const test = h('button', { class: 'btn', type: 'button' }, 'Test connection');
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
    const sync = h('button', { class: 'btn', type: 'button' }, 'Sync now');
    sync.addEventListener('click', async () => {
      sync.disabled = true;
      try {
        const r = await api('POST', '/api/settings/google-sheet/sync', {});
        toast(r.ok ? (r.synced ? `Copied ${r.synced} ${r.synced === 1 ? 'registration' : 'registrations'}` : 'Already up to date') : r.message, !r.ok);
        reload();
      } catch (err) {
        toast(fieldMessage(err), true);
        sync.disabled = false;
      }
    });
    card.append(h('div', { class: 'sync-status' }, dl, h('div', { class: 'row' }, test, sync)));
  }
  card.append(h('p', { class: 'muted small' }, 'Rows are added, never changed: later corrections, revocations and deletions in this portal are not copied to the sheet. When a student asks for their data to be deleted, delete their rows in the sheet too.'));
  return card;
}

export function designsCard(designs, reload) {
  const card = h('section', { class: 'card card-flush', id: 'designs' }, h('h2', null, 'Certificate designs'));
  card.append(h('p', { class: 'muted pad' }, 'Upload the certificate artwork, then choose what is printed where. A PDF with placeholders such as {{Student Name}} has them replaced; otherwise place the name, session and other details on it. New certificates use the default design unless their session picks another. Certificates keep the design they were issued with.'));
  const editable = can('certTemplates.edit');

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
      td('Default', designs.builtInIsDefault ? defaultBadge.cloneNode(true) : editable ? h('button', { class: 'btn btn-sm', type: 'button', onclick: makeDefault(null) }, 'Make default') : '—'),
      td('Actions', h('button', { class: 'btn btn-sm', type: 'button', onclick: preview(null) }, 'Preview')),
    ),
    ...designs.templates.map((t) => {
      const actions = h('div', { class: 'row' }, editable ? h('a', { class: 'btn btn-sm', href: `#/settings/templates/${t.id}` }, 'Edit layout') : null, h('button', { class: 'btn btn-sm', type: 'button', onclick: preview(t.id) }, 'Preview'));
      if (editable) {
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
      }
      if (can('certTemplates.delete') && !t.usedBy.certificates && !t.usedBy.sessions) {
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
        h('td', { class: 'primary', 'data-label': 'Design' }, editable ? h('a', { class: 'name', href: `#/settings/templates/${t.id}` }, t.name) : h('span', { class: 'name' }, t.name), h('span', { class: 'sub' }, `Uploaded ${fmtDateTime(t.createdAt)}${t.createdBy ? ` by ${t.createdBy.name}` : ''}${t.archived ? ' · archived' : ''}`)),
        td('File', `${t.fileType.toUpperCase()} · ${fmtBytes(t.fileSize)}`),
        td('Used by', used || h('span', { class: 'muted' }, 'Not used yet')),
        td('Default', t.isDefault ? defaultBadge.cloneNode(true) : t.archived || !editable ? h('span', { class: 'muted' }, '—') : h('button', { class: 'btn btn-sm', type: 'button', onclick: makeDefault(t.id) }, 'Make default')),
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

  if (!can('certTemplates.create')) return card;

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
      field('File', file, { name: 'file', required: true, hint: `PDF (first page is used; placeholders in its text are found), PNG or JPEG, up to ${fmtBytes(designs.maxBytes)}. Keep it under 2 MB so emails stay small.` }),
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
    submit.disabled = true;
    submit.textContent = 'Uploading…';
    try {
      const body = await uploadFile('/api/templates', name.value.trim(), f);
      toast(body.placeholdersFound ? `Design uploaded: ${body.placeholdersFound} placeholders found. Check what each is replaced by.` : 'Design uploaded. Now place the details.');
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

export function emailCard(email) {
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

export async function viewTemplateEditor(id, stale) {
  const [{ template: t }, designs] = await Promise.all([api('GET', `/api/templates/${id}`), api('GET', '/api/templates')]);
  if (stale()) return;
  const layout = structuredClone(t.layout);
  const fonts = designs.fonts;
  const aligns = designs.aligns.map((a) => ({ id: a, label: a[0].toUpperCase() + a.slice(1) }));
  let timer;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 400);
  };
  const mapper = placeholderMapper(layout.placeholders, { fieldOptions: designs.placeholderFields, fonts, fileType: t.fileType, rescanPath: `/api/templates/${id}/placeholders`, onChange: later });

  const frame = h('iframe', { class: 'preview-frame', title: 'Certificate preview' });
  let currentUrl = null;
  const refresh = async () => {
    try {
      const next = await pdfUrl('/api/templates/preview', { templateId: id, layout: collect() });
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = next;
      frame.src = `${next}#toolbar=0&navpanes=0&view=Fit`;
      clearErrors(area);
    } catch (err) {
      showErrors(area, err);
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
    return { fields, placeholders: mapper.collect() };
  }

  const nameInput = h('input', { name: 'name', value: t.name, maxlength: '80' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save layout');
  const form = h(
    'form',
    { class: 'card card-flush', novalidate: true },
    h(
      'div',
      { class: 'pad' },
      h('h2', null, layout.placeholders && layout.placeholders.length ? 'Details printed at a position of your choice' : 'Where the details are printed'),
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
      clearErrors(area);
      refresh();
    } catch (err) {
      showErrors(area, err);
    } finally {
      save.disabled = false;
    }
  });
  form.addEventListener('change', later);

  // Errors for the placeholders and the positioned details are shown across both cards.
  const area = h('div', { class: 'stack' }, mapper.element, form);
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
    h('div', { class: 'stack' }, area, h('section', { class: 'card' }, h('h2', null, 'Preview (sample student)'), frame)),
  );
  refresh();
}

// ------------------------------------------------------------------ placeholders found in an uploaded template

/**
 * The placeholders found in an uploaded PDF and what each is replaced by. Shared by certificate designs and
 * offer letter templates. Returns { element, collect() }. fieldOptions: [{ id, label }]; rescanPath: POST endpoint.
 */
export function placeholderMapper(initial, { fieldOptions, fonts, fileType, rescanPath, onChange }) {
  let list = structuredClone(initial || []);
  const body = h('tbody');
  const aligns = ['left', 'center', 'right'].map((a) => ({ id: a, label: a[0].toUpperCase() + a.slice(1) }));
  const fieldChoices = [{ id: '', label: 'Leave as it is' }, ...fieldOptions];
  let inputs = [];

  function render() {
    inputs = list.map((m, i) => {
      const field = selectEl(`placeholders.${i}.field`, fieldChoices, m.field || '');
      const size = h('input', { type: 'number', min: '3', max: '200', step: '0.5', value: String(m.size), class: 'num-input', 'aria-label': `Size for ${m.text}` });
      const font = selectEl(`placeholders.${i}.font`, fonts, m.font);
      const color = h('input', { type: 'color', value: m.color, class: 'color-input', 'aria-label': `Text colour for ${m.text}` });
      const align = selectEl(`placeholders.${i}.align`, aligns, m.align);
      const fit = h('input', { type: 'checkbox', checked: m.fit, disabled: !m.line, 'aria-label': `Set the whole line of ${m.text} again` });
      const cover = h('input', { type: 'color', value: m.cover || '#ffffff', class: 'color-input', disabled: !m.cover, 'aria-label': `Cover colour for ${m.text}` });
      const covered = h('input', { type: 'checkbox', checked: Boolean(m.cover), 'aria-label': `Cover ${m.text}` });
      covered.addEventListener('change', () => {
        cover.disabled = !covered.checked;
      });
      for (const el of [field, font, align]) el.setAttribute('aria-label', `${el.name.split('.').pop()} for ${m.text}`);
      return { m, field, size, font, color, align, fit, cover, covered };
    });
    body.replaceChildren(
      ...inputs.map((x, i) => {
        const cell = (lbl, prop, ...el) => h('td', { 'data-label': lbl }, ...el, h('small', { class: 'error', 'data-error-for': `placeholders.${i}.${prop}` }));
        return h(
          'tr',
          { class: x.m.field ? null : 'unmapped' },
          h('td', { class: 'primary', 'data-label': 'Placeholder' }, h('span', { class: 'mono' }, x.m.text), h('span', { class: 'sub' }, `Page ${x.m.page + 1}${x.m.line ? ` · in “${x.m.line.text.length > 48 ? `${x.m.line.text.slice(0, 46)}…` : x.m.line.text}”` : ''}`)),
          cell('Replaced by', 'field', x.field),
          cell('Size', 'size', x.size),
          cell('Font', 'font', x.font),
          cell('Colour', 'color', x.color),
          cell('Align', 'align', x.align),
          cell('Whole line', 'fit', h('label', { class: 'check' }, x.fit, h('span', { class: 'sr-only' }, 'Set the whole line again'))),
          cell('Cover', 'cover', h('div', { class: 'row' }, x.covered, x.cover)),
        );
      }),
    );
  }

  const collect = () =>
    inputs.map((x) => ({
      ...x.m,
      field: x.field.value || null,
      size: Number(x.size.value),
      font: x.font.value,
      color: x.color.value,
      align: x.align.value,
      fit: x.fit.checked,
      cover: x.covered.checked ? x.cover.value : null,
    }));

  const rescan = h('button', { class: 'btn btn-sm', type: 'button' }, 'Find placeholders again');
  rescan.addEventListener('click', async () => {
    try {
      const r = await api('POST', rescanPath);
      // Keep what was chosen for placeholders that are still there.
      const before = new Map(collect().map((m) => [`${m.page}|${m.text}|${Math.round(m.x)}|${Math.round(m.y)}`, m]));
      list = r.placeholders.map((m) => before.get(`${m.page}|${m.text}|${Math.round(m.x)}|${Math.round(m.y)}`) || m);
      render();
      empty.hidden = list.length > 0;
      table.hidden = list.length === 0;
      toast(`${list.length} placeholder${list.length === 1 ? '' : 's'} found`);
      onChange();
    } catch (err) {
      toast(errorText(err), true);
    }
  });

  render();
  const table = h(
    'div',
    { class: 'table-wrap', hidden: list.length === 0 },
    h('table', { class: 'stackable layout-table' }, h('thead', null, h('tr', null, ['Placeholder', 'Replaced by', 'Size', 'Font', 'Colour', 'Align', 'Whole line', 'Cover'].map((t) => h('th', null, t)))), body),
  );
  const empty = h(
    'p',
    { class: 'muted small pad', hidden: list.length > 0 },
    fileType === 'pdf'
      ? 'No placeholders were found in this file. Placeholders are text such as {{Student Name}}, <<Date>>, «College» or [Certificate ID] in the PDF. Designs exported as images, or with text turned into outlines, have none.'
      : 'This is an image, so it has no text to search for placeholders.',
  );
  const element = h(
    'section',
    { class: 'card card-flush' },
    h(
      'div',
      { class: 'pad' },
      h('div', { class: 'card-head flush' }, h('h2', null, 'Placeholders in your file'), fileType === 'pdf' ? rescan : null),
      h(
        'p',
        { class: 'muted small' },
        'Each placeholder found in the uploaded PDF is covered and replaced by the detail chosen here, at its position and size. When a placeholder is inside a sentence, the whole line is set again with the values in place, so a long name or title moves the rest of the sentence along instead of overlapping it (font, size and colour below apply to that line). The cover is a box in the colour found around the placeholder; change it if your design needs another.',
      ),
    ),
    empty,
    table,
  );
  element.addEventListener('change', () => onChange());
  return { element, collect };
}

// ------------------------------------------------------------------ course master

export function coursesCard(courses, templates, reload) {
  const card = h('section', { class: 'card card-flush', id: 'courses' }, h('div', { class: 'pad' }, h('h2', null, 'Course master'), h('p', { class: 'muted small' }, 'The course domains students register for, the internship duration printed on their offer letter, and (optionally) the offer letter template of each domain.')));
  const editable = can('courses.edit');
  const activeTemplates = templates.filter((t) => t.active);
  const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
  const rows = courses.map((c) => {
    if (!editable) {
      return h('tr', { class: c.active ? null : 'archived' }, h('td', { class: 'primary', 'data-label': 'Course domain' }, c.name), td('Duration', c.duration), td('Offer letter', c.offerTemplate ? c.offerTemplate.name : h('span', { class: 'muted' }, 'Default')), td('Registrations', String(c.enrollments)), td('Status', c.active ? 'Active' : 'Retired'));
    }
    const name = h('input', { value: c.name, maxlength: '150', 'aria-label': 'Course domain' });
    const duration = h('input', { value: c.duration, maxlength: '60', class: 'short-input', 'aria-label': `Duration of ${c.name}` });
    const options = [...activeTemplates, ...(c.offerTemplate && !activeTemplates.some((t) => t.id === c.offerTemplate.id) ? [c.offerTemplate] : [])].map((t) => ({ id: t.id, label: t.name }));
    const template = selectEl('offerTemplateId', options, c.offerTemplate ? c.offerTemplate.id : '', { empty: 'Default template' });
    template.setAttribute('aria-label', `Offer letter template for ${c.name}`);
    const active = h('button', { class: 'btn btn-sm btn-ghost', type: 'button' }, c.active ? 'Retire' : 'Reactivate');
    const save = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, 'Save');
    const submit = async (body) => {
      try {
        await api('PATCH', `/api/courses/${c.id}`, body);
        toast('Course saved');
        reload();
      } catch (err) {
        toast(fieldMessage(err), true);
      }
    };
    save.addEventListener('click', () => submit({ name: name.value, duration: duration.value, offerTemplateId: template.value ? Number(template.value) : null }));
    active.addEventListener('click', () => submit({ active: !c.active }));
    return h(
      'tr',
      { class: c.active ? null : 'archived' },
      h('td', { class: 'primary', 'data-label': 'Course domain' }, name),
      td('Duration', duration),
      td('Offer letter', template),
      td('Registrations', String(c.enrollments)),
      td('Actions', h('div', { class: 'row' }, save, active)),
    );
  });
  // A long list: folded away until needed.
  const active = courses.filter((c) => c.active).length;
  card.append(
    h(
      'details',
      { class: 'fold' },
      h('summary', { class: 'pad' }, `${active} active course domain${active === 1 ? '' : 's'}${courses.length > active ? `, ${courses.length - active} retired` : ''}`),
      h(
        'div',
        { class: 'table-wrap' },
        h('table', { class: 'stackable' }, h('thead', null, h('tr', null, ['Course domain', 'Duration', 'Offer letter', 'Registrations', editable ? 'Actions' : 'Status'].map((t) => h('th', null, t)))), h('tbody', null, rows)),
      ),
    ),
  );
  if (can('courses.create')) {
    const name = h('input', { name: 'name', maxlength: '150', required: true });
    const duration = h('input', { name: 'duration', maxlength: '60', value: '2 months', required: true });
    const form = h(
      'form',
      { class: 'pad', novalidate: true },
      h('h3', null, 'Add a course domain'),
      h('div', { class: 'form-grid' }, field('Course domain', name, { required: true }), field('Internship duration', duration, { required: true, hint: 'As printed on the offer letter.' })),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add course domain')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/courses', { name: name.value, duration: duration.value });
        toast('Course domain added');
        reload();
      } catch (err) {
        showErrors(form, err);
      }
    });
    card.append(form);
  }
  return card;
}

// ------------------------------------------------------------------ offer letter templates

async function uploadFile(path, name, file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = file.type || { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || 'application/octet-stream';
  let res;
  try {
    res = await fetch(`${path}?name=${encodeURIComponent(name)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': type }, body: file });
  } catch {
    throw new ApiError(0, { error: 'network' });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

export function offerLettersCard(data, reload) {
  const card = h(
    'section',
    { class: 'card card-flush', id: 'offer-letters' },
    h(
      'div',
      { class: 'pad' },
      h('h2', null, 'Offer letter templates'),
      h('p', { class: 'muted small' }, 'Every registration gets an offer letter when its slot is confirmed. A letter uses its course domain’s template, otherwise the default. Upload your letterhead (PDF, PNG or JPEG) or a complete letter with placeholders; new templates stay inactive until you have checked the preview and activated them.'),
    ),
  );
  const editable = can('offerTemplates.edit');
  const call = (method, path, body, msg) => async () => {
    try {
      await api(method, path, body);
      toast(msg);
      reload();
    } catch (err) {
      toast(fieldMessage(err), true);
    }
  };
  const preview = (templateId) => async () => {
    try {
      window.open(await pdfUrl('/api/offer-templates/preview', templateId ? { templateId } : {}), '_blank', 'noopener');
    } catch (err) {
      toast(fieldMessage(err), true);
    }
  };
  const td = (lbl, ...c) => h('td', { 'data-label': lbl }, ...c);
  const defaultBadge = () => h('span', { class: 'badge', 'data-status': 'open' }, 'Default');
  const rows = [
    h(
      'tr',
      null,
      h('td', { class: 'primary', 'data-label': 'Template' }, h('span', { class: 'name' }, 'Sloka letterhead'), h('span', { class: 'sub' }, 'Built in: logo band and the standard offer text')),
      td('Kind', 'Built in'),
      td('Status', 'Active'),
      td('Used by', h('span', { class: 'muted' }, '—')),
      td('Default', data.builtInIsDefault ? defaultBadge() : editable ? h('button', { class: 'btn btn-sm', type: 'button', onclick: call('PUT', '/api/offer-templates/default', { id: null }, 'Default changed') }, 'Make default') : '—'),
      td('Actions', h('button', { class: 'btn btn-sm', type: 'button', onclick: preview(null) }, 'Preview')),
    ),
    ...data.templates.map((t) => {
      const actions = h('div', { class: 'row' }, h('a', { class: 'btn btn-sm', href: `#/settings/offer-templates/${t.id}` }, editable ? 'Edit' : 'View'), h('button', { class: 'btn btn-sm', type: 'button', onclick: preview(t.id) }, 'Preview'));
      if (editable) actions.append(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: call('PATCH', `/api/offer-templates/${t.id}`, { active: !t.active }, t.active ? 'Template deactivated' : 'Template activated') }, t.active ? 'Deactivate' : 'Activate'));
      if (can('offerTemplates.delete') && !t.usedBy.letters && !t.usedBy.courses) {
        actions.append(
          h(
            'button',
            {
              class: 'btn btn-sm btn-danger',
              type: 'button',
              onclick: () => window.confirm(`Delete the template “${t.name}”?`) && call('DELETE', `/api/offer-templates/${t.id}`, undefined, 'Template deleted')(),
            },
            'Delete',
          ),
        );
      }
      const used = [t.usedBy.letters ? `${t.usedBy.letters} letters` : null, t.usedBy.courses ? `${t.usedBy.courses} course domains` : null].filter(Boolean).join(', ');
      return h(
        'tr',
        { class: t.active ? null : 'archived' },
        h('td', { class: 'primary', 'data-label': 'Template' }, h('a', { class: 'name', href: `#/settings/offer-templates/${t.id}` }, t.name), h('span', { class: 'sub' }, `Added ${fmtDateTime(t.createdAt)}${t.createdBy ? ` by ${t.createdBy.name}` : ''}`)),
        td('Kind', t.fileType ? `${t.fileType.toUpperCase()} · ${fmtBytes(t.fileSize)}${t.body ? '' : ' · complete letter'}` : 'Text on the letterhead'),
        td('Status', t.active ? 'Active' : h('span', { class: 'muted' }, 'Inactive')),
        td('Used by', used || h('span', { class: 'muted' }, 'Not used yet')),
        td('Default', t.isDefault ? defaultBadge() : editable && t.active ? h('button', { class: 'btn btn-sm', type: 'button', onclick: call('PUT', '/api/offer-templates/default', { id: t.id }, 'Default changed') }, 'Make default') : '—'),
        td('Actions', actions),
      );
    }),
  ];
  card.append(h('div', { class: 'table-wrap' }, h('table', { class: 'stackable' }, h('thead', null, h('tr', null, ['Template', 'Kind', 'Status', 'Used by', 'Default', 'Actions'].map((t) => h('th', null, t)))), h('tbody', null, rows))));

  if (can('offerTemplates.create')) {
    const name = h('input', { name: 'name', maxlength: '80', placeholder: 'e.g. Internship offer 2026', required: true });
    const file = h('input', { name: 'file', type: 'file', accept: '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg' });
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add template');
    const form = h(
      'form',
      { class: 'pad upload-form', novalidate: true },
      h('h3', null, 'Add a template'),
      h(
        'div',
        { class: 'form-grid' },
        field('Name', name, { name: 'name', required: true }),
        field('File (optional)', file, { name: 'file', hint: `Letterhead or complete letter: PDF, PNG or JPEG up to ${fmtBytes(data.maxBytes)}. Without a file, the template is text on the Sloka letterhead.` }),
      ),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, submit),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      submit.disabled = true;
      try {
        const f = file.files[0];
        const r = f ? await uploadFile('/api/offer-templates', name.value.trim(), f) : await api('POST', '/api/offer-templates/text', { name: name.value });
        toast(r.placeholdersFound ? `Template added: ${r.placeholdersFound} placeholders found. Check what each is replaced by.` : 'Template added. Check it, then activate it.');
        go(`#/settings/offer-templates/${r.template.id}`);
      } catch (err) {
        showErrors(form, err);
      } finally {
        submit.disabled = false;
      }
    });
    card.append(form);
  }

  if (editable) {
    const sname = h('input', { name: 'name', maxlength: '100', value: data.signatory.name || '' });
    const sdes = h('input', { name: 'designation', maxlength: '100', value: data.signatory.designation || '' });
    const form = h(
      'form',
      { class: 'pad', novalidate: true },
      h('h3', null, 'Signatory'),
      h('p', { class: 'muted small' }, 'Printed as {{signatory_name}} and {{signatory_designation}} on new and regenerated letters.'),
      h('div', { class: 'form-grid' }, field('Signatory name', sname, { name: 'name' }), field('Designation', sdes, { name: 'designation' })),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save signatory')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/offer-templates/signatory', { name: sname.value, designation: sdes.value });
        toast('Signatory saved');
      } catch (err) {
        showErrors(form, err);
      }
    });
    card.append(form);
  }
  return card;
}

export async function viewOfferTemplateEditor(id, stale) {
  const [{ template: t }, data] = await Promise.all([api('GET', `/api/offer-templates/${id}`), api('GET', '/api/offer-templates')]);
  if (stale()) return;
  const editable = can('offerTemplates.edit');
  const layout = structuredClone(t.layout);

  const frame = h('iframe', { class: 'preview-frame preview-portrait', title: 'Offer letter preview' });
  let currentUrl = null;
  const refresh = async () => {
    try {
      const next = await pdfUrl('/api/offer-templates/preview', { templateId: id, body: bodyInput.value, layout: collect() });
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = next;
      frame.src = `${next}#toolbar=0&navpanes=0&view=FitH`;
      clearErrors(form);
    } catch (err) {
      showErrors(form, err);
    }
  };
  let timer;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 500);
  };

  const nameInput = h('input', { name: 'name', value: t.name, maxlength: '80', disabled: !editable });
  const bodyInput = h('textarea', { name: 'body', rows: '16', class: 'mono-text', disabled: !editable }, t.body);
  const insert = (text) => {
    const { selectionStart: a, selectionEnd: b, value } = bodyInput;
    bodyInput.value = value.slice(0, a) + text + value.slice(b);
    bodyInput.focus();
    bodyInput.selectionStart = bodyInput.selectionEnd = a + text.length;
    later();
  };
  const chips = h(
    'div',
    { class: 'chips' },
    data.fields.map((f) => h('button', { class: 'chip', type: 'button', title: f.label, disabled: !editable, onclick: () => insert(f.placeholder) }, f.placeholder)),
    h('button', { class: 'chip', type: 'button', disabled: !editable, onclick: () => insert('**bold**') }, '**bold**'),
  );
  const num = (name, value, min, max, step) => h('input', { type: 'number', name, value: String(value), min: String(min), max: String(max), step: String(step), class: 'num-input', disabled: !editable });
  const lay = {
    top: num('margins.top', layout.margins.top, 0, 60, 0.5),
    right: num('margins.right', layout.margins.right, 0, 60, 0.5),
    bottom: num('margins.bottom', layout.margins.bottom, 0, 60, 0.5),
    left: num('margins.left', layout.margins.left, 0, 60, 0.5),
    font: selectEl('font', [{ id: 'helvetica', label: 'Helvetica' }, { id: 'times', label: 'Times' }], layout.font),
    size: num('size', layout.size, 7, 18, 0.5),
    color: h('input', { type: 'color', name: 'color', value: layout.color, class: 'color-input', disabled: !editable }),
    lineHeight: num('lineHeight', layout.lineHeight, 1, 2.5, 0.05),
  };
  lay.font.disabled = !editable;
  const mapper = t.fileType
    ? placeholderMapper(layout.placeholders, { fieldOptions: data.fields.map((f) => ({ id: f.id, label: f.label })), fonts: data.fonts, fileType: t.fileType, rescanPath: `/api/offer-templates/${id}/placeholders`, onChange: later })
    : null;
  function collect() {
    return {
      margins: { top: Number(lay.top.value), right: Number(lay.right.value), bottom: Number(lay.bottom.value), left: Number(lay.left.value) },
      font: lay.font.value,
      size: Number(lay.size.value),
      color: lay.color.value,
      lineHeight: Number(lay.lineHeight.value),
      placeholders: mapper ? mapper.collect() : [],
    };
  }

  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save template');
  const textCards = h(
    'div',
    { class: 'stack' },
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Letter text'),
      h('div', { class: 'form-grid' }, field('Template name', nameInput, { name: 'name' })),
      h(
        'p',
        { class: 'muted small' },
        t.fileType === 'pdf'
          ? 'Printed on your file within the margins below. Leave it empty if your PDF is the complete letter: its placeholders are filled in instead.'
          : 'Insert details with the buttons. **Text between two pairs of stars** is printed in bold. A blank line starts a new paragraph.',
      ),
      chips,
      field('Text', bodyInput, { name: 'body', full: true }),
    ),
    t.fileType
      ? h(
          'section',
          { class: 'card' },
          h('h2', null, 'Text area and type'),
          h('p', { class: 'muted small' }, 'Margins are percentages of the page, so the text sits inside your letterhead’s blank area.'),
          h(
            'div',
            { class: 'form-grid' },
            field('Top margin %', lay.top, { name: 'margins.top' }),
            field('Right margin %', lay.right, { name: 'margins.right' }),
            field('Bottom margin %', lay.bottom, { name: 'margins.bottom' }),
            field('Left margin %', lay.left, { name: 'margins.left' }),
            field('Font', lay.font, { name: 'font' }),
            field('Size (points)', lay.size, { name: 'size' }),
            field('Colour', lay.color, { name: 'color' }),
            field('Line spacing', lay.lineHeight, { name: 'lineHeight' }),
          ),
        )
      : null,
  );
  // One form: the text and layout beside the preview, the placeholders (a wide table) below.
  const form = h(
    'form',
    { class: 'stack', novalidate: true },
    h('div', { class: 'editor-split' }, textCards, h('section', { class: 'card' }, h('h2', null, 'Preview (sample student)'), frame)),
    mapper ? mapper.element : null,
    h('p', { class: 'form-error', role: 'alert' }),
    editable ? h('div', { class: 'form-actions' }, save, h('button', { class: 'btn', type: 'button', onclick: refresh }, 'Update preview')) : null,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    try {
      await api('PATCH', `/api/offer-templates/${id}`, { name: nameInput.value, body: bodyInput.value, layout: collect() });
      toast(t.active ? 'Template saved' : 'Template saved. Activate it when the preview looks right.');
      clearErrors(form);
      refresh();
    } catch (err) {
      showErrors(form, err);
    } finally {
      save.disabled = false;
    }
  });
  form.addEventListener('input', (e) => {
    if (e.target === bodyInput) later();
  });
  form.addEventListener('change', later);

  const toggle = editable
    ? h(
        'button',
        {
          class: t.active ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm',
          type: 'button',
          onclick: async () => {
            try {
              await api('PATCH', `/api/offer-templates/${id}`, { active: !t.active });
              toast(t.active ? 'Deactivated' : 'Activated: it can be the default or a course domain’s template');
              go(`#/settings/offer-templates/${id}?r=${Date.now()}`);
            } catch (err) {
              toast(fieldMessage(err), true);
            }
          },
        },
        t.active ? 'Deactivate' : 'Activate',
      )
    : null;
  mount(
    t.name,
    h('div', { class: 'page-head' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/settings' }, '← Settings')),
    h(
      'div',
      { class: 'page-head' },
      h('h1', null, t.name),
      t.isDefault ? h('span', { class: 'badge', 'data-status': 'open' }, 'Default') : null,
      h('span', { class: 'badge', 'data-status': t.active ? 'open' : 'closed' }, t.active ? 'Active' : 'Inactive'),
      h('span', { class: 'spacer' }),
      t.fileType ? h('a', { class: 'btn btn-sm', href: `/api/offer-templates/${id}/file`, download: '' }, 'Download original') : null,
      toggle,
    ),
    t.usedBy.letters ? h('div', { class: 'notice' }, `${t.usedBy.letters} offer ${t.usedBy.letters === 1 ? 'letter was' : 'letters were'} generated with this template. They keep the text they were generated with until regenerated.`) : null,
    form,
  );
  refresh();
}
