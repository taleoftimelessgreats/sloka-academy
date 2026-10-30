'use strict';

const C = require('./constants');
const { REG_SELECT } = require('./certificateRepo');
const { nationalPhone } = require('./csv');
const { localDateTime } = require('./util');
const { loadServiceAccount, createSheetsClient, parseSheetUrl } = require('./sheets');

const TAB = 'Career Guidance Registrations';
const HEADER = [
  'Submitted at', 'Certificate ID', 'Name on certificate', 'Email', 'Phone', 'College', 'Stream', 'Year of study',
  'Session', 'Session date', 'Venue', 'Mode', 'Student ID',
];
const BATCH = 500;

const toRow = (r) =>
  [
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
  ].map((v) => (v == null ? '' : String(v)));

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
  return {
    get: async (key) => (await db.get('SELECT value FROM settings WHERE `key` = ?', [key]))?.value ?? null,
    /** Every setting as { key: value }. */
    all: async () => Object.fromEntries((await db.all('SELECT `key`, value FROM settings')).map((r) => [r.key, r.value])),
    set: (key, value, userId = null) => setMany({ [key]: value }, userId),
    setMany,
  };
}

/**
 * Copies every career-guidance registration to the Google Sheet configured in the dashboard
 * (one row each, appended to the "Career Guidance Registrations" tab). Rows that fail are retried.
 */
function createSheetSync({ db, config, settings, logger = console, fetchImpl, clientFactory = createSheetsClient }) {
  let sa = null;
  let keyError = null;
  try {
    sa = loadServiceAccount(config);
  } catch (err) {
    keyError = err.message;
    logger.error(`[sheets] ${err.message}`);
  }
  const client = sa ? clientFactory(sa, fetchImpl ? { fetchImpl } : undefined) : null;

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

  let running = null;
  let timer = null;
  let timerDue = 0;
  let interval = null;
  let pausedUntil = 0; // after a permanent error (e.g. sheet not shared), background retries slow down

  const sheetId = () => settings.get('google_sheet_id');

  function explain(err) {
    if (err.status === 403) return `The sheet isn't shared with ${sa.clientEmail}. In Google Sheets, click Share and add that address as an Editor.`;
    if (err.status === 404) return 'Google could not find this spreadsheet. Check the link.';
    return err.message;
  }

  async function run() {
    const id = await sheetId();
    if (!id || !client) return { synced: 0, skipped: true };
    let synced = 0;
    try {
      await client.ensureTab(id, TAB, HEADER);
      for (;;) {
        const rows = await pendingRows(id);
        if (!rows.length) break;
        await client.append(id, TAB, rows.map(toRow));
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
      const message = explain(err);
      await settings.setMany({ sheet_last_error: message, sheet_last_error_at: new Date().toISOString() }).catch((e) => {
        logger.error(`[sheets] could not record the error: ${e.message}`);
      });
      if (!err.transient) pausedUntil = Date.now() + 10 * 60 * 1000;
      logger.error(`[sheets] sync failed: ${message}`);
      throw Object.assign(new Error(message), { status: err.status });
    }
  }

  /** Sync now (joins a sync already in progress). Rejects with a staff-readable message. */
  function syncNow() {
    if (!running) running = run().finally(() => (running = null));
    return running;
  }

  /**
   * Sync within delayMs, batching bursts of registrations into one call. A sync already scheduled for
   * sooner stands; one scheduled for later is brought forward. Does nothing until a sheet is chosen.
   */
  function schedule(delayMs = 1500) {
    if (!client) return;
    const due = Date.now() + delayMs;
    if (timer && timerDue <= due) return;
    clearTimeout(timer);
    timerDue = due;
    timer = setTimeout(() => {
      timer = null;
      syncNow().catch(() => {});
    }, delayMs);
    timer.unref?.();
  }

  return {
    TAB,
    HEADER,
    configured: () => Boolean(client),
    serviceAccountEmail: () => (sa ? sa.clientEmail : null),
    syncNow,
    schedule,
    /** Check that the sheet can be opened with the service account. Resolves to { title }. */
    async test(spreadsheetId) {
      if (!client) throw new Error(keyError || 'Google Sheets is not connected on the server (no service-account key).');
      try {
        const { title } = await client.describe(spreadsheetId);
        return { title };
      } catch (err) {
        throw new Error(explain(err));
      }
    },
    /** Save (or clear, with '') the sheet link. Resolves to the spreadsheet id or null. */
    async setSheet(url, userId) {
      const id = url ? parseSheetUrl(url) : null;
      await settings.setMany({ google_sheet_url: url || null, google_sheet_id: id, sheet_last_error: null }, userId);
      pausedUntil = 0;
      return id;
    },
    async status() {
      const s = await settings.all();
      const id = s.google_sheet_id ?? null;
      return {
        connected: Boolean(client),
        keyError,
        serviceAccountEmail: sa ? sa.clientEmail : null,
        tab: TAB,
        sheetUrl: s.google_sheet_url ?? null,
        sheetId: id,
        pending: id ? await pendingCount(id) : null,
        lastSyncAt: s.sheet_last_sync_at ?? null,
        lastError: s.sheet_last_error ?? null,
        lastErrorAt: s.sheet_last_error_at ?? null,
        running: Boolean(running),
      };
    },
    start() {
      if (interval || !client) return;
      interval = setInterval(async () => {
        try {
          const id = await sheetId();
          if (id && Date.now() >= pausedUntil && (await pendingCount(id)) > 0) syncNow().catch(() => {});
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
      interval = null;
      timer = null;
    },
    idle: () => (running ? running.catch(() => {}) : Promise.resolve()),
  };
}

module.exports = { createSheetSync, createSettings, toRow, HEADER, TAB };
