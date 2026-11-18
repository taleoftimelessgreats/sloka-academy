'use strict';

const express = require('express');
const { parseWebAppUrl, isTestDeploymentUrl } = require('../sheets');
const { validationError } = require('../util');

/** Integrations (Google Sheet connection and sync, email status): settings.view; connecting the sheet: settings.edit. */
function settingsRouter({ config, sheetSync, delivery, auth, audit }) {
  const router = express.Router();
  const editor = auth.requirePermission('settings.edit');

  const status = async () => ({
    googleSheet: await sheetSync.status(),
    email: {
      enabled: delivery.enabled(),
      from: delivery.enabled() ? config.notifyFrom : null,
      dailyLimit: config.emailDailyLimit, // emails per recipient per day, of every kind
    },
  });

  const requireSheet = async () => {
    if (!(await sheetSync.status()).configured) throw validationError({ url: 'Connect a sheet first: save its web app URL.' });
  };

  router.get('/', async (req, res) => {
    res.json(await status());
  });

  // The Apps Script for the sheet. It holds the secret that lets the portal add rows, so only those who
  // may connect the sheet see it.
  router.get('/google-sheet/script', editor, async (req, res) => {
    res.json({ script: await sheetSync.script() });
  });

  // Save (or clear) the Apps Script web app that registrations are sent to. A new sheet receives every
  // registration, so choosing it is like exporting student data.
  router.put('/google-sheet', editor, async (req, res) => {
    const raw = req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '';
    if (raw.length > 500) throw validationError({ url: 'That link is too long.' });
    const url = raw ? parseWebAppUrl(raw) : '';
    if (url === null) {
      throw validationError({
        url: isTestDeploymentUrl(raw)
          ? 'That is the test URL (ending in /dev). Use the Web app URL ending in /exec from Deploy → Manage deployments.'
          : 'Paste the Web app URL from Apps Script (Deploy → Manage deployments), like https://script.google.com/macros/s/…/exec',
      });
    }
    await sheetSync.setWebApp(url, req.user.id);
    await audit.log({ actorId: req.user.id, entity: 'settings', entityId: 'google_sheet', action: url ? 'connect' : 'disconnect', summary: url ? 'Connected the Google Sheet' : 'Disconnected the Google Sheet' });
    let check = null;
    if (url) {
      try {
        check = { ok: true, title: (await sheetSync.test()).title };
        sheetSync.schedule(0);
      } catch (err) {
        check = { ok: false, message: err.message };
      }
    }
    res.json({ ...(await status()), check });
  });

  router.post('/google-sheet/test', async (req, res) => {
    await requireSheet();
    try {
      const { title } = await sheetSync.test();
      res.json({ ok: true, title });
    } catch (err) {
      res.json({ ok: false, message: err.message });
    }
  });

  router.post('/google-sheet/sync', async (req, res) => {
    await requireSheet();
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
