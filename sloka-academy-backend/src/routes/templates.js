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

/** Certificate designs: uploaded templates (PDF or image) and where each detail is printed on them. */
function templatesRouter({ config, templateRepo, auth }) {
  const router = express.Router();
  const manage = auth.requirePermission('manage');
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
  });

  // Any signed-in user: the session form lists the designs.
  router.get('/', async (req, res) => {
    res.json({
      ...(await listing()),
      fields: TEMPLATE_FIELDS.map(([id, label]) => ({ id, label })),
      fonts: FONTS.map(([id, label]) => ({ id, label })),
      aligns: ALIGNS,
      defaultLayout: DEFAULT_LAYOUT,
      maxBytes: config.templateMaxBytes,
    });
  });

  // Upload: raw file body (PDF, PNG or JPEG); the name travels in the query string.
  router.post('/', manage, upload, async (req, res) => {
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
    const template = await templateRepo.create({ name: values.name, file: req.body, ...info }, req.user.id);
    res.status(201).json({ template });
  });

  // Which design new certificates use. { id: number } or { id: null } for the built-in Sloka design.
  router.put('/default', manage, async (req, res) => {
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
  router.post('/preview', manage, async (req, res) => {
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

  router.get('/:id', manage, async (req, res) => {
    res.json({ template: await load(parseId(req.params.id)) });
  });

  router.get('/:id/file', manage, async (req, res) => {
    const id = parseId(req.params.id);
    const t = await load(id);
    const { file } = await templateRepo.forRender(id);
    res.setHeader('Content-Type', MIME[t.fileType]);
    res.setHeader('Content-Disposition', `attachment; filename="certificate-template-${id}.${t.fileType === 'jpeg' ? 'jpg' : t.fileType}"`);
    res.send(file);
  });

  router.patch('/:id', manage, async (req, res) => {
    const id = parseId(req.params.id);
    await load(id);
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
    res.json({ template: await templateRepo.update(id, changes) });
  });

  // Only templates that no certificate or session uses can be deleted; others can be archived.
  router.delete('/:id', auth.requirePermission('deleteRecords'), async (req, res) => {
    const result = await templateRepo.remove(parseId(req.params.id));
    if (result === 'not_found') throw new HttpError(404, { error: 'not_found' });
    if (result === 'in_use') {
      return res.status(409).json({ error: 'in_use', message: 'Certificates or sessions use this template, so it cannot be deleted. Archive it instead.' });
    }
    return res.status(204).end();
  });

  return router;
}

module.exports = { templatesRouter };
