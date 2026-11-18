'use strict';

const express = require('express');
const { inspectTemplateFile, sourceTypeOf, mappingPending, TemplateFileError, FONTS } = require('../certificateTemplates');
const { detectOfferPlaceholders, validateBody, validateOfferLayout, OFFER_FIELDS, DEFAULT_BODY, DEFAULT_LAYOUT } = require('../offerLetters');
const { toMappings } = require('../placeholders');
const { validateTemplateName, isWinAnsi } = require('../validation');
const { validationError, HttpError } = require('../util');

// What the browser may label an upload. Only PDFs are accepted (the portal converts Word and PowerPoint files
// first); the other types are read so that the file's own bytes can say why it was refused (certificateTemplates.js).
const UPLOAD_TYPES = [
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream',
];
const MIME = { pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg' };
const hasErrors = (o) => Object.keys(o).length > 0;

function parseId(raw) {
  if (!/^\d{1,12}$/.test(String(raw))) throw new HttpError(404, { error: 'not_found' });
  return Number(raw);
}

/** A letter needs something that names the student: text, or a placeholder in the uploaded document mapped to them. */
function checkComplete(body, layout, fileType, errors) {
  if (!body && !(fileType === 'pdf' && layout.placeholders.some((m) => m.field === 'student_name'))) {
    errors.body = fileType === 'pdf'
      ? 'Write the letter text, or map a placeholder of the document to the student name.'
      : 'Write the letter text.';
  }
}

/**
 * Offer letter templates: upload (a PDF letterhead or complete letter; Word and PowerPoint files are converted to
 * PDF by the portal) or text-only on the built-in letterhead; the letter text with {{placeholders}}; placeholders
 * found in an uploaded document and the field each one is replaced by; preview with sample data; activate, set as
 * default, assign to courses. A template whose placeholders have not been mapped yet cannot be activated.
 */
function offerTemplatesRouter({ config, auth, templates, offerLetters, settings, audit }) {
  const router = express.Router();
  const may = (action) => auth.requirePermission(`offerTemplates.${action}`);
  const upload = express.raw({ type: UPLOAD_TYPES, limit: config.templateMaxBytes });

  async function load(id) {
    const t = await templates.get(id);
    if (!t) throw new HttpError(404, { error: 'not_found' });
    return t;
  }
  const log = (req, entityId, action, summary, changes = []) => audit.log({ actorId: req.user.id, entity: 'offer_template', entityId, action, summary, changes });

  router.get('/', auth.requireAny('offerTemplates.view', 'courses.edit'), async (req, res) => {
    const list = await templates.list();
    res.json({
      templates: list,
      builtInIsDefault: !list.some((t) => t.isDefault),
      builtIn: { body: DEFAULT_BODY, layout: DEFAULT_LAYOUT },
      fields: OFFER_FIELDS.map(({ id, label }) => ({ id, label, placeholder: `{{${id}}}` })),
      fonts: FONTS.map(([id, label]) => ({ id, label })),
      signatory: await offerLetters.signatory(),
      maxBytes: config.templateMaxBytes,
    });
  });

  // Upload a letterhead or a complete letter (the raw PDF; the name, and `source`: docx | pptx when the portal
  // converted it, in the query string). Placeholders in the document's text are found and suggested a field each; a
  // letter with them gets no text of its own to start with. New templates are inactive until their placeholders are
  // mapped and they have been previewed and activated.
  router.post('/', may('create'), upload, async (req, res) => {
    const { values, errors } = validateTemplateName(typeof req.query.name === 'string' ? req.query.name : '');
    if (hasErrors(errors)) throw validationError(errors);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw validationError({ file: 'Choose a PDF, Word or PowerPoint file.' });
    let info;
    try {
      info = await inspectTemplateFile(req.body, { maxPages: 10 });
    } catch (err) {
      if (err instanceof TemplateFileError) throw validationError({ file: err.message });
      throw err;
    }
    const sourceType = sourceTypeOf(req.query.source);
    const placeholders = toMappings(info.placeholders, OFFER_FIELDS, info.pageWidth);
    const t = await templates.create(
      {
        name: values.name,
        body: placeholders.length ? '' : DEFAULT_BODY,
        layout: { ...DEFAULT_LAYOUT, margins: { ...DEFAULT_LAYOUT.margins }, placeholders, placeholdersConfirmed: !placeholders.length },
        upload: { file: req.body, fileType: info.fileType, sourceType, pageWidth: info.pageWidth, pageHeight: info.pageHeight },
      },
      req.user.id,
    );
    const kind = (sourceType || info.fileType).toUpperCase();
    await log(req, t.id, 'upload', `Uploaded offer letter template "${t.name}" (${kind}, ${placeholders.length} placeholder${placeholders.length === 1 ? '' : 's'} found)`);
    res.status(201).json({ template: t, placeholdersFound: placeholders.length });
  });

  // A template with no file: the built-in letterhead with its own text. { name, body? }
  router.post('/text', may('create'), async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { values, errors } = validateTemplateName(body.name);
    const text = body.body === undefined ? { value: DEFAULT_BODY } : validateBody(body.body);
    if (text.error) errors.body = text.error;
    else if (!text.value) errors.body = 'Write the letter text.';
    if (hasErrors(errors)) throw validationError(errors);
    const t = await templates.create({ name: values.name, body: text.value, layout: { ...DEFAULT_LAYOUT, margins: { ...DEFAULT_LAYOUT.margins }, placeholders: [] } }, req.user.id);
    await log(req, t.id, 'create', `Created offer letter template "${t.name}" (built-in letterhead)`);
    res.status(201).json({ template: t });
  });

  // Which template new letters use when their course has none. { id } or { id: null } for the built-in one.
  router.put('/default', may('edit'), async (req, res) => {
    const raw = req.body ? req.body.id : undefined;
    let name = 'the built-in letterhead';
    if (raw === null) await templates.setDefault(null);
    else {
      const t = await load(parseId(raw));
      if (mappingPending(t.layout)) throw validationError({ id: 'Map the placeholders found in this template before making it the default.' });
      await templates.setDefault(t.id);
      name = `"${t.name}"`;
    }
    await log(req, raw === null ? null : raw, 'set_default', `Made ${name} the default offer letter template`);
    res.json({ templates: await templates.list() });
  });

  // The signatory printed on letters ({{signatory_name}}, {{signatory_designation}}). Applies to new and regenerated letters.
  router.put('/signatory', may('edit'), async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const errors = {};
    const clean = (v, key, label) => {
      if (typeof v !== 'string' || [...v.trim()].length > 100) errors[key] = `${label} must be at most 100 characters.`;
      else if (!isWinAnsi(v.trim())) errors[key] = `${label}: use English letters and common punctuation only.`;
      return typeof v === 'string' ? v.trim() : '';
    };
    const name = clean(body.name, 'name', 'Signatory name');
    const designation = clean(body.designation, 'designation', 'Designation');
    if (!name && !errors.name) errors.name = 'Signatory name is required.';
    if (hasErrors(errors)) throw validationError(errors);
    const before = await offerLetters.signatory();
    await settings.setMany({ offer_signatory_name: name, offer_signatory_designation: designation }, req.user.id);
    await audit.log({
      actorId: req.user.id, entity: 'settings', entityId: 'offer_signatory', action: 'update', summary: 'Changed the offer letter signatory',
      changes: [{ field: 'Signatory name', from: before.name, to: name }, { field: 'Designation', from: before.designation, to: designation }].filter((c) => c.from !== c.to),
    });
    res.json({ signatory: await offerLetters.signatory() });
  });

  // Sample letter. { templateId?, body?, layout? }: a stored template, or one being edited (body/layout not yet saved).
  router.post('/preview', may('view'), async (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    let t = null;
    if (b.templateId != null) t = await load(parseId(b.templateId));
    const text = b.body === undefined ? { value: t ? t.body : DEFAULT_BODY } : validateBody(b.body);
    if (text.error) throw validationError({ body: text.error });
    let layout = t ? t.layout : DEFAULT_LAYOUT;
    if (b.layout !== undefined) {
      const r = validateOfferLayout(b.layout);
      if (hasErrors(r.errors)) throw validationError(r.errors);
      layout = r.value;
    }
    const pdf = await offerLetters.preview({ body: text.value, layout, templateId: t ? t.id : null });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="offer-letter-preview.pdf"');
    res.send(pdf);
  });

  router.get('/:id', may('view'), async (req, res) => {
    res.json({ template: await load(parseId(req.params.id)) });
  });

  router.get('/:id/file', may('view'), async (req, res) => {
    const id = parseId(req.params.id);
    const t = await load(id);
    if (!t.fileType) throw new HttpError(404, { error: 'not_found' });
    res.setHeader('Content-Type', MIME[t.fileType]);
    res.setHeader('Content-Disposition', `attachment; filename="offer-template-${id}.${t.fileType === 'jpeg' ? 'jpg' : t.fileType}"`);
    res.send(await templates.file(id));
  });

  // Look for placeholders in the template's file again (nothing is saved; the editor merges them).
  router.post('/:id/placeholders', may('edit'), async (req, res) => {
    const id = parseId(req.params.id);
    const t = await load(id);
    const file = t.fileType ? await templates.file(id) : null;
    res.json({ placeholders: file ? await detectOfferPlaceholders(file, t.fileType, t.pageWidth) : [], searched: t.fileType === 'pdf' });
  });

  // { name?, body?, layout?, active? }
  router.patch('/:id', may('edit'), async (req, res) => {
    const id = parseId(req.params.id);
    const before = await load(id);
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const changes = {};
    const errors = {};
    if (b.name !== undefined) {
      const r = validateTemplateName(b.name);
      if (r.errors.name) errors.name = r.errors.name;
      else changes.name = r.values.name;
    }
    if (b.body !== undefined) {
      const r = validateBody(b.body);
      if (r.error) errors.body = r.error;
      else changes.body = r.value;
    }
    if (b.layout !== undefined) {
      const r = validateOfferLayout(b.layout);
      if (hasErrors(r.errors)) Object.assign(errors, r.errors);
      else changes.layout = r.value;
    }
    if (b.active !== undefined) {
      if (typeof b.active !== 'boolean') errors.active = 'Active must be true or false.';
      else changes.active = b.active;
    }
    if (!hasErrors(errors)) checkComplete(changes.body ?? before.body, changes.layout ?? before.layout, before.fileType, errors);
    if (changes.active === false && before.usedBy.courses) errors.active = 'Course domains use this template: assign them another one first.';
    if (changes.active === true && !before.active && mappingPending(changes.layout ?? before.layout)) {
      errors.active = 'Map the placeholders found in this template before activating it.';
    }
    if (hasErrors(errors)) throw validationError(errors);
    const t = await templates.update(id, changes);
    const what = [
      changes.name !== undefined && changes.name !== before.name && 'name',
      changes.body !== undefined && changes.body !== before.body && 'letter text',
      changes.layout !== undefined && 'layout and placeholders',
      changes.active !== undefined && changes.active !== before.active && (changes.active ? 'activated' : 'deactivated'),
    ].filter(Boolean);
    if (what.length) {
      await log(req, id, changes.active !== undefined && what.length === 1 ? (changes.active ? 'activate' : 'deactivate') : 'update', `Changed offer letter template "${t.name}": ${what.join(', ')}`,
        changes.name !== undefined && changes.name !== before.name ? [{ field: 'Name', from: before.name, to: changes.name }] : []);
    }
    res.json({ template: t });
  });

  router.delete('/:id', may('delete'), async (req, res) => {
    const id = parseId(req.params.id);
    const t = await load(id);
    const result = await templates.remove(id);
    if (result === 'in_use') {
      return res.status(409).json({ error: 'in_use', message: 'Offer letters or course domains use this template, so it cannot be deleted. Deactivate it instead.' });
    }
    await log(req, id, 'delete', `Deleted offer letter template "${t.name}"`);
    return res.status(204).end();
  });

  return router;
}

module.exports = { offerTemplatesRouter };
