'use strict';

const express = require('express');
const { can } = require('../constants');
const { HttpError, validationError } = require('../util');

function parseId(raw) {
  if (!/^\d{1,12}$/.test(String(raw))) throw new HttpError(404, { error: 'not_found' });
  return Number(raw);
}

// Who may settle a verification: keeping the profile as it is, or giving the person a profile of their
// own, is managing records; accepting the submitted details changes a student profile (admins).
const PERMISSION = { link: 'manage', new_profile: 'manage', update: 'editRecords' };

/** Staff: registrations and enquiries waiting for profile verification. */
function verificationsRouter({ verifications }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'open';
    if (!['open', 'closed', 'all'].includes(status)) throw validationError({ status: 'Invalid value.' });
    res.json({ verifications: await verifications.list({ status }) });
  });

  router.get('/:id', async (req, res) => {
    const v = await verifications.get(parseId(req.params.id));
    if (!v) throw new HttpError(404, { error: 'not_found' });
    res.json({ verification: v });
  });

  // { action: 'link' | 'update' | 'new_profile' }
  router.post('/:id/resolve', async (req, res) => {
    const id = parseId(req.params.id);
    const action = req.body && req.body.action;
    if (!Object.hasOwn(PERMISSION, action)) throw validationError({ action: 'Choose link, update or new_profile.' });
    if (!can(req.user.role, PERMISSION[action])) throw new HttpError(403, { error: 'forbidden' });
    const v = await verifications.resolve(id, action, req.user.id);
    if (!v) {
      if (!(await verifications.get(id))) throw new HttpError(404, { error: 'not_found' });
      return res.status(409).json({ error: 'closed', message: 'This has already been verified or settled.' });
    }
    console.log(`[audit] profile verification #${id} settled (${action}) by user #${req.user.id}`);
    return res.json({ verification: v });
  });

  return router;
}

module.exports = { verificationsRouter };
