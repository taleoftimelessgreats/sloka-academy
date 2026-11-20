'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { startApp, addUser, login, client, referral, ALLOWED_ORIGIN } = require('./helpers');
const { suggestField } = require('../src/placeholders');
const { OFFER_FIELDS } = require('../src/offerLetters');
const { localDate } = require('../src/util');
const PDFLib = require('pdf-lib');

const { PDFDocument, StandardFonts } = PDFLib;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Enough of an Office file (a ZIP naming its main part) to be recognised. */
const fakeOffice = (part) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from(`[Content_Types].xml ${part} `), Buffer.alloc(200)]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * A PDF made the way the portal converts a Word or PowerPoint file (public/admin/convert/convert.js): the page as a
 * picture (here: a cream page with the text drawn in its colours), and each line of text laid invisibly over it, in
 * a standard font squeezed to the width it has in the picture. lines: [text, x, baseline y, size, colour, bold].
 */
async function convertedPdf(lines, [W, H] = [595.28, 841.89]) {
  const { createCanvas } = require('@napi-rs/canvas');
  const k = 3;
  const canvas = createCanvas(Math.round(W * k), Math.round(H * k));
  const g = canvas.getContext('2d');
  g.fillStyle = '#f5efe0';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const widths = [];
  for (const [text, x, y, size, colour, bold] of lines) {
    g.font = `${bold ? 'bold ' : ''}${size * k}px serif`;
    g.fillStyle = colour;
    g.fillText(text, x * k, (H - y) * k);
    widths.push(g.measureText(text).width / k);
  }
  const doc = await PDFLib.PDFDocument.create();
  const page = doc.addPage([W, H]);
  page.drawImage(await doc.embedJpg(await canvas.encode('jpeg', 90)), { x: 0, y: 0, width: W, height: H });
  for (const [i, [text, x, y, size, , bold]] of lines.entries()) {
    const font = await doc.embedFont(bold ? PDFLib.StandardFonts.TimesRomanBold : PDFLib.StandardFonts.TimesRoman);
    const key = page.node.newFontDictionary(font.name, font.ref);
    page.pushOperators(
      PDFLib.pushGraphicsState(), PDFLib.beginText(), PDFLib.setFontAndSize(key, size), PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.Invisible),
      PDFLib.setCharacterSqueeze((100 * widths[i]) / font.widthOfTextAtSize(text, size)), PDFLib.setTextMatrix(1, 0, 0, 1, x, y),
      PDFLib.showText(font.encodeText(text)), PDFLib.endText(), PDFLib.popGraphicsState(),
    );
  }
  return Buffer.from(await doc.save());
}

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
  const res = await fetch(`${ctx.base}${path}${path.includes('?') ? '&' : '?'}name=${encodeURIComponent(name)}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': type }, body: bytes });
  return { status: res.status, data: await res.json() };
}

describe('placeholders in uploaded templates', () => {
  let ctx, cookie, api, bdApi, superApi;
  before(async () => {
    ctx = await startApp();
    const a = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
    cookie = (await login(ctx.base, a.email, a.password)).cookie;
    api = client(ctx.base, cookie);
    await addUser(ctx.db, { name: 'Sam Super', email: 'super@sloka.test', role: 'super_admin', password: 'super-password-123' });
    superApi = client(ctx.base, (await login(ctx.base, 'super@sloka.test', 'super-password-123')).cookie);
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

    // Until someone confirms what each placeholder is, the design cannot be used.
    assert.equal(t.layout.placeholdersConfirmed, false);
    assert.match((await api.put('/api/templates/default', { id: t.id })).data.fields.id, /Map the placeholders/);
    const confirmed = await api.patch(`/api/templates/${t.id}`, { layout: { ...t.layout, placeholdersConfirmed: true } });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.template.layout.placeholdersConfirmed, true);

    // Issue a certificate on it: the details replace the placeholders.
    assert.equal((await api.put('/api/templates/default', { id: t.id })).status, 200);
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

  test('only files whose text can be searched are accepted: images and unconverted Word/PowerPoint files are refused', async () => {
    const { createCanvas } = require('@napi-rs/canvas');
    const webp = await createCanvas(1200, 850).encode('webp', 90);
    const jpeg = await createCanvas(1200, 850).encode('jpeg', 90);
    for (const path of ['/api/templates', '/api/offer-templates']) {
      for (const [bytes, type] of [[makePng(1200, 850), 'image/png'], [jpeg, 'image/jpeg'], [webp, 'image/webp']]) {
        const r = await upload(ctx, cookie, path, 'Image', bytes, type);
        assert.equal(r.status, 400, `${path} ${type}`);
        assert.match(r.data.fields.file, /Images cannot be searched for placeholders/);
      }
      // Word and PowerPoint files are converted by the portal before they are uploaded.
      const word = await upload(ctx, cookie, path, 'Word', fakeOffice('word/document.xml'), DOCX);
      assert.match(word.data.fields.file, /converted to PDF by the portal/);
      assert.match((await upload(ctx, cookie, path, 'Old', Buffer.concat([OLE, Buffer.alloc(64)]), 'application/octet-stream')).data.fields.file, /older Word or PowerPoint/);
      assert.match((await upload(ctx, cookie, path, 'Sheet', fakeOffice('xl/workbook.xml'), 'application/octet-stream')).data.fields.file, /Upload a PDF, Word \(\.docx\) or PowerPoint/);
    }
    assert.equal((await api.get('/api/templates')).data.templates.length, 1, 'nothing more was stored');
  });

  test('offer letter templates: built-in by default; text-only and uploaded templates; inactive until activated', async () => {
    const list = (await api.get('/api/offer-templates')).data;
    assert.equal(list.builtInIsDefault, true);
    assert.match(list.builtIn.body, /\*\*unpaid internship\*\*/);
    assert.doesNotMatch(list.builtIn.body, /non-refundable|exclusively for training/); // the payment policy is on invoices, not offer letters
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

    assert.equal(doc.layout.placeholdersConfirmed, false);
    assert.match((await api.patch(`/api/offer-templates/${doc.id}`, { active: true })).data.fields.active, /Map the placeholders/);
    assert.equal((await api.patch(`/api/offer-templates/${doc.id}`, { layout: { ...doc.layout, placeholdersConfirmed: true } })).status, 200);
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
    const issue = async (id) => (await api.post(`/api/registrations/${id}/offer-letter/generate`, { startDate: localDate() })).data.offerLetter;
    const letterA = await issue(a.id);
    await issue(b.id);
    const letterText = async (id) => pdfText(Buffer.from(await (await fetch(`${ctx.base}/api/registrations/${id}/offer-letter/pdf`, { headers: { Cookie: cookie } })).arrayBuffer()));

    const docText = await letterText(a.id);
    assert.ok(docText.includes('Meena Iyer') && docText.includes('Data Science') && docText.includes(letterA.offerLetterId), 'the course template, placeholders filled in');
    const defText = await letterText(b.id);
    assert.ok(defText.includes('Welcome to') && defText.includes('AWS'), 'the default template');
    assert.equal((await api.get(`/api/registrations/${b.id}/offer-letter`)).data.offerLetter.template.name, 'Short letter');

    // Back to the built-in letterhead for new letters: the regenerated letter follows, with the signatory.
    await api.put('/api/offer-templates/default', { id: null });
    await api.post(`/api/registrations/${b.id}/offer-letter/generate`, { startDate: localDate() });
    const builtIn = await letterText(b.id);
    for (const v of [
      'OFFER OF INTERNSHIP', 'unpaid internship', 'Dr. Ravi Kumar', 'Director', 'Slifax Private Limited',
      // the letterhead: official address, HR email, the reference and date, page numbers
      'Barakatpura, Hyderabad, Telangana 500027', 'hr@slokaacademy.com', 'Page 1 of 1', 'INTERNSHIP DETAILS', 'Meena Iyer',
    ]) assert.ok(builtIn.includes(v), v);
    assert.match(builtIn, /writing to\s+hr@slokaacademy\.com/, 'acceptance goes to HR');

    // The letterhead's contacts are settings; new letters show the new ones, letters already issued keep theirs.
    const bad = await api.put('/api/offer-templates/letterhead', { address: '', email: 'not-an-email', phone: 'call me' });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.data.fields).sort(), ['address', 'email', 'phone']);
    assert.match((await api.put('/api/offer-templates/letterhead', { address: 'a\nb\nc\nd\ne', email: 'hr@slokaacademy.com' })).data.fields.address, /at most 4 lines/);
    assert.equal((await bdApi.put('/api/offer-templates/letterhead', { address: 'x', email: 'a@b.co' })).status, 403);
    const saved = await api.put('/api/offer-templates/letterhead', { address: ' Plot 7, Hitec City \r\n Hyderabad 500081 ', email: 'Careers@SlokaAcademy.com', phone: '+91 40 1234 5678' });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.letterhead, { address: 'Plot 7, Hitec City\nHyderabad 500081', email: 'careers@slokaacademy.com', phone: '+91 40 1234 5678' });
    assert.deepEqual((await api.get('/api/offer-templates')).data.letterhead, saved.data.letterhead);
    const kept = await letterText(b.id);
    assert.ok(kept.includes('Barakatpura') && !kept.includes('Hitec City'), 'an issued letter keeps its letterhead');
    await api.post(`/api/registrations/${b.id}/offer-letter/generate`, { startDate: localDate() });
    const renewed = await letterText(b.id);
    for (const v of ['Plot 7, Hitec City', 'careers@slokaacademy.com', '+91 40 1234 5678']) assert.ok(renewed.includes(v), v);
    assert.match(renewed, /writing to\s+careers@slokaacademy\.com/);
    assert.ok((await api.get('/api/audit?entity=settings')).data.items.some((i) => i.summary === 'Changed the offer letter letterhead'));

    // Templates in use cannot be deleted; template changes are logged.
    assert.equal((await superApi.del(`/api/offer-templates/${ctx.docTemplate.id}`)).status, 409, "a course and a letter use it");
    const log = (await api.get('/api/audit?entity=offer_template')).data.items.map((i) => i.action);
    for (const action of ['upload', 'create', 'activate', 'set_default']) assert.ok(log.includes(action), action);
  });

  test('a Word letter converted by the portal: placeholders, their colours and the cover found in its text layer; filled in place', async () => {
    const bytes = await convertedPdf([
      ['OFFER OF INTERNSHIP', 190, 760, 20, '#b0121b', true],
      ['Ref: <<Ref No>>', 60, 720, 11, '#1b1b20', false],
      ['Date: {{Offer Date}}', 200, 720, 11, '#1b1b20', false],
      ['Dear {{Student Name}},', 60, 680, 12, '#1b1b20', false],
      ['You are offered an internship in [Course] starting {{Start Date}}.', 60, 660, 12, '#1b1b20', false],
    ]);
    const up = await upload(ctx, cookie, '/api/offer-templates?source=docx', 'Converted letter', bytes);
    assert.equal(up.status, 201, JSON.stringify(up.data));
    const t = up.data.template;
    assert.equal(t.sourceType, 'docx');
    assert.equal(t.fileType, 'pdf');
    const byText = Object.fromEntries(t.layout.placeholders.map((m) => [m.text, m]));
    assert.deepEqual(Object.keys(byText), ['<<Ref No>>', '{{Offer Date}}', '{{Student Name}}', '[Course]', '{{Start Date}}']);
    assert.equal(byText['{{Student Name}}'].field, 'student_name');
    assert.equal(byText['{{Student Name}}'].size, 12, 'the size of the text in the picture');
    assert.equal(byText['{{Student Name}}'].align, 'left', 'left-aligned text (it starts at the margin, like the lines around it)');
    assert.equal(byText['{{Student Name}}'].line.font, 'times', 'the words around it keep their font');
    assert.match(byText['{{Student Name}}'].cover, /^#f[0-9a-f]e[0-9a-f]d[0-9a-f]$/, 'covered in the cream around it');
    assert.match(byText['{{Student Name}}'].color, /^#[0-3][0-9a-f][0-3][0-9a-f][0-3][0-9a-f]$/, 'printed in the dark of the text');
    assert.ok(byText['<<Ref No>>'].line.limit < 200, 'a value stops before the next text on its line ("Date:")');
    assert.equal(t.layout.placeholdersConfirmed, false);
    assert.equal((await api.patch(`/api/offer-templates/${t.id}`, { layout: { ...t.layout, placeholdersConfirmed: true } })).status, 200);
    const preview = await fetch(`${ctx.base}/api/offer-templates/preview`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: t.id }) });
    const text = await pdfText(Buffer.from(await preview.arrayBuffer()));
    for (const v of ['Priya Sharma', 'Data Science', `SLK/OL/${new Date().getFullYear()}/0042`]) assert.ok(text.includes(v), v);
    // Only 'docx' and 'pptx' are recorded as sources.
    const plain = await upload(ctx, cookie, '/api/offer-templates?source=xlsx', 'Plain', bytes);
    assert.equal(plain.data.template.sourceType, null);
  });
});
