'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, validInquiry, postPublic, ALLOWED_ORIGIN } = require('./helpers');

describe('POST /api/public/inquiries', () => {
  let ctx;
  before(async () => {
    ctx = await startApp();
  });
  after(() => ctx.close());

  const rows = () => ctx.db.all('SELECT * FROM inquiries ORDER BY id');

  test('valid submission returns 201 {ok:true}, stores normalised data and notifies', async () => {
    const before = (await rows()).length;
    const res = await postPublic(ctx.base, validInquiry({ unknownKey: 'ignored', website: '' }));
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.equal(res.headers.get('access-control-allow-credentials'), null);

    const all = (await rows());
    assert.equal(all.length, before + 1);
    const r = all.at(-1);
    assert.equal(r.name, 'Asha Kumar');
    assert.equal(r.phone, '+919876543210');
    assert.equal(r.email, 'asha.kumar@example.com');
    assert.equal(r.college, 'JNTU Hyderabad');
    assert.equal(r.stream, 'electronics');
    assert.equal(r.year_of_study, 'year-3');
    assert.equal(r.domain, 'VLSI');
    assert.equal(r.plan, 'premium');
    assert.equal(r.source, 'pre-register');
    assert.equal(r.status, 'new');
    assert.equal(r.brochure, null, 'brochure only stored for brochure source');
    assert.ok(!Number.isNaN(Date.parse(r.consent_at)), 'consent timestamp stored');
    assert.equal(r.created_by, null);

    const n = ctx.notifications.at(-1);
    assert.equal(n.name, 'Asha Kumar');
    assert.equal(n.source, 'pre-register');
  });

  test('does not store IP addresses or user agents', async () => {
    const cols = (await ctx.db.all('SHOW COLUMNS FROM inquiries')).map((c) => c.Field);
    for (const c of cols) assert.doesNotMatch(c, /ip|agent/i);
  });

  test('phone normalisation variants', async () => {
    for (const [input, stored] of [
      ['919876543211', '+919876543211'],
      ['09876543212', '+919876543212'],
      ['(+91) 98765-43213', '+919876543213'],
      ['6000000000', '+916000000000'],
    ]) {
      const res = await postPublic(ctx.base, validInquiry({ phone: input }));
      assert.equal(res.status, 201, input);
      assert.equal((await rows()).at(-1).phone, stored);
    }
  });

  test('brochure source stores brochure path; empty optional strings stored as null', async () => {
    const res = await postPublic(ctx.base, {
      source: 'brochure',
      name: 'Ravi',
      phone: '7000000001',
      email: 'ravi@example.in',
      brochure: '/brochures/vlsi.pdf',
      college: '',
      stream: '',
      yearOfStudy: '',
      domain: '',
      plan: '',
      message: '',
      consent: true,
    });
    assert.equal(res.status, 201);
    const r = (await rows()).at(-1);
    assert.equal(r.brochure, '/brochures/vlsi.pdf');
    for (const k of ['college', 'stream', 'year_of_study', 'domain', 'plan', 'message']) assert.equal(r[k], null, k);
  });

  const invalidCases = [
    ['source', { source: undefined }],
    ['source', { source: 'phone-call' }],
    ['source', { source: 'newsletter' }],
    ['name', { name: undefined }],
    ['name', { name: ' A ' }],
    ['name', { name: 'x'.repeat(101) }],
    ['name', { name: 42 }],
    ['phone', { phone: undefined }],
    ['phone', { phone: '12345' }],
    ['phone', { phone: '5876543210' }],
    ['phone', { phone: '98765432101' }],
    ['phone', { phone: '449876543210' }],
    ['email', { email: undefined }],
    ['email', { email: 'not-an-email' }],
    ['email', { email: 'a@b' }],
    ['email', { email: `${'a'.repeat(64)}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.com` }],
    ['college', { college: 'c'.repeat(151) }],
    ['stream', { stream: 'astrology' }],
    ['yearOfStudy', { yearOfStudy: 'year-6' }],
    ['domain', { domain: 'd'.repeat(81) }],
    ['plan', { plan: 'gold' }],
    ['brochure', { source: 'brochure', brochure: 'b'.repeat(201) }],
    ['message', { message: 'm'.repeat(2001) }],
    ['consent', { consent: undefined }],
    ['consent', { consent: false }],
    ['consent', { consent: 'true' }],
  ];

  for (const [field, patch] of invalidCases) {
    test(`validation: ${field} = ${JSON.stringify(patch[field])?.slice(0, 40)}`, async () => {
      const count = (await rows()).length;
      const notified = ctx.notifications.length;
      const res = await postPublic(ctx.base, validInquiry(patch));
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'validation');
      assert.equal(typeof body.fields[field], 'string', `expected error for ${field}, got ${JSON.stringify(body.fields)}`);
      assert.ok(body.fields[field].length > 0);
      assert.equal((await rows()).length, count, 'nothing stored');
      assert.equal(ctx.notifications.length, notified, 'no notification');
    });
  }

  test('boundary lengths are accepted', async () => {
    const res = await postPublic(
      ctx.base,
      validInquiry({ name: 'Al', college: 'c'.repeat(150), domain: 'd'.repeat(80), message: 'm'.repeat(2000) }),
    );
    assert.equal(res.status, 201);
  });

  test('empty body reports all required fields', async () => {
    const res = await postPublic(ctx.base, {});
    assert.equal(res.status, 400);
    const { fields } = await res.json();
    assert.deepEqual(Object.keys(fields).sort(), ['consent', 'email', 'name', 'phone', 'source']);
  });

  test('honeypot: 201 but nothing stored and no notification', async () => {
    const count = (await rows()).length;
    const notified = ctx.notifications.length;
    const res = await postPublic(ctx.base, validInquiry({ website: 'http://spam.example' }));
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal((await rows()).length, count);
    assert.equal(ctx.notifications.length, notified);
  });

  test('honeypot wins even when the rest is invalid', async () => {
    const count = (await rows()).length;
    const res = await postPublic(ctx.base, { website: 'x' });
    assert.equal(res.status, 201);
    assert.equal((await rows()).length, count);
  });

  test('non-JSON content type returns 415', async () => {
    const res = await fetch(`${ctx.base}/api/public/inquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ALLOWED_ORIGIN },
      body: 'name=Asha',
    });
    assert.equal(res.status, 415);
    const res2 = await fetch(`${ctx.base}/api/public/inquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(validInquiry()),
    });
    assert.equal(res2.status, 415);
  });

  test('malformed JSON returns 400, oversized body returns 413', async () => {
    const bad = await postPublic(ctx.base, '{"name": ');
    assert.equal(bad.status, 400);
    assert.equal(bad.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    const big = await postPublic(ctx.base, validInquiry({ padding: 'x'.repeat(11 * 1024) }));
    assert.equal(big.status, 413);
  });

  test('CORS preflight from an allowed origin', async () => {
    const res = await fetch(`${ctx.base}/api/public/inquiries`, {
      method: 'OPTIONS',
      headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.match(res.headers.get('access-control-allow-methods'), /POST/);
    assert.match(res.headers.get('access-control-allow-headers'), /Content-Type/i);
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
    assert.match(res.headers.get('vary') || '', /Origin/);
  });

  test('disallowed origin gets no Access-Control-Allow-Origin header', async () => {
    const pre = await fetch(`${ctx.base}/api/public/inquiries`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
    assert.equal(pre.headers.get('access-control-allow-methods'), null);

    const count = (await rows()).length;
    const res = await postPublic(ctx.base, validInquiry(), { Origin: 'https://evil.example' });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(res.status, 403);
    assert.equal((await rows()).length, count);
  });

  test('a page served by the API host itself is accepted without being allow-listed', async () => {
    const count = (await rows()).length;
    const res = await postPublic(ctx.base, validInquiry(), { Origin: ctx.base });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal((await rows()).length, count + 1);
  });

  test('response never contains the record id', async () => {
    const res = await postPublic(ctx.base, validInquiry());
    const text = await res.text();
    assert.equal(text, '{"ok":true}');
  });
});

describe('public rate limit', () => {
  let ctx;
  before(async () => {
    ctx = await startApp({ config: { publicRateLimit: { max: 5, windowMs: 10 * 60 * 1000 } } });
  });
  after(() => ctx.close());

  test('5 submissions per IP per 10 minutes, then 429', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await postPublic(ctx.base, validInquiry({ phone: `900000000${i}` }));
      assert.equal(res.status, 201, `submission ${i + 1}`);
    }
    const res = await postPublic(ctx.base, validInquiry());
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { error: 'rate_limited' });
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN, 'browser can read the 429');
    assert.ok(Number(res.headers.get('retry-after')) > 0);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM inquiries')).n, 5);
  });
});
