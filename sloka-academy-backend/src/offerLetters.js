'use strict';

const { renderOfferLetterPdf, A4, BUILT_IN_MARGINS } = require('./offerLetterPdf');
const { longDate } = require('./certificatePdf');
const { isWinAnsi } = require('./validation');
const { toMappings, validateMappings, extractPlaceholders } = require('./placeholders');
const { localDate } = require('./util');

/**
 * Internship offer letters: one per enrollment, generated when the slot is confirmed (token received) and
 * regenerated on request. A letter keeps a snapshot of what it says; its PDF is rendered from that on demand.
 * Templates: the built-in letterhead with the default text, or uploaded ones (a background file and/or text),
 * set as the default or assigned to course domains.
 */

// The placeholders a letter can use, with other names an uploaded document may use for them.
const OFFER_FIELDS = [
  { id: 'student_name', label: 'Student name', aliases: ['name', 'studentname', 'fullname', 'candidatename', 'internname', 'candidate', 'student'] },
  { id: 'student_id', label: 'Student ID', aliases: ['studentid', 'studentcode', 'registrationno', 'regno'] },
  { id: 'course_domain', label: 'Course domain', aliases: ['course', 'domain', 'coursename', 'program', 'programme', 'internshipdomain', 'role', 'position'] },
  { id: 'college_name', label: 'College name', aliases: ['college', 'collegename', 'university', 'institution', 'institute'] },
  { id: 'internship_start_date', label: 'Internship start date', aliases: ['startdate', 'joiningdate', 'dateofjoining', 'batchstartdate', 'commencementdate', 'fromdate'] },
  { id: 'internship_duration', label: 'Internship duration', aliases: ['duration', 'period', 'tenure'] },
  { id: 'offer_date', label: 'Offer date', aliases: ['date', 'dateofoffer', 'issuedate', 'letterdate'] },
  { id: 'offer_letter_id', label: 'Offer letter ID', aliases: ['offerid', 'letterid', 'offerletterno', 'referenceno', 'refno', 'reference', 'ref'] },
  { id: 'signatory_name', label: 'Signatory name', aliases: ['signatory', 'authorisedsignatory', 'authorizedsignatory', 'signedby'] },
  { id: 'signatory_designation', label: 'Signatory designation', aliases: ['designation', 'signatorytitle', 'title'] },
];
const FIELD_IDS = OFFER_FIELDS.map((f) => f.id);

const DEFAULT_BODY = `**Subject: Offer of Internship – {{course_domain}}**

Dear {{student_name}},

We are pleased to offer you an internship with Sloka Academy in **{{course_domain}}**, starting {{internship_start_date}}, for a duration of {{internship_duration}}.

During the internship, you will work on a project assigned by your mentor. When you complete and submit the project, you will be awarded a **Certificate of Internship**.

Please note that this is an **unpaid internship**; no stipend or remuneration is payable.

We look forward to working with you.

{{signatory_name}}
{{signatory_designation}}
Sloka Academy (a unit of Slifax Private Limited)
Offer Letter ID: {{offer_letter_id}} | Date: {{offer_date}}`;

const DEFAULT_LAYOUT = Object.freeze({
  margins: { ...BUILT_IN_MARGINS }, // percent of the page: the text area on an uploaded background (starts as the letterhead's)
  font: 'helvetica',
  size: 11,
  color: '#1b1b20',
  lineHeight: 1.5,
  placeholders: [],
});

const num = (raw, min, max) => (typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max ? Math.round(raw * 100) / 100 : null);

/** Validate a template's text: printable, and only known {{placeholders}}. Returns { value, error }. */
function validateBody(raw) {
  if (typeof raw !== 'string') return { error: 'Letter text must be text.' };
  const value = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if ([...value].length > 8000) return { error: 'Letter text must be at most 8000 characters.' };
  if (!isWinAnsi(value.replace(/[\n\t]/g, ' '))) return { error: 'Letter text: use English letters and common punctuation only (the PDF fonts cannot print other characters).' };
  const unknown = [...value.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1]).filter((k) => !FIELD_IDS.includes(k));
  if (unknown.length) return { error: `Unknown placeholder ${unknown.map((k) => `{{${k}}}`).join(', ')}. Use: ${FIELD_IDS.map((k) => `{{${k}}}`).join(' ')}` };
  return { value };
}

/** Validate a layout. pages: of the template's file (placeholders). Returns { value, errors }. */
function validateOfferLayout(input, pages = 10) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : null;
  if (!src) return { value: null, errors: { layout: 'Layout is missing.' } };
  const m = src.margins && typeof src.margins === 'object' ? src.margins : {};
  const margins = {};
  for (const side of ['top', 'right', 'bottom', 'left']) {
    margins[side] = num(m[side], 0, 60);
    if (margins[side] === null) errors[`margins.${side}`] = 'Margins are 0-60 (% of the page).';
  }
  if (margins.left + margins.right > 80 || margins.top + margins.bottom > 85) errors.margins = 'The margins leave no room for the text.';
  const value = {
    margins,
    font: ['helvetica', 'times'].includes(src.font) ? src.font : null,
    size: num(src.size, 7, 18),
    color: typeof src.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.color) ? src.color.toLowerCase() : null,
    lineHeight: num(src.lineHeight, 1, 2.5),
  };
  if (!value.font) errors.font = 'Choose Helvetica or Times.';
  if (value.size === null) errors.size = 'Text size is 7-18 points.';
  if (!value.color) errors.color = 'Colour must look like #1b1b20.';
  if (value.lineHeight === null) errors.lineHeight = 'Line spacing is 1-2.5.';
  const mapped = validateMappings(src.placeholders, FIELD_IDS, { pages });
  Object.assign(errors, mapped.errors);
  value.placeholders = mapped.value;
  return Object.keys(errors).length ? { value: null, errors } : { value, errors };
}

const templateToApi = (t) =>
  t && {
    id: t.id,
    name: t.name,
    fileType: t.file_type ?? null,
    fileSize: t.file_size ?? null,
    pageWidth: t.page_width,
    pageHeight: t.page_height,
    body: t.body,
    layout: JSON.parse(t.layout),
    isDefault: t.is_default === 1,
    active: t.active === 1,
    usedBy: { letters: t.letter_count ?? 0, courses: t.course_count ?? 0 },
    createdBy: t.created_by ? { id: t.created_by, name: t.created_by_name ?? null } : null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };

const TEMPLATE_SELECT = `
  SELECT t.*, u.name AS created_by_name,
    (SELECT COUNT(*) FROM offer_letters l WHERE l.template_id = t.id) AS letter_count,
    (SELECT COUNT(*) FROM courses c WHERE c.offer_template_id = t.id) AS course_count
  FROM offer_templates t LEFT JOIN users u ON u.id = t.created_by`;

const FILE_PART_BYTES = 2 * 1024 * 1024; // TiDB keeps at most 6 MiB in one row

function createOfferTemplateRepo(db) {
  const now = () => new Date().toISOString();
  const get = async (id) => templateToApi(await db.get(`${TEMPLATE_SELECT} WHERE t.id = ?`, [id]));

  // File bytes, cached per id + updated_at (templates' files never change, but they can be deleted).
  const cache = new Map();
  async function file(id) {
    const row = await db.get('SELECT updated_at FROM offer_templates WHERE id = ?', [id]);
    if (!row) return null;
    const hit = cache.get(id);
    if (hit && hit.updatedAt === row.updated_at) return hit.file;
    const parts = await db.all('SELECT data FROM offer_template_files WHERE template_id = ? ORDER BY part', [id]);
    const bytes = parts.length ? Buffer.concat(parts.map((p) => p.data)) : null;
    cache.set(id, { updatedAt: row.updated_at, file: bytes });
    if (cache.size > 20) cache.delete(cache.keys().next().value);
    return bytes;
  }

  /** What rendering needs: { id, fileType, file, pageWidth, pageHeight } (file null for the letterhead). */
  async function forRender(id) {
    const t = await get(id);
    if (!t) return null;
    return { id: t.id, fileType: t.fileType, file: t.fileType ? await file(id) : null, pageWidth: t.pageWidth, pageHeight: t.pageHeight };
  }

  async function create({ name, body, layout, upload }, userId) {
    const t = now();
    const id = await db.transaction(async () => {
      const r = await db.run(
        `INSERT INTO offer_templates (name, file_type, file_size, page_width, page_height, body, layout, is_default, active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
        [name, upload ? upload.fileType : null, upload ? upload.file.length : null, upload ? upload.pageWidth : A4[0], upload ? upload.pageHeight : A4[1], body, JSON.stringify(layout), userId, t, t],
      );
      if (upload) {
        for (let part = 0, at = 0; at < upload.file.length; part++, at += FILE_PART_BYTES) {
          await db.run('INSERT INTO offer_template_files (template_id, part, data) VALUES (?, ?, ?)', [r.insertId, part, upload.file.subarray(at, at + FILE_PART_BYTES)]);
        }
      }
      return r.insertId;
    });
    return get(id);
  }

  async function update(id, changes) {
    const cols = { name: 'name', body: 'body', layout: 'layout', active: 'active' };
    const sets = [];
    const params = [];
    for (const [k, col] of Object.entries(cols)) {
      if (changes[k] === undefined) continue;
      sets.push(`${col} = ?`);
      params.push(k === 'layout' ? JSON.stringify(changes[k]) : k === 'active' ? (changes[k] ? 1 : 0) : changes[k]);
    }
    if (changes.active === false) sets.push('is_default = 0');
    if (sets.length) await db.run(`UPDATE offer_templates SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now(), id]);
    return get(id);
  }

  /** The default for new letters; null = the built-in letterhead with the default text. */
  async function setDefault(id) {
    await db.transaction(async () => {
      await db.run('UPDATE offer_templates SET is_default = 0 WHERE is_default = 1');
      if (id) await db.run('UPDATE offer_templates SET is_default = 1, active = 1, updated_at = ? WHERE id = ?', [now(), id]);
    });
  }

  /** Delete a template no letter or course uses; otherwise resolves to 'in_use'. */
  async function remove(id) {
    const t = await get(id);
    if (!t) return 'not_found';
    if (t.usedBy.letters || t.usedBy.courses) return 'in_use';
    await db.run('DELETE FROM offer_templates WHERE id = ?', [id]);
    cache.delete(id);
    return 'deleted';
  }

  /**
   * The template a new letter for `courseId` uses: the course's own (if active), else the default (if active),
   * else null (built-in). Resolves to the template (API shape) or null.
   */
  async function forCourse(courseId) {
    const row = await db.get(
      `SELECT COALESCE(
        (SELECT t.id FROM courses c JOIN offer_templates t ON t.id = c.offer_template_id AND t.active = 1 WHERE c.id = ?),
        (SELECT id FROM offer_templates WHERE is_default = 1 AND active = 1 ORDER BY id LIMIT 1)) AS id`,
      [courseId],
    );
    return row && row.id ? get(row.id) : null;
  }

  return {
    list: async () => (await db.all(`${TEMPLATE_SELECT} ORDER BY t.is_default DESC, t.active DESC, t.created_at DESC, t.id DESC`)).map(templateToApi),
    get,
    file,
    forRender,
    create,
    update,
    setDefault,
    remove,
    forCourse,
  };
}

const letterToApi = (l, events = []) =>
  l && {
    id: l.id,
    offerLetterId: l.offer_code,
    enrollmentId: l.enrollment_id,
    template: l.template_id ? { id: l.template_id, name: l.template_name ?? null } : null,
    offerDate: l.offer_date,
    status: l.status,
    emailError: l.email_error ?? null,
    sentAt: l.sent_at ?? null,
    generatedAt: l.generated_at,
    generatedBy: l.generated_by ? { id: l.generated_by, name: l.generated_by_name ?? null } : null,
    events: events.map((e) => ({ type: e.type, detail: e.detail, actor: e.actor_id ? { id: e.actor_id, name: e.actor_name } : null, createdAt: e.created_at })),
  };

/**
 * Letters: generate (or regenerate) from an enrollment, render, email.
 * settings: the settings store (signatory); notifier: sends the email (optional in tests).
 */
function createOfferLetters({ db, config, templates, settings, notifier }) {
  const now = () => new Date().toISOString();
  const LETTER_SELECT = `SELECT l.*, t.name AS template_name, g.name AS generated_by_name
    FROM offer_letters l LEFT JOIN offer_templates t ON t.id = l.template_id LEFT JOIN users g ON g.id = l.generated_by`;

  async function event(letterId, type, detail, actorId) {
    await db.run('INSERT INTO offer_letter_events (offer_letter_id, type, detail, actor_id, created_at) VALUES (?, ?, ?, ?, ?)', [letterId, type, detail, actorId, now()]);
  }

  async function signatory() {
    const s = await settings.all();
    return {
      name: s.offer_signatory_name ?? (config.certSignatoryName || 'Authorised Signatory'),
      designation: s.offer_signatory_designation ?? config.certSignatoryTitle ?? '',
    };
  }

  /** Next SLK/OL/YYYY/0001 (counted per year, never reused). */
  async function nextCode(date) {
    const year = date.slice(0, 4);
    return db.transaction(async () => {
      await db.run('INSERT INTO id_sequences (name, value) VALUES (?, 1) ON DUPLICATE KEY UPDATE value = value + 1', [`offer:${year}`]);
      const { value } = await db.get('SELECT value FROM id_sequences WHERE name = ?', [`offer:${year}`]);
      return `${config.certIdPrefix}/OL/${year}/${String(value).padStart(4, '0')}`;
    });
  }

  /**
   * Generate the enrollment's letter (or regenerate it: same ID, fresh contents and date, back to "Generated").
   * Runs in the caller's transaction when there is one. Resolves to the letter.
   */
  function generate(enrollmentId, actorId) {
    return db.transaction(async () => {
      const e = await db.get(
        `SELECT e.id, e.course_id, e.batch_start_date, st.name, st.student_code, st.college, c.name AS course_name, c.duration
        FROM enrollments e JOIN students st ON st.id = e.student_id JOIN courses c ON c.id = e.course_id WHERE e.id = ?`,
        [enrollmentId],
      );
      if (!e) return null;
      const existing = await db.get('SELECT id, offer_code FROM offer_letters WHERE enrollment_id = ? FOR UPDATE', [enrollmentId]);
      const today = localDate();
      const code = existing ? existing.offer_code : await nextCode(today);
      const template = await templates.forCourse(e.course_id);
      const sign = await signatory();
      const values = {
        student_name: e.name,
        student_id: e.student_code || '',
        course_domain: e.course_name,
        college_name: e.college || '',
        internship_start_date: longDate(e.batch_start_date),
        internship_duration: e.duration,
        offer_date: longDate(today),
        offer_letter_id: code,
        signatory_name: sign.name,
        signatory_designation: sign.designation,
      };
      const content = JSON.stringify({
        values,
        body: template ? template.body : DEFAULT_BODY,
        layout: template ? template.layout : DEFAULT_LAYOUT,
      });
      const t = now();
      let id;
      if (existing) {
        id = existing.id;
        await db.run(
          "UPDATE offer_letters SET template_id = ?, content = ?, offer_date = ?, status = 'generated', email_error = NULL, generated_by = ?, generated_at = ?, updated_at = ? WHERE id = ?",
          [template ? template.id : null, content, today, actorId, t, t, id],
        );
        await event(id, 'regenerated', `Regenerated${template ? ` with "${template.name}"` : ' with the built-in letterhead'}`, actorId);
      } else {
        id = (
          await db.run(
            `INSERT INTO offer_letters (offer_code, enrollment_id, template_id, content, offer_date, status, generated_by, generated_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'generated', ?, ?, ?)`,
            [code, enrollmentId, template ? template.id : null, content, today, actorId, t, t],
          )
        ).insertId;
        await event(id, 'generated', `Generated${template ? ` with "${template.name}"` : ' with the built-in letterhead'}`, actorId);
      }
      return get(enrollmentId);
    });
  }

  async function row(enrollmentId) {
    return db.get(`${LETTER_SELECT} WHERE l.enrollment_id = ?`, [enrollmentId]);
  }

  async function get(enrollmentId) {
    const l = await row(enrollmentId);
    if (!l) return null;
    const events = await db.all(
      `SELECT e.*, u.name AS actor_name FROM offer_letter_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.offer_letter_id = ? ORDER BY e.created_at DESC, e.id DESC`,
      [l.id],
    );
    return letterToApi(l, events);
  }

  /** PDF bytes of the enrollment's letter, or null. */
  async function render(enrollmentId) {
    const l = await row(enrollmentId);
    if (!l) return null;
    const template = l.template_id ? await templates.forRender(l.template_id) : null;
    return { pdf: await renderOfferLetterPdf(JSON.parse(l.content), config, template), code: l.offer_code };
  }

  /** A sample letter for a template (stored, or as being edited) with made-up values. */
  async function preview({ body, layout, templateId }) {
    const sign = await signatory();
    const values = {
      student_name: 'Priya Sharma',
      student_id: `${config.studentIdPrefix}-STU-${new Date().getFullYear()}-00042`,
      course_domain: 'Data Science',
      college_name: 'CVR College of Engineering, Hyderabad',
      internship_start_date: longDate(localDate()),
      internship_duration: '2 months',
      offer_date: longDate(localDate()),
      offer_letter_id: `${config.certIdPrefix}/OL/${new Date().getFullYear()}/0042`,
      signatory_name: sign.name,
      signatory_designation: sign.designation,
    };
    const template = templateId ? await templates.forRender(templateId) : null;
    return renderOfferLetterPdf({ values, body, layout }, config, template, { preview: true });
  }

  /** Email the letter to the student. Resolves to the letter; status becomes sent or failed. */
  async function send(enrollmentId, actorId) {
    const l = await row(enrollmentId);
    if (!l) return null;
    const student = await db.get('SELECT st.name, st.email FROM enrollments e JOIN students st ON st.id = e.student_id WHERE e.id = ?', [enrollmentId]);
    const values = JSON.parse(l.content).values;
    try {
      if (!notifier || !notifier.studentEmailEnabled) throw new Error('Email is not configured on the server.');
      if (!student.email) throw new Error('The student has no email address.');
      const { pdf } = await render(enrollmentId);
      await notifier.sendOfferLetter({ to: student.email, name: student.name, courseDomain: values.course_domain, offerLetterId: l.offer_code, pdf });
      await db.run("UPDATE offer_letters SET status = 'sent', email_error = NULL, sent_at = ?, updated_at = ? WHERE id = ?", [now(), now(), l.id]);
      await event(l.id, 'sent', `Emailed to ${student.email}`, actorId);
    } catch (err) {
      const reason = String(err.message || err).slice(0, 300);
      await db.run("UPDATE offer_letters SET status = 'failed', email_error = ?, updated_at = ? WHERE id = ?", [reason, now(), l.id]);
      await event(l.id, 'failed', reason, actorId);
    }
    return get(enrollmentId);
  }

  return { generate, get, render, preview, send, signatory, emailEnabled: () => Boolean(notifier && notifier.studentEmailEnabled) };
}

/** Placeholders in an uploaded offer letter file (PDF), with suggested fields. */
async function detectOfferPlaceholders(file, fileType, pageWidth) {
  if (fileType !== 'pdf') return [];
  return toMappings(await extractPlaceholders(file, { maxPages: 10 }), OFFER_FIELDS, pageWidth);
}

module.exports = {
  createOfferTemplateRepo,
  createOfferLetters,
  detectOfferPlaceholders,
  validateBody,
  validateOfferLayout,
  OFFER_FIELDS,
  DEFAULT_BODY,
  DEFAULT_LAYOUT,
};
