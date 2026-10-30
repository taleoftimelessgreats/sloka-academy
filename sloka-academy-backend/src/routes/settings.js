'use strict';

const express = require('express');
const { parseSheetUrl } = require('../sheets');
const { validationError } = require('../util');

/** Managers and admins: integrations (Google Sheet link and sync, email status). */
function settingsRouter({ config, sheetSync, delivery, auth }) {
  const router = express.Router();

  const status = async () => ({
    googleSheet: await sheetSync.status(),
    email: {
      enabled: delivery.enabled(),
      from: delivery.enabled() ? config.notifyFrom : null,
      dailyLimit: config.emailDailyLimit, // emails per recipient per day, of every kind
    },
  });

  router.get('/', async (req, res) => {
    res.json(await status());
  });

  // Save (or clear) the Google Sheet that registrations are copied to. A new sheet receives every
  // registration, so choosing it counts as exporting student data.
  router.put('/google-sheet', auth.requirePermission('export'), async (req, res) => {
    const raw = req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '';
    if (raw && !parseSheetUrl(raw)) {
      throw validationError({ url: 'Paste the link of a Google Sheet, like https://docs.google.com/spreadsheets/d/…/edit' });
    }
    if (raw.length > 500) throw validationError({ url: 'That link is too long.' });
    await sheetSync.setSheet(raw, req.user.id);
    let check = null;
    if (raw && sheetSync.configured()) {
      try {
        check = { ok: true, title: (await sheetSync.test(parseSheetUrl(raw))).title };
        sheetSync.schedule(0);
      } catch (err) {
        check = { ok: false, message: err.message };
      }
    }
    res.json({ ...(await status()), check });
  });

  router.post('/google-sheet/test', async (req, res) => {
    const id = (await sheetSync.status()).sheetId;
    if (!id) throw validationError({ url: 'Save a Google Sheet link first.' });
    try {
      const { title } = await sheetSync.test(id);
      res.json({ ok: true, title });
    } catch (err) {
      res.json({ ok: false, message: err.message });
    }
  });

  router.post('/google-sheet/sync', async (req, res) => {
    if (!sheetSync.configured()) return res.status(400).json({ error: 'not_connected', message: 'Google Sheets is not connected on the server.' });
    if (!(await sheetSync.status()).sheetId) throw validationError({ url: 'Save a Google Sheet link first.' });
    try {
      const { synced } = await sheetSync.syncNow();
      return res.json({ ok: true, synced, ...(await status()) });
    } catch (err) {
      return res.json({ ok: false, message: err.message, ...(await status()) });
    }
  });

  return router;
}

module.exports = { settingsRouter };
