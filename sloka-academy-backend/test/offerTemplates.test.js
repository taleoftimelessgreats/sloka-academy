'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { startApp, addUser, login, client, referral, ALLOWED_ORIGIN } = require('./helpers');
const { suggestField } = require('../src/placeholders');
const { OFFER_FIELDS } = require('../src/offerLetters');
const { localDate } = require('../src/util');

/** All the text of a PDF, as pdf.js reads it. */
async function pdfText(bytes) {
  globalThis.pdfjsWorker ||= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  let out = '';
  for (let p = 1; p <= doc.numPages; p++) out += `${(await (await doc.getPage(p)).getTextContent()).items.map((i) => i.str).join(' ')}\n`;
  await task.destroy();
  return out;
}

/** A one-page PDF with the given lines of text: [text, x, y, size]. */
async function makePdf(lines, size = [842, 595]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage(size);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [text, x, y, s] of lines) page.drawText(text, { x, y, size: s, font });
  return Buffer.from(await doc.save());
}

/** A plain white PNG of the given size. */
function makePng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 255)]);
  const idat = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

async function upload(ctx, cookie, path, name, bytes, type = 'application/pdf') {
  const res = await fetch(`${ctx.base}${path}?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': type }, body: bytes });
  return { status: res.status, data: await res.json() };
}

describe('placeholders in uploaded templates', () => {
  let ctx, cookie, api, bdApi;
  before(async () => {
    ctx = await startApp();
    const a = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
    cookie = (await login(ctx.base, a.email, a.password)).cookie;
    api = client(ctx.base, cookie);
    const bd = await addUser(ctx.db, { name: 'Bhavana BD', email: 'bd@sloka.test', role: 'bd_associate', password: 'bd-password-123' });
    bdApi = client(ctx.base, (await login(ctx.base, bd.email, bd.password)).cookie);
  });
  after(() => ctx.close());

  test('field suggestions understand the usual ways of naming a placeholder', () => {
    for (const [name, field] of [
      ['Student Name', 'student_name'], ['NAME', 'student_name'], ['Candidate_Name', 'student_name'], ['Course', 'course_domain'],
      ['Date of Joining', 'internship_start_date'], ['Ref No', 'offer_letter_id'], ['offer_letter_id', 'offer_letter_id'], ['Name of College', 'college_name'],
      ['Favourite colour', null],
    ]) {
      assert.equal(suggestField(name, OFFER_FIELDS), field, name);
    }
  });

  test('a certificate design: placeholders found, mapped to details, printed in their place', async () => {
    const bytes = await makePdf([
      ['{{Participant Name}}', 330, 320, 30],
      ['for attending [Session Title] on <<Event Date>>', 200, 260, 14],
      ['Certificate No: {{cert_no}}   {{Signature of Director}}', 60, 50, 9],
    ]);
    const r = await upload(ctx, cookie, '/api/templates', 'Placeholder design', bytes);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.placeholdersFound, 5);
    const t = r.data.template;
    assert.deepEqual(
      t.layout.placeholders.map((m) => [m.text, m.field, m.align, m.fit]),
      [
        ['{{Participant Name}}', 'name', 'center', false], // alone on its line, in the middle: centred, may grow
        ['[Session Title]', 'sessionTitle', 'left', true], // inside a sentence: keeps to its own width
        ['<<Event Date>>', 'sessionDate', 'left', true],
        ['{{cert_no}}', 'certificateId', 'left', true],
        ['{{Signature of Director}}', null, 'left', true], // no detail by that name: left as it is until mapped
      ],
    );
    assert.ok(Object.values(t.layout.fields).every((f) => !f.show), 'nothing else is printed');
    const [lone, inSentence] = t.layout.placeholders;
    assert.equal(lone.line, null);
    assert.equal(inSentence.line.text, 'for attending [Session Title] on <<Event Date>>', 'a placeholder in a sentence has its whole line set again');
    assert.equal(lone.cover, '#ffffff', 'the cover is the colour around the placeholder');
    assert.equal(lone.font, 'helvetica');

    // The editor's mapping is validated; the student name must be printed somewhere.
    const unmapped = t.layout.placeholders.map((m) => ({ ...m, field: m.field === 'name' ? null : m.field }));
    assert.match((await api.patch(`/api/templates/${t.id}`, { layout: { ...t.layout, placeholders: unmapped } })).data.fields['name.show'], /map a placeholder/);
    const bad = t.layout.placeholders.map((m, i) => (i === 0 ? { ...m, field: 'nonsense' } : m));
    assert.ok((await api.patch(`/api/templates/${t.id}`, { layout: { ...t.layout, placeholders: bad } })).data.fields['placeholders.0.field']);
    const rescan = await api.post(`/api/templates/${t.id}/placeholders`);
    assert.equal(rescan.data.searched, true);
    assert.equal(rescan.data.placeholders.length, 5);

    // Issue a certificate on it: the details replace the placeholders.
    await api.put('/api/templates/default', { id: t.id });
    const s = (await api.post('/api/sessions', { title: 'Careers in VLSI', sessionDate: localDate(), mode: 'online' })).data.session;
    const reg = await fetch(`${ctx.base}/api/public/certificate-registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ sessionId: s.id, code: s.code, name: 'Asha Kumar', email: 'asha@example.com', phone: '9876543210', college: 'JNTU', consent: true, ...referral() }),
    }).then((x) => x.json());
    const pdf = await fetch(`${ctx.base}/api/certificates/${(await ctx.db.get('SELECT id FROM certificate_registrations')).id}/pdf`, { headers: { Cookie: cookie } });
    const text = await pdfText(Buffer.from(await pdf.arrayBuffer()));
    for (const v of ['Asha Kumar', 'Careers in VLSI', reg.certificate.id]) assert.ok(text.includes(v), v);
  });

  test('images have no text layer: nothing to find, the default positions apply', async () => {
    const r = await upload(ctx, cookie, '/api/templates', 'Image design', makePng(700, 500), 'image/png');
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.placeholdersFound, 0);
    assert.equal(r.data.template.layout.fields.name.show, true);
    assert.deepEqual((await api.post(`/api/templates/${r.data.template.id}/placeholders`)).data, { placeholders: [], searched: false });
  });

  test('offer letter templates: built-in by default; text-only and uploaded templates; inactive until activated', async () => {
    const list = (await api.get('/api/offer-templates')).data;
    assert.equal(list.builtInIsDefault, true);
    assert.match(list.builtIn.body, /\*\*unpaid internship\*\*/);
    assert.deepEqual(list.fields.map((f) => f.placeholder).slice(0, 3), ['{{student_name}}', '{{student_id}}', '{{course_domain}}']);
    assert.equal((await bdApi.get('/api/offer-templates')).status, 403);

    const bad = await api.post('/api/offer-templates/text', { name: 'Typo', body: 'Dear {{studnt_name}},' });
    assert.match(bad.data.fields.body, /Unknown placeholder \{\{studnt_name\}\}/);
    assert.match((await api.post('/api/offer-templates/text', { name: 'Hindi', body: 'नमस्ते {{student_name}}' })).data.fields.body, /English letters/);
    const text = await api.post('/api/offer-templates/text', { name: 'Short letter', body: 'Dear {{student_name}},\n\nWelcome to **{{course_domain}}**.' });
    assert.equal(text.status, 201);
    assert.equal(text.data.template.active, false);
    assert.equal(text.data.template.fileType, null);

    // A complete letter as a PDF, with its own placeholders: no letter text of ours ("document mode").
    const bytes = await makePdf([
      ['OFFER LETTER   Ref: <<Ref No>>   Date: <<Offer Date>>', 60, 760, 11],
      ['Dear {{Candidate Name}},', 60, 700, 12],
      ['You are offered an internship in [Course] starting [Start Date].', 60, 680, 12],
    ], [595.28, 841.89]);
    const up = await upload(ctx, cookie, '/api/offer-templates', 'Branded letter', bytes);
    assert.equal(up.status, 201, JSON.stringify(up.data));
    assert.equal(up.data.placeholdersFound, 5);
    const doc = up.data.template;
    assert.equal(doc.body, '');
    assert.deepEqual(doc.layout.placeholders.map((m) => m.field), ['offer_letter_id', 'offer_date', 'student_name', 'course_domain', 'internship_start_date']);

    // Preview with sample data (stamped PREVIEW) before activating.
    const preview = await fetch(`${ctx.base}/api/offer-templates/preview`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: doc.id }) });
    assert.equal(preview.status, 200);
    const previewText = await pdfText(Buffer.from(await preview.arrayBuffer()));
    for (const v of ['Priya Sharma', 'Data Science', 'PREVIEW']) assert.ok(previewText.includes(v), v);

    // Unmapping the student name from a document with no text is refused.
    const noName = doc.layout.placeholders.map((m) => ({ ...m, field: m.field === 'student_name' ? null : m.field }));
    assert.match((await api.patch(`/api/offer-templates/${doc.id}`, { layout: { ...doc.layout, placeholders: noName } })).data.fields.body, /map a placeholder of the document to the student name/);

    const on = await api.patch(`/api/offer-templates/${doc.id}`, { active: true });
    assert.equal(on.data.template.active, true);
    ctx.docTemplate = doc;
    ctx.textTemplate = text.data.template;
  });

  test('which template a letter uses: the course own, else the default, else built-in; the signatory is set once', async () => {
    const courses = (await api.get('/api/courses')).data.courses;
    const ds = courses.find((c) => c.name === 'Data Science');
    const aws = courses.find((c) => c.name === 'AWS');
    assert.match((await api.patch(`/api/courses/${ds.id}`, { offerTemplateId: ctx.textTemplate.id })).data.fields.offerTemplateId, /active/, 'inactive templates cannot be assigned');
    assert.equal((await api.patch(`/api/courses/${ds.id}`, { offerTemplateId: ctx.docTemplate.id })).status, 200);
    assert.match((await api.patch(`/api/offer-templates/${ctx.docTemplate.id}`, { active: false })).data.fields.active, /Course domains use this template/);
    await api.patch(`/api/offer-templates/${ctx.textTemplate.id}`, { active: true });
    assert.equal((await api.put('/api/offer-templates/default', { id: ctx.textTemplate.id })).status, 200);
    assert.equal((await api.put('/api/offer-templates/signatory', { name: 'Dr. Ravi Kumar', designation: 'Director' })).status, 200);

    const reg = async (courseId, phone, email) => {
      const r = await api.post('/api/registrations', {
        student: { name: 'Meena Iyer', phone, email, college: 'Osmania University' },
        enrollment: { courseId, batchStartDate: localDate(), fee: 10000, tokenAmount: 10000, paymentMode: 'cash' },
      });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      return r.data.registration;
    };
    const a = await reg(ds.id, '9000044444', 'meena1@example.com');
    const b = await reg(aws.id, '9000055555', 'meena2@example.com');
    const letterText = async (id) => pdfText(Buffer.from(await (await fetch(`${ctx.base}/api/registrations/${id}/offer-letter/pdf`, { headers: { Cookie: cookie } })).arrayBuffer()));

    const docText = await letterText(a.id);
    assert.ok(docText.includes('Meena Iyer') && docText.includes('Data Science') && docText.includes(a.offerLetter.offerLetterId), 'the course template, placeholders filled in');
    const defText = await letterText(b.id);
    assert.ok(defText.includes('Welcome to') && defText.includes('AWS'), 'the default template');
    assert.equal((await api.get(`/api/registrations/${b.id}/offer-letter`)).data.offerLetter.template.name, 'Short letter');

    // Back to the built-in letterhead for new letters: the regenerated letter follows, with the signatory.
    await api.put('/api/offer-templates/default', { id: null });
    await api.post(`/api/registrations/${b.id}/offer-letter/generate`);
    const builtIn = await letterText(b.id);
    for (const v of ['Offer of Internship', 'unpaid internship', 'Dr. Ravi Kumar', 'Director', 'Slifax Private Limited']) assert.ok(builtIn.includes(v), v);

    // Templates in use cannot be deleted; template changes are logged.
    assert.equal((await api.del(`/api/offer-templates/${ctx.docTemplate.id}`)).status, 409, "a course and a letter use it");
    const log = (await api.get('/api/audit?entity=offer_template')).data.items.map((i) => i.action);
    for (const action of ['upload', 'create', 'activate', 'set_default']) assert.ok(log.includes(action), action);
  });
});
