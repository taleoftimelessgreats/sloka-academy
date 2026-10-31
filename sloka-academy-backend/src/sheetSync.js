'use strict';

const C = require('./constants');
const { REG_SELECT } = require('./certificateRepo');
const { nationalPhone } = require('./csv');
const { localDateTime } = require('./util');
const { newSecret, appsScript, createSheetsClient } = require('./sheets');

const TAB = 'Career Guidance Registrations';
const HEADER = [
  'Submitted at', 'Certificate ID', 'Name on certificate', 'Email', 'Phone', 'College', 'Stream', 'Year of study',
  'Session', 'Session date', 'Venue', 'Mode', 'Student ID',
];
const KEY = HEADER.indexOf('Certificate ID'); // the script skips rows whose key is already in the tab

const REFERRAL_TAB = 'Referrals';
const REFERRAL_HEADER = [
  'Referred at', "Friend's name", "Friend's phone", "Friend's college", 'Referred by', "Referrer's phone",
  "Referrer's college", 'Certificate ID', 'Session', 'Enquiry ID',
];
const REFERRAL_KEY = REFERRAL_HEADER.indexOf('Enquiry ID');
const BATCH = 500;

const cells = (values) => values.map((v) => (v == null ? '' : String(v)));

const toRow = (r) =>
  cells([
    localDateTime(r.created_at),
    r.certificate_id,
    r.name,
    r.email,
    nationalPhone(r.phone),
    r.college,
    C.label('stream', r.stream),
    C.label('yearOfStudy', r.year_of_study),
    r.session_title,
    r.session_date,
    r.session_venue || '',
    r.session_mode === 'online' ? 'Online' : 'In person',
    r.student_code || '',
  ]);

const toReferralRow = (f) =>
  cells([
    localDateTime(f.created_at),
    f.name,
    nationalPhone(f.phone),
    f.college,
    f.referrer_name,
    nationalPhone(f.referrer_phone),
    f.referrer_college,
    f.certificate_id,
    f.session_title,
    f.id,
  ]);

function createSettings(db) {
  /** Save several settings at once: { key: value, ... } (null clears a value). */
  async function setMany(values, userId = null) {
    const t = new Date().toISOString();
    const rows = Object.entries(values).map(([key, value]) => [key, value ?? null, userId, t]);
    if (!rows.length) return;
    await db.run(
      `INSERT INTO settings (\`key\`, value, updated_by, updated_at) VALUES ?
      ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      [rows],
    );
  }
  const get = async (key) => (await db.get('SELECT value FROM settings WHERE `key` = ?', [key]))?.value ?? null;
  return {
    get,
    /** Every setting as { key: value }. */
    all: async () => Object.fromEntries((await db.all('SELECT `key`, value FROM settings')).map((r) => [r.key, r.value])),
    set: (key, value, userId = null) => setMany({ [key]: value }, userId),
    setMany,
    /** The setting's value, first storing `make()` if it has none (the first writer wins). */
    async getOrCreate(key, make) {
      await db.run('INSERT IGNORE INTO settings (`key`, value, updated_by, updated_at) VALUES (?, ?, NULL, ?)', [key, make(), new Date().toISOString()]);
      return get(key);
    },
  };
}

/**
 * Copies every career-guidance registration to the Google Sheet connected in the dashboard (one row each in
 * the "Career Guidance Registrations" tab, and one row per referred friend in "Referrals"). The sheet runs
 * the Apps Script from `script()`; the server only needs its web app URL. Rows that fail are retried.
 */
function createSheetSync({ db, config, settings, logger = console, fetchImpl, clientFactory = createSheetsClient, background = null }) {
  const pendingRows = (spreadsheetId) =>
    db.all(
      `${REG_SELECT}
      WHERE NOT EXISTS (SELECT 1 FROM sheet_sync ss WHERE ss.registration_id = r.id AND ss.spreadsheet_id = ?)
      ORDER BY r.id LIMIT ?`,
      [spreadsheetId, BATCH],
    );
  const pendingCount = async (spreadsheetId) =>
    (
      await db.get(
        `SELECT COUNT(*) AS n FROM certificate_registrations r
        WHERE NOT EXISTS (SELECT 1 FROM sheet_sync ss WHERE ss.registration_id = r.id AND ss.spreadsheet_id = ?)`,
        [spreadsheetId],
      )
    ).n;
  const referralRows = (regIds) =>
    db.all(
      `SELECT i.id, i.name, i.phone, i.college, i.created_at, r.name AS referrer_name, r.phone AS referrer_phone,
        r.college AS referrer_college, r.certificate_id, s.title AS session_title
      FROM inquiries i
      JOIN certificate_registrations r ON r.id = i.referred_by
      JOIN sessions s ON s.id = r.session_id
      WHERE i.referred_by IN (?) ORDER BY i.id`,
      [regIds],
    );

  let running = null;
  let timer = null;
  let timerDue = 0;
  let releaseTimer = null; // settles the background promise of the pending timer when it is replaced or stopped
  let interval = null;
  let pausedUntil = 0; // after a permanent error (e.g. wrong secret), background retries slow down

  const secret = () => settings.getOrCreate('sheet_secret', newSecret);

  /** The client for the saved web app, or null when no sheet is connected. */
  async function connection() {
    const url = await settings.get('sheet_webapp_url');
    return url ? clientFactory(url, await secret(), fetchImpl ? { fetchImpl } : undefined) : null;
  }

  // The script reports which spreadsheet it belongs to; rows are tracked per spreadsheet, so moving the
  // script to another sheet copies everything there, and re-connecting the same sheet sends nothing twice.
  async function remember(book) {
    await settings.setMany({ google_sheet_id: book.spreadsheetId, google_sheet_url: book.url, sheet_title: book.title || null });
  }

  async function run() {
    const client = await connection();
    if (!client) return { synced: 0, skipped: true };
    let synced = 0;
    try {
      const book = await client.describe();
      await remember(book);
      const id = book.spreadsheetId;
      for (;;) {
        const rows = await pendingRows(id);
        if (!rows.length) break;
        const friends = await referralRows(rows.map((r) => r.id));
        await client.append([
          { name: TAB, header: HEADER, key: KEY, rows: rows.map(toRow) },
          { name: REFERRAL_TAB, header: REFERRAL_HEADER, key: REFERRAL_KEY, rows: friends.map(toReferralRow) },
        ]);
        const t = new Date().toISOString();
        await db.run('INSERT INTO sheet_sync (registration_id, spreadsheet_id, synced_at) VALUES ? ON DUPLICATE KEY UPDATE synced_at = synced_at', [
          rows.map((r) => [r.id, id, t]),
        ]);
        synced += rows.length;
        if (rows.length < BATCH) break;
      }
      await settings.setMany({ sheet_last_sync_at: new Date().toISOString(), sheet_last_error: null });
      pausedUntil = 0;
      return { synced };
    } catch (err) {
      await settings.setMany({ sheet_last_error: err.message, sheet_last_error_at: new Date().toISOString() }).catch((e) => {
        logger.error(`[sheets] could not record the error: ${e.message}`);
      });
      if (!err.transient) pausedUntil = Date.now() + 10 * 60 * 1000;
      logger.error(`[sheets] sync failed: ${err.message}`);
      throw Object.assign(new Error(err.message), { status: err.status });
    }
  }

  /** Sync now (joins a sync already in progress). Rejects with a staff-readable message. */
  function syncNow() {
    if (!running) running = run().finally(() => (running = null));
    return running;
  }

  /**
   * Sync within delayMs, batching bursts of registrations into one call. A sync already scheduled for
   * sooner stands; one scheduled for later is brought forward. Does nothing while no sheet is connected.
   */
  function schedule(delayMs = 1500) {
    const due = Date.now() + delayMs;
    if (timer && timerDue <= due) return;
    clearTimeout(timer);
    releaseTimer?.();
    timerDue = due;
    const fired = new Promise((resolve) => {
      releaseTimer = resolve;
      timer = setTimeout(() => {
        timer = null;
        releaseTimer = null;
        syncNow()
          .catch(() => {})
          .finally(resolve);
      }, delayMs);
    });
    timer.unref?.();
    background?.(fired);
  }

  return {
    TAB,
    HEADER,
    REFERRAL_TAB,
    REFERRAL_HEADER,
    syncNow,
    schedule,
    /** The Apps Script to paste into the sheet (contains the shared secret: only for admins). */
    script: async () => appsScript(await secret()),
    /** Check that the connected web app answers. Resolves to { title }. */
    async test() {
      const client = await connection();
      if (!client) throw new Error('Connect a sheet first.');
      const book = await client.describe();
      await remember(book);
      return { title: book.title };
    },
    /** Save (or clear, with '') the web app URL. */
    async setWebApp(url, userId) {
      const values = { sheet_webapp_url: url || null, sheet_last_error: null };
      if (!url) Object.assign(values, { google_sheet_id: null, google_sheet_url: null, sheet_title: null });
      await settings.setMany(values, userId);
      pausedUntil = 0;
    },
    async status() {
      const s = await settings.all();
      const configured = Boolean(s.sheet_webapp_url);
      const id = configured ? (s.google_sheet_id ?? null) : null;
      return {
        configured,
        webAppUrl: s.sheet_webapp_url ?? null,
        tab: TAB,
        referralTab: REFERRAL_TAB,
        sheetTitle: id ? (s.sheet_title ?? null) : null,
        sheetUrl: id ? (s.google_sheet_url ?? null) : null,
        sheetId: id,
        pending: id ? await pendingCount(id) : null,
        lastSyncAt: configured ? (s.sheet_last_sync_at ?? null) : null,
        lastError: configured ? (s.sheet_last_error ?? null) : null,
        lastErrorAt: configured ? (s.sheet_last_error_at ?? null) : null,
        running: Boolean(running),
      };
    },
    start() {
      if (interval) return;
      interval = setInterval(async () => {
        try {
          if (Date.now() < pausedUntil) return;
          const s = await settings.all();
          if (!s.sheet_webapp_url) return;
          if (!s.google_sheet_id || (await pendingCount(s.google_sheet_id)) > 0) syncNow().catch(() => {});
        } catch (err) {
          logger.error(`[sheets] background check failed: ${err.message}`);
        }
      }, config.sheetSyncIntervalMs);
      interval.unref?.();
      schedule(2000);
    },
    stop() {
      clearInterval(interval);
      clearTimeout(timer);
      releaseTimer?.();
      interval = null;
      timer = null;
      releaseTimer = null;
    },
    idle: () => (running ? running.catch(() => {}) : Promise.resolve()),
  };
}

module.exports = { createSheetSync, createSettings, toRow, toReferralRow, HEADER, TAB, REFERRAL_HEADER, REFERRAL_TAB };
