'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { loadConfig, parseDatabaseUrl, PROJECT_ROOT } = require('../src/config');
const { createUser } = require('../src/routes/users');
const { createNotifier } = require('../src/notify');
const { createEmailQuota } = require('../src/emailQuota');

const TEST_SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';
const ALLOWED_ORIGIN = 'https://www.sloka.example';
const TEST_DB_PREFIX = 'sloka_test_';

/**
 * The server tests run on: TEST_DATABASE_URL (environment or .env), else the server in .env's DATABASE_URL.
 * Each test database is new and is dropped afterwards; the database named in the URL is never touched.
 */
function testServerUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  let fromFile = {};
  try {
    fromFile = parseEnv(fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const url = fromFile.TEST_DATABASE_URL || fromFile.DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Tests need a MySQL/TiDB server: set TEST_DATABASE_URL (or DATABASE_URL in .env).');
  return url;
}

let staleDropped = false;

/** A new, migrated database. Resolves to { db, url, drop() }. */
async function openTestDatabase() {
  const server = parseDatabaseUrl(testServerUrl());
  // Name: prefix + base-36 creation time + random, so leftovers from crashed runs can be recognised.
  const name = `${TEST_DB_PREFIX}${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const db = await openDatabase({ ...server, database: name });
  if (!staleDropped) {
    staleDropped = true;
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const row of await db.all("SHOW DATABASES LIKE 'sloka\\_test\\_%'")) {
      const old = Object.values(row)[0];
      const born = parseInt(old.slice(TEST_DB_PREFIX.length).split('_')[0], 36);
      if (Number.isFinite(born) && born < cutoff) await db.run(`DROP DATABASE IF EXISTS \`${old}\``).catch(() => {});
    }
  }
  const url = `mysql://${encodeURIComponent(server.user)}:${encodeURIComponent(server.password)}@${server.host}:${server.port}/${name}${server.ssl ? '' : '?ssl=false'}`;
  return {
    db,
    url,
    drop: async () => {
      await db.run(`DROP DATABASE IF EXISTS \`${name}\``);
      await db.close();
    },
  };
}

// What the tests check in a certificate email, read back from the message the notifier built.
function certificateEmail(msg) {
  const attachment = msg.attachments[0];
  return {
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    certificateId: /Certificate-(.+)\.pdf$/.exec(attachment.filename)[1],
    pdf: attachment.content,
    downloadUrl: (/https?:\/\/\S+\/pdf\?token=\S+/.exec(msg.text) || [])[0],
    verifyUrl: (/genuine at: (\S+)/.exec(msg.text) || [])[1],
    studentId: (/Student ID: (\S+)/.exec(msg.text) || [])[1] || null,
    resent: msg.subject.includes('sent again'),
  };
}

/**
 * The app on an ephemeral port with its own database.
 * studentEmail: true sends real emails (notify.js, with the daily limit) to a fake mail server:
 *   ctx.emails = certificate emails, ctx.codes = verification codes { to, code }, ctx.outbox = every message;
 *   set ctx.mail.fail = 'reason' to make sending fail.
 * Without it, email is off.
 */
async function startApp({ config: overrides = {}, env = {}, studentEmail = false, sheetsFetch } = {}) {
  const { db, url, drop } = await openTestDatabase();
  const config = {
    ...loadConfig({ JWT_SECRET: TEST_SECRET, ALLOWED_ORIGINS: ALLOWED_ORIGIN, DATABASE_URL: url, ...env }),
    publicRateLimit: { max: 1000, windowMs: 600000 },
    ...(studentEmail ? { smtp: { host: 'smtp.sloka.test', port: 465, user: 'mailer', pass: 'secret' }, notifyFrom: 'Sloka Academy <certificates@sloka.test>' } : {}),
    ...overrides,
  };
  const notifications = [];
  const emails = [];
  const codes = [];
  const outbox = [];
  const mail = { fail: null };
  const emailQuota = createEmailQuota(db, { limit: config.emailDailyLimit });
  let notifier = { inquiryCreated: (inq) => notifications.push(inq) };
  if (studentEmail) {
    const transport = {
      sendMail: async (msg) => {
        if (mail.fail) throw new Error(mail.fail);
        outbox.push(msg);
        if (msg.attachments) emails.push(certificateEmail(msg));
        const code = /this code on the form: (\d{6})/.exec(msg.text);
        if (code) codes.push({ to: msg.to, code: code[1] });
      },
    };
    notifier = createNotifier(config, { quota: emailQuota, transport, logger: { log() {}, error() {} } });
    notifier.inquiryCreated = (inq) => notifications.push(inq);
  }
  const app = createApp({ db, config, notifier, emailQuota, sheetsFetch });
  const services = app.locals.services;
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    db,
    config,
    notifications,
    emails,
    codes,
    outbox,
    mail,
    services,
    /** Wait for background certificate emails and sheet syncs to finish. */
    settle: async () => {
      await services.delivery.idle();
      await services.sheetSync.idle();
    },
    close: async () => {
      services.sheetSync.stop();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      await services.delivery.idle();
      await services.sheetSync.idle();
      await drop();
    },
  };
}

const validInquiry = (extra = {}) => ({
  source: 'pre-register',
  name: 'Asha Kumar',
  phone: '+91 98765 43210',
  email: 'Asha.Kumar@Example.com',
  college: 'JNTU Hyderabad',
  stream: 'electronics',
  yearOfStudy: 'year-3',
  domain: 'VLSI',
  plan: 'premium',
  message: 'Interested in the next batch.',
  consent: true,
  ...extra,
});

function postPublic(base, body, headers = {}) {
  return fetch(`${base}/api/public/inquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function addUser(db, { name = 'Staff User', email, role = 'counsellor', password = 'correct-horse-battery' }) {
  const id = await createUser(db, { name, email, role, password }, 12);
  return { id, name, email, role, password };
}

async function login(base, email, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  return { res, cookie: setCookie.split(';')[0], setCookie, body: await res.json().catch(() => null) };
}

// Small client bound to a session cookie.
function client(base, cookie) {
  const call = async (method, path, body) => {
    const headers = { Cookie: cookie };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json() : await res.text();
    return { status: res.status, headers: res.headers, data };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    patch: (p, b) => call('PATCH', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
  };
}

module.exports = { startApp, openTestDatabase, validInquiry, postPublic, addUser, login, client, ALLOWED_ORIGIN, TEST_SECRET };
