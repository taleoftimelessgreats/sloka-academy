'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { startApp, addUser, login, client, referral, ALLOWED_ORIGIN } = require('./helpers');
const { validateLayout, DEFAULT_LAYOUT } = require('../src/certificateTemplates');
const { localDate } = require('../src/util');

const LOGO = fs.readFileSync(path.join(__dirname, '..', 'assets', 'certificate-logo.png'));
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// A one-page design with some artwork on it (an empty page cannot be used as a background).
async function pdfOfSize(w, h) {
  const doc = await PDFDocument.create();
  doc.addPage([w, h]).drawRectangle({ x: 20, y: 20, width: w - 40, height: h - 40, borderWidth: 2 });
  return Buffer.from(await doc.save());
}

async function pageSize(buf) {
  const doc = await PDFDocument.load(buf);
  const { width, height } = doc.getPage(0).getSize();
  return [Math.round(width), Math.round(height)];
}

describe('certificate templates', () => {
  let ctx;
  let cookie;
  let counsellorApi;
  let api;
  before(async () => {
    ctx = await startApp({ studentEmail: true });
    const admin = await addUser(ctx.db, { name: 'Anita Admin', email: 'admin@sloka.test', role: 'admin', password: 'admin-password-123' });
    const c = await addUser(ctx.db, { name: 'Kiran C', email: 'kiran@sloka.test', password: 'kiran-password-123' });
    cookie = (await login(ctx.base, admin.email, admin.password)).cookie;
    api = client(ctx.base, cookie);
    counsellorApi = client(ctx.base, (await login(ctx.base, c.email, c.password)).cookie);
  });
  after(() => ctx.close());

  const upload = (name, body, type, as = cookie) =>
    fetch(`${ctx.base}/api/templates?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': type, Cookie: as }, body }).then(
      async (r) => ({ status: r.status, data: await r.json() }),
    );

  test('layout validation: defaults pass, bad values are reported per field', () => {
    assert.deepEqual(validateLayout(DEFAULT_LAYOUT).errors, {});
    const bad = structuredClone(DEFAULT_LAYOUT);
    bad.fields.name.x = 140;
    bad.fields.sessionTitle.color = 'red';
    bad.fields.certificateId.prefix = 'ID अ';
    const { errors } = validateLayout(bad);
    assert.ok(errors['name.x'] && errors['sessionTitle.color'] && errors['certificateId.prefix'], JSON.stringify(errors));
    const hidden = structuredClone(DEFAULT_LAYOUT);
    hidden.fields.name.show = false;
    assert.ok(validateLayout(hidden).errors['name.show']);
  });

  test('upload: PDF and PNG accepted (page size from the file); junk, tiny images and counsellors refused', async () => {
    const pdf = await upload('A4 landscape', await pdfOfSize(842, 595), 'application/pdf');
    assert.equal(pdf.status, 201, JSON.stringify(pdf.data));
    assert.equal(pdf.data.template.fileType, 'pdf');
    assert.equal(Math.round(pdf.data.template.pageWidth), 842);
    assert.equal(pdf.data.template.isDefault, false);

    const png = await upload('Logo artwork', LOGO, 'image/png');
    assert.equal(png.status, 201, JSON.stringify(png.data));
    assert.equal(png.data.template.fileType, 'png');

    const tooSmall = await upload('Tiny', TINY_PNG, 'image/png');
    assert.equal(tooSmall.status, 400);
    assert.match(tooSmall.data.fields.file, /too small/);

    const blank = await PDFDocument.create();
    blank.addPage([842, 595]);
    const empty = await upload('Blank', Buffer.from(await blank.save()), 'application/pdf');
    assert.equal(empty.status, 400);
    assert.match(empty.data.fields.file, /could not be used/);

    const junk = await upload('Junk', Buffer.from('%PDF-1.7 not really a pdf'), 'application/pdf');
    assert.equal(junk.status, 400);
    assert.match(junk.data.fields.file, /could not be read/);

    const fake = await upload('Fake', Buffer.from('hello world, not an image'), 'image/png');
    assert.equal(fake.status, 400);

    const noName = await upload('', await pdfOfSize(842, 595), 'application/pdf');
    assert.equal(noName.status, 400);
    assert.ok(noName.data.fields.name);

    const wrongType = await fetch(`${ctx.base}/api/templates?name=x`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: cookie }, body: 'x' });
    assert.equal(wrongType.status, 400);

    const counsellor = await counsellorApi.get('/api/templates');
    assert.equal(counsellor.status, 200, 'staff can list designs (session form)');
    const counsellorUpload = await fetch(`${ctx.base}/api/templates?name=x`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', Cookie: (await login(ctx.base, 'kiran@sloka.test', 'kiran-password-123')).cookie },
      body: await pdfOfSize(842, 595),
    });
    assert.equal(counsellorUpload.status, 403);
  });

  test('oversized uploads are refused with 413', async () => {
    const big = Buffer.alloc(ctx.config.templateMaxBytes + 1, 0x20);
    big.write('%PDF-1.7');
    const r = await upload('Huge', big, 'application/pdf');
    assert.equal(r.status, 413);
  });

  test('preview renders a sample on the template with an unsaved layout', async () => {
    const { data } = await api.get('/api/templates');
    const t = data.templates.find((x) => x.name === 'A4 landscape');
    const layout = structuredClone(t.layout);
    layout.fields.college.show = true;
    const res = await fetch(`${ctx.base}/api/templates/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ templateId: t.id, layout }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(await pageSize(buf), [842, 595]);
    const builtIn = await fetch(`${ctx.base}/api/templates/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' });
    assert.equal(builtIn.status, 200);
  });

  test('default template is used for new certificates; a session can choose its own; issued ones keep theirs', async () => {
    const portrait = await upload('Portrait', await pdfOfSize(595, 842), 'application/pdf');
    const { data } = await api.get('/api/templates');
    const landscape = data.templates.find((x) => x.name === 'A4 landscape');
    assert.equal(data.builtInIsDefault, true);

    const setDefault = await api.patch('/api/templates/0', {});
    assert.equal(setDefault.status, 404);
    const d = await client(ctx.base, cookie).post('/api/templates/default', { id: landscape.id });
    assert.equal(d.status, 404, 'PUT, not POST');
    const put = await fetch(`${ctx.base}/api/templates/default`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ id: landscape.id }),
    });
    assert.equal(put.status, 200);

    const day = localDate();
    const plain = (await api.post('/api/sessions', { title: 'Default design session', sessionDate: day, mode: 'online' })).data.session;
    const custom = (await api.post('/api/sessions', { title: 'Portrait session', sessionDate: day, mode: 'online', templateId: portrait.data.template.id })).data.session;
    assert.equal(custom.templateId, portrait.data.template.id);

    const reg = async (s, email) => {
      const r = await fetch(`${ctx.base}/api/public/certificate-registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
        body: JSON.stringify({ sessionId: s.id, code: s.code, name: 'Asha Kumar', email, phone: '9876543210', college: 'JNTU Hyderabad', consent: true, ...referral() }),
      });
      return (await r.json()).certificate;
    };
    const c1 = await reg(plain, 'asha1@example.com');
    const c2 = await reg(custom, 'asha2@example.com');
    await ctx.settle();
    assert.deepEqual(await pageSize(ctx.emails.find((m) => m.certificateId === c1.id).pdf), [842, 595]);
    assert.deepEqual(await pageSize(ctx.emails.find((m) => m.certificateId === c2.id).pdf), [595, 842]);

    // Switch the default back to the built-in design: already-issued certificates keep their template.
    await fetch(`${ctx.base}/api/templates/default`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{"id":null}' });
    const again = await fetch(`${ctx.base}${c1.downloadPath}`);
    assert.deepEqual(await pageSize(Buffer.from(await again.arrayBuffer())), [842, 595]);

    // Templates in use cannot be deleted, only archived; archived ones cannot be picked for a session.
    const del = await api.del(`/api/templates/${landscape.id}`);
    assert.equal(del.status, 409);
    assert.equal((await api.patch(`/api/templates/${landscape.id}`, { archived: true })).data.template.archived, true);
    const pick = await api.post('/api/sessions', { title: 'Another session', sessionDate: day, mode: 'online', templateId: landscape.id });
    assert.equal(pick.status, 400);
    assert.ok(pick.data.fields.templateId);
  });

  test('saving a layout validates it; unused templates can be deleted', async () => {
    const t = (await upload('Spare', await pdfOfSize(842, 595), 'application/pdf')).data.template;
    const layout = structuredClone(t.layout);
    layout.fields.name.size = 999;
    const bad = await api.patch(`/api/templates/${t.id}`, { layout });
    assert.equal(bad.status, 400);
    assert.ok(bad.data.fields['name.size']);
    layout.fields.name.size = 40;
    const ok = await api.patch(`/api/templates/${t.id}`, { layout, name: 'Spare v2' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.template.layout.fields.name.size, 40);
    assert.equal(ok.data.template.name, 'Spare v2');
    assert.equal((await api.del(`/api/templates/${t.id}`)).status, 204);
  });
});
