'use strict';

const express = require('express');
const {
  TEMPLATE_FIELDS,
  FONTS,
  ALIGNS,
  DEFAULT_LAYOUT,
  validateLayout,
  inspectTemplateFile,
  TemplateFileError,
  PLACEHOLDER_FIELDS,
  initialLayout,
  detectPlaceholders,
} = require('../certificateTemplates');
const { renderCertificatePdf } = require('../certificatePdf');
const { validateTemplateName } = require('../validation');
const { localDate, validationError, HttpError } = require('../util');

const UPLOAD_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const MIME = { pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg' };
const hasErrors = (o) => Object.keys(o).length > 0;

function parseId(raw) {
  if (!/^\d{1,12}$/.test(String(raw))) throw new HttpError(404, { error: 'not_found' });
  return Number(raw);
}

/**
 * Certificate designs: uploaded templates (PDF or image), where each detail is printed on them, and the
 * placeholders found in a PDF's text with the detail each one is replaced by.
 */
function templatesRouter({ config, templateRepo, auth, audit }) {
  const router = express.Router();
  const may = (action) => auth.requirePermission(`certTemplates.${action}`);
  const upload = express.raw({ type: UPLOAD_TYPES, limit: config.templateMaxBytes });

  async function load(id) {
    const t = await templateRepo.get(id);
    if (!t) throw new HttpError(404, { error: 'not_found' });
    return t;
  }
  const listing = async () => {
    const [templates, defaultId] = await Promise.all([templateRepo.list(), templateRepo.defaultId()]);
    return { templates, builtInIsDefault: !defaultId };
  };

  const sample = () => ({
    certificateId: `${config.certIdPrefix}-${new Date().getFullYear()}-7K4M9Q2X`,
    name: 'Priya Sharma',
    college: 'CVR College of Engineering, Hyderabad',
    sessionTitle: 'Careers in VLSI and Embedded Systems',
    sessionDate: localDate(),
    venue: 'CVR College of Engineering, Hyderabad',
    mode: 'in-person',
    issuedAt: new Date().toISOString(),
    studentId: `${config.studentIdPrefix}-STU-${new Date().getFullYear()}-00042`,
  });

  // The session form lists the designs.
  router.get('/', auth.requireAny('certTemplates.view', 'sessions.create', 'sessions.edit'), async (req, res) => {
    res.json({
      ...(await listing()),
      fields: TEMPLATE_FIELDS.map(([id, label]) => ({ id, label })),
      placeholderFields: PLACEHOLDER_FIELDS.map(({ id, label }) => ({ id, label })),
      fonts: FONTS.map(([id, label]) => ({ id, label })),
      aligns: ALIGNS,
      defaultLayout: DEFAULT_LAYOUT,
      maxBytes: config.templateMaxBytes,
    });
  });

  // Upload: raw file body (PDF, PNG or JPEG); the name travels in the query string.
  router.post('/', may('create'), upload, async (req, res) => {
    const { values, errors } = validateTemplateName(typeof req.query.name === 'string' ? req.query.name : '');
    if (hasErrors(errors)) throw validationError(errors);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw validationError({ file: 'Choose a PDF, PNG or JPEG file.' });
    let info;
    try {
      info = await inspectTemplateFile(req.body);
    } catch (err) {
      if (err instanceof TemplateFileError) throw validationError({ file: err.message });
      throw err;
    }
    const { placeholders, ...file } = info;
    const template = await templateRepo.create({ name: values.name, file: req.body, ...file, layout: initialLayout(info) }, req.user.id);
    await audit.log({
      actorId: req.user.id, entity: 'certificate_template', entityId: template.id, action: 'upload',
      summary: `Uploaded certificate design "${template.name}" (${file.fileType.toUpperCase()}, ${placeholders.length} placeholder${placeholders.length === 1 ? '' : 's'} found)`,
    });
    res.status(201).json({ template, placeholdersFound: placeholders.length });
  });

  // Which design new certificates use. { id: number } or { id: null } for the built-in Sloka design.
  router.put('/default', may('edit'), async (req, res) => {
    const raw = req.body ? req.body.id : undefined;
    if (raw === null) await templateRepo.setDefault(null);
    else {
      const t = await load(parseId(raw));
      if (t.archived) throw validationError({ id: 'Restore this template before making it the default.' });
      await templateRepo.setDefault(t.id);
    }
    res.json(await listing());
  });

  // Sample certificate for checking a layout before saving it. { templateId?: number|null, layout?: {...} }
  router.post('/preview', may('view'), async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let template = null;
    if (body.templateId != null) {
      const id = parseId(body.templateId);
      await load(id);
      template = { ...(await templateRepo.forRender(id)) };
      if (body.layout !== undefined) {
        const { value, errors } = validateLayout(body.layout);
        if (hasErrors(errors)) throw validationError(errors);
        template.layout = value;
      }
    }
    const pdf = await renderCertificatePdf(sample(), config, template);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="certificate-preview.pdf"');
    res.send(Buffer.from(pdf));
  });

  router.get('/:id', may('view'), async (req, res) => {
    res.json({ template: await load(parseId(req.params.id)) });
  });

  // Look for placeholders in the design's file again, with a suggested detail for each. Nothing is saved:
  // the editor merges them into the layout.
  router.post('/:id/placeholders', may('edit'), async (req, res) => {
    const id = parseId(req.params.id);
    const t = await load(id);
    const { file } = await templateRepo.forRender(id);
    res.json({ placeholders: await detectPlaceholders(file, t.fileType, t.pageWidth), searched: t.fileType === 'pdf' });
  });

  router.get('/:id/file', may('view'), async (req, res) => {
    const id = parseId(req.params.id);
    const t = await load(id);
    const { file } = await templateRepo.forRender(id);
    res.setHeader('Content-Type', MIME[t.fileType]);
    res.setHeader('Content-Disposition', `attachment; filename="certificate-template-${id}.${t.fileType === 'jpeg' ? 'jpg' : t.fileType}"`);
    res.send(file);
  });

  router.patch('/:id', may('edit'), async (req, res) => {
    const id = parseId(req.params.id);
    const before = await load(id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const changes = {};
    const errors = {};
    if (body.name !== undefined) {
      const r = validateTemplateName(body.name);
      if (r.errors.name) errors.name = r.errors.name;
      else changes.name = r.values.name;
    }
    if (body.layout !== undefined) {
      const r = validateLayout(body.layout);
      if (hasErrors(r.errors)) Object.assign(errors, r.errors);
      else changes.layout = r.value;
    }
    if (body.archived !== undefined) {
      if (typeof body.archived !== 'boolean') errors.archived = 'Archived must be true or false.';
      else changes.archived = body.archived;
    }
    if (hasErrors(errors)) throw validationError(errors);
    const template = await templateRepo.update(id, changes);
    const what = [changes.name !== undefined && changes.name !== before.name && 'name', changes.layout && 'layout', changes.archived !== undefined && (changes.archived ? 'archived' : 'restored')].filter(Boolean);
    if (what.length) {
      await audit.log({
        actorId: req.user.id, entity: 'certificate_template', entityId: id, action: 'update', summary: `Changed certificate design "${template.name}": ${what.join(', ')}`,
        changes: changes.name !== undefined && changes.name !== before.name ? [{ field: 'Name', from: before.name, to: changes.name }] : [],
      });
    }
    res.json({ template });
  });

  // Only templates that no certificate or session uses can be deleted; others can be archived.
  router.delete('/:id', may('delete'), async (req, res) => {
    const id = parseId(req.params.id);
    const t = await templateRepo.get(id);
    const result = await templateRepo.remove(id);
    if (result === 'not_found') throw new HttpError(404, { error: 'not_found' });
    if (result === 'in_use') {
      return res.status(409).json({ error: 'in_use', message: 'Certificates or sessions use this template, so it cannot be deleted. Archive it instead.' });
    }
    await audit.log({ actorId: req.user.id, entity: 'certificate_template', entityId: id, action: 'delete', summary: `Deleted certificate design "${t.name}"` });
    return res.status(204).end();
  });

  return router;
}

module.exports = { templatesRouter };
