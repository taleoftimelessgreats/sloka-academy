'use strict';

const express = require('express');
const { HttpError, validationError, parseId } = require('../util');

// Who may settle a verification: keeping the profile as it is, or giving the person a profile of their
// own (students.create); accepting the submitted details changes a student's master record (students.edit).
const PERMISSION = { link: 'students.create', new_profile: 'students.create', update: 'students.edit' };

/** Staff: registrations and enquiries waiting for profile verification. */
function verificationsRouter({ verifications, auth, audit }) {
  const router = express.Router();
  const view = auth.requirePermission('students.view');

  router.get('/', view, async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'open';
    if (!['open', 'closed', 'all'].includes(status)) throw validationError({ status: 'Invalid value.' });
    res.json({ verifications: await verifications.list({ status }) });
  });

  router.get('/:id', view, async (req, res) => {
    const v = await verifications.get(parseId(req.params.id));
    if (!v) throw new HttpError(404, { error: 'not_found' });
    res.json({ verification: v });
  });

  // { action: 'link' | 'update' | 'new_profile' }
  router.post('/:id/resolve', view, async (req, res) => {
    const id = parseId(req.params.id);
    const action = req.body && req.body.action;
    if (!Object.hasOwn(PERMISSION, action)) throw validationError({ action: 'Choose link, update or new_profile.' });
    if (!req.user.permissions.has(PERMISSION[action])) throw new HttpError(403, { error: 'forbidden' });
    const v = await verifications.resolve(id, action, req.user.id);
    if (!v) {
      if (!(await verifications.get(id))) throw new HttpError(404, { error: 'not_found' });
      return res.status(409).json({ error: 'closed', message: 'This has already been verified or settled.' });
    }
    const how = { link: 'kept the existing profile', update: "accepted the submitted details into the student's master record", new_profile: 'gave the person a new profile' }[action];
    await audit.log({ actorId: req.user.id, entity: 'student', entityId: v.student ? v.student.id : null, action: `verification_${action}`, summary: `Settled profile verification #${id}: ${how}` });
    return res.json({ verification: v });
  });

  return router;
}

module.exports = { verificationsRouter };
