'use strict';

const { PDFDocument } = require('pdf-lib');
const { isWinAnsi } = require('./validation');

// Details that can be printed on an uploaded template, in editor order.
const TEMPLATE_FIELDS = [
  ['name', 'Student name'],
  ['college', 'College'],
  ['sessionTitle', 'Session title'],
  ['sessionDate', 'Session date'],
  ['venue', 'Venue'],
  ['issueDate', 'Issue date'],
  ['certificateId', 'Certificate ID'],
  ['verifyUrl', 'Verification link'],
];
const FIELD_IDS = TEMPLATE_FIELDS.map(([id]) => id);

const FONTS = [
  ['helvetica', 'Helvetica'],
  ['helvetica-bold', 'Helvetica Bold'],
  ['helvetica-oblique', 'Helvetica Italic'],
  ['times', 'Times'],
  ['times-bold', 'Times Bold'],
  ['times-italic', 'Times Italic'],
  ['times-bold-italic', 'Times Bold Italic'],
  ['courier', 'Courier'],
  ['courier-bold', 'Courier Bold'],
];
const FONT_IDS = FONTS.map(([id]) => id);
const ALIGNS = ['left', 'center', 'right'];

// x/y are percentages of the page from the top-left corner; y is the text baseline.
// maxWidth is a percentage of the page width: longer text shrinks to fit.
const f = (show, x, y, size, font, color, align, maxWidth, prefix = '') => ({ show, x, y, size, font, color, align, maxWidth, prefix });
const DEFAULT_LAYOUT = Object.freeze({
  fields: {
    name: f(true, 50, 48, 34, 'times-bold', '#1b1b20', 'center', 70),
    college: f(false, 50, 55, 14, 'helvetica', '#3a3a44', 'center', 70),
    sessionTitle: f(true, 50, 62, 16, 'helvetica-bold', '#1b1b20', 'center', 75),
    sessionDate: f(true, 50, 69, 13, 'helvetica', '#3a3a44', 'center', 60),
    venue: f(false, 50, 75, 12, 'helvetica', '#3a3a44', 'center', 70),
    issueDate: f(false, 6, 89, 9, 'helvetica', '#3a3a44', 'left', 40, 'Issued: '),
    certificateId: f(true, 6, 93, 9, 'helvetica-bold', '#3a3a44', 'left', 44, 'Certificate ID: '),
    verifyUrl: f(true, 94, 93, 8, 'helvetica', '#3a3a44', 'right', 50, 'Verify at '),
  },
});

const num = (raw, min, max) => (typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max ? Math.round(raw * 100) / 100 : null);

/** Validate a layout object. Returns { value, errors } (errors keyed "fieldId.prop"). */
function validateLayout(input) {
  const errors = {};
  const fields = {};
  const src = input && typeof input === 'object' && input.fields && typeof input.fields === 'object' ? input.fields : null;
  if (!src) return { value: null, errors: { layout: 'Layout is missing.' } };
  for (const id of FIELD_IDS) {
    const raw = src[id];
    const def = DEFAULT_LAYOUT.fields[id];
    if (raw === undefined) {
      fields[id] = { ...def, show: false };
      continue;
    }
    if (!raw || typeof raw !== 'object') {
      errors[id] = 'Invalid field settings.';
      continue;
    }
    const out = {};
    const bad = (prop, msg) => {
      errors[`${id}.${prop}`] = msg;
    };
    out.show = raw.show === true;
    out.x = num(raw.x, 0, 100);
    if (out.x === null) bad('x', 'Across must be 0-100.');
    out.y = num(raw.y, 0, 100);
    if (out.y === null) bad('y', 'Down must be 0-100.');
    out.size = num(raw.size, 4, 120);
    if (out.size === null) bad('size', 'Size must be 4-120.');
    out.maxWidth = num(raw.maxWidth, 5, 100);
    if (out.maxWidth === null) bad('maxWidth', 'Max width must be 5-100.');
    out.font = FONT_IDS.includes(raw.font) ? raw.font : null;
    if (!out.font) bad('font', 'Choose a font.');
    out.align = ALIGNS.includes(raw.align) ? raw.align : null;
    if (!out.align) bad('align', 'Choose an alignment.');
    out.color = typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color.toLowerCase() : null;
    if (!out.color) bad('color', 'Colour must look like #1b1b20.');
    const prefix = raw.prefix == null ? '' : raw.prefix;
    if (typeof prefix !== 'string' || [...prefix].length > 60 || /[\u0000-\u001F\u007F]/.test(prefix) || !isWinAnsi(prefix)) {
      bad('prefix', 'Text before must be at most 60 characters: English letters and common punctuation.');
    }
    out.prefix = typeof prefix === 'string' ? prefix : '';
    fields[id] = out;
  }
  if (!Object.keys(errors).length && !fields.name.show) errors['name.show'] = 'The student name must be printed.';
  return { value: Object.keys(errors).length ? null : { fields }, errors };
}

class TemplateFileError extends Error {}

/**
 * Check an uploaded template file and work out the certificate page size.
 * Returns { fileType, pageWidth, pageHeight }; throws TemplateFileError with a message for staff.
 */
async function inspectTemplateFile(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) throw new TemplateFileError('The file is empty.');
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-';
  if (isPdf) {
    let src;
    let page;
    try {
      src = await PDFDocument.load(buf, { updateMetadata: false });
      page = src.getPageCount() > 0 ? src.getPage(0) : null;
    } catch (err) {
      if (/encrypt/i.test(err.message)) throw new TemplateFileError('This PDF is password-protected. Export it again without a password.');
      throw new TemplateFileError('This PDF could not be read. Export it again from your design tool (PDF, single page).');
    }
    if (!page) throw new TemplateFileError('This PDF has no pages.');
    if (page.getRotation().angle % 360 !== 0) throw new TemplateFileError('The first page is rotated. Export the page without rotation.');
    const { width, height } = page.getSize();
    if (!(width >= 144 && height >= 144 && width <= 5000 && height <= 5000)) throw new TemplateFileError('The page size is unusual. Use A4 or Letter.');
    // Trial run: some PDFs parse but cannot be placed on a certificate (e.g. an empty page).
    try {
      const trial = await PDFDocument.create();
      const [embedded] = await trial.embedPdf(src, [0]);
      trial.addPage([width, height]).drawPage(embedded);
      await trial.save();
    } catch {
      throw new TemplateFileError('This PDF could not be used as a background (the first page may be empty). Export the design again as a PDF.');
    }
    return { fileType: 'pdf', pageWidth: width, pageHeight: height };
  }
  if (isPng || isJpeg) {
    const doc = await PDFDocument.create();
    let img;
    try {
      img = isPng ? await doc.embedPng(buf) : await doc.embedJpg(buf);
    } catch {
      throw new TemplateFileError('This image could not be read. Save it again as PNG or JPEG.');
    }
    if (img.width < 600 || img.height < 400) throw new TemplateFileError('The image is too small to print well. Use at least 1754 × 1240 pixels (A4 at 150 dpi).');
    // Fit the long side of A4 (landscape or portrait, following the image).
    const landscape = img.width >= img.height;
    const pageWidth = landscape ? 841.89 : 595.28;
    return { fileType: isPng ? 'png' : 'jpeg', pageWidth, pageHeight: Math.round(((pageWidth * img.height) / img.width) * 100) / 100 };
  }
  throw new TemplateFileError('Upload a PDF, PNG or JPEG file.');
}

const toApi = (t) =>
  t && {
    id: t.id,
    name: t.name,
    fileType: t.file_type,
    fileSize: t.file_size,
    pageWidth: t.page_width,
    pageHeight: t.page_height,
    layout: JSON.parse(t.layout),
    isDefault: t.is_default === 1,
    archived: t.archived === 1,
    usedBy: { certificates: t.cert_count ?? 0, sessions: t.session_count ?? 0 },
    createdBy: t.created_by ? { id: t.created_by, name: t.created_by_name } : null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };

const SELECT = `
  SELECT t.id, t.name, t.file_type, t.file_size, t.page_width, t.page_height, t.layout, t.is_default, t.archived,
    t.created_by, t.created_at, t.updated_at, u.name AS created_by_name,
    (SELECT COUNT(*) FROM certificate_registrations r WHERE r.template_id = t.id) AS cert_count,
    (SELECT COUNT(*) FROM sessions s WHERE s.template_id = t.id) AS session_count
  FROM certificate_templates t LEFT JOIN users u ON u.id = t.created_by`;

// Uploaded files are stored in parts of this size (TiDB keeps at most 6 MiB in one row).
const FILE_PART_BYTES = 2 * 1024 * 1024;

function createTemplateRepo(db) {
  const now = () => new Date().toISOString();
  const get = async (id) => toApi(await db.get(`${SELECT} WHERE t.id = ?`, [id]));
  const defaultId = async () =>
    (await db.get('SELECT id FROM certificate_templates WHERE is_default = 1 AND archived = 0 ORDER BY id LIMIT 1'))?.id ?? null;

  /** Everything needed to render with a template, including the file bytes. Cached per id + updated_at. */
  const cache = new Map();
  async function forRender(id) {
    if (!id) return null;
    const row = await db.get('SELECT id, file_type, page_width, page_height, layout, updated_at FROM certificate_templates WHERE id = ?', [id]);
    if (!row) return null;
    const hit = cache.get(id);
    if (hit && hit.updatedAt === row.updated_at) return hit.template;
    const parts = await db.all('SELECT data FROM certificate_template_files WHERE template_id = ? ORDER BY part', [id]);
    const template = {
      id: row.id,
      fileType: row.file_type,
      file: Buffer.concat(parts.map((p) => p.data)),
      pageWidth: row.page_width,
      pageHeight: row.page_height,
      layout: JSON.parse(row.layout),
    };
    cache.set(id, { updatedAt: row.updated_at, template });
    if (cache.size > 20) cache.delete(cache.keys().next().value);
    return template;
  }

  async function create({ name, file, fileType, pageWidth, pageHeight, layout = DEFAULT_LAYOUT }, userId) {
    const t = now();
    const id = await db.transaction(async () => {
      const r = await db.run(
        `INSERT INTO certificate_templates (name, file_type, file_size, page_width, page_height, layout, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, fileType, file.length, pageWidth, pageHeight, JSON.stringify(layout), userId, t, t],
      );
      for (let part = 0, at = 0; at < file.length; part++, at += FILE_PART_BYTES) {
        await db.run('INSERT INTO certificate_template_files (template_id, part, data) VALUES (?, ?, ?)', [
          r.insertId,
          part,
          file.subarray(at, at + FILE_PART_BYTES),
        ]);
      }
      return r.insertId;
    });
    return get(id);
  }

  async function update(id, { name, layout, archived }) {
    const sets = [];
    const params = [];
    if (name !== undefined) {
      sets.push('name = ?');
      params.push(name);
    }
    if (layout !== undefined) {
      sets.push('layout = ?');
      params.push(JSON.stringify(layout));
    }
    if (archived !== undefined) {
      sets.push('archived = ?');
      params.push(archived ? 1 : 0);
      if (archived) sets.push('is_default = 0');
    }
    if (sets.length) await db.run(`UPDATE certificate_templates SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now(), id]);
    return get(id);
  }

  /** Make a template the default for new certificates; null = the built-in Sloka design. */
  async function setDefault(id) {
    await db.transaction(async () => {
      await db.run('UPDATE certificate_templates SET is_default = 0 WHERE is_default = 1');
      if (id) await db.run('UPDATE certificate_templates SET is_default = 1, archived = 0, updated_at = ? WHERE id = ?', [now(), id]);
    });
  }

  /** Delete a template nobody has used; otherwise resolves to 'in_use'. */
  async function remove(id) {
    const t = await get(id);
    if (!t) return 'not_found';
    if (t.usedBy.certificates > 0 || t.usedBy.sessions > 0) return 'in_use';
    await db.run('DELETE FROM certificate_templates WHERE id = ?', [id]); // its file parts go with it
    cache.delete(id);
    return 'deleted';
  }

  return {
    list: async () => (await db.all(`${SELECT} ORDER BY t.archived ASC, t.is_default DESC, t.created_at DESC, t.id DESC`)).map(toApi),
    get,
    forRender,
    create,
    update,
    setDefault,
    remove,
    defaultId,
  };
}

module.exports = {
  TEMPLATE_FIELDS,
  FONTS,
  ALIGNS,
  DEFAULT_LAYOUT,
  validateLayout,
  inspectTemplateFile,
  TemplateFileError,
  createTemplateRepo,
};
