'use strict';

const express = require('express');
const { validateCourse } = require('../validation');
const { validationError, HttpError, parseId, hasErrors } = require('../util');
const { diff } = require('../audit');
const { isDuplicate } = require('../db');

const LABELS = { name: 'Course domain', duration: 'Internship duration', active: 'Active', offerTemplateId: 'Offer letter template' };

/** The course master: course domains students register for, their internship duration and offer letter template. */
function coursesRouter({ db, auth, registrations, audit }) {
  const router = express.Router();
  const { courses } = registrations;

  async function checkTemplate(values, errors, current = null) {
    if (values.offerTemplateId == null || errors.offerTemplateId || values.offerTemplateId === current) return;
    const t = await db.get('SELECT active FROM offer_templates WHERE id = ?', [values.offerTemplateId]);
    if (!t || t.active !== 1) errors.offerTemplateId = 'Choose an active offer letter template.';
  }

  const save = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (isDuplicate(err, 'uq_courses_name')) throw validationError({ name: 'A course domain with this name already exists.' });
      throw err;
    }
  };

  // The registration form's dropdown needs the list too.
  router.get('/', auth.requireAny('courses.view', 'registrations.create', 'registrations.view'), async (req, res) => {
    res.json({ courses: await courses.list() });
  });

  router.post('/', auth.requirePermission('courses.create'), async (req, res) => {
    const { values, errors } = validateCourse(req.body);
    await checkTemplate(values, errors);
    if (hasErrors(errors)) throw validationError(errors);
    const course = await save(() => courses.create(values));
    await audit.log({ actorId: req.user.id, entity: 'course', entityId: course.id, action: 'create', summary: `Added course domain "${course.name}" (${course.duration})` });
    res.status(201).json({ course });
  });

  router.patch('/:id', auth.requirePermission('courses.edit'), async (req, res) => {
    const id = parseId(req.params.id);
    const before = await courses.get(id);
    if (!before) throw new HttpError(404, { error: 'not_found' });
    const { values, errors } = validateCourse(req.body, { partial: true });
    await checkTemplate(values, errors, before.offerTemplate ? before.offerTemplate.id : null);
    if (hasErrors(errors)) throw validationError(errors);
    const course = await save(() => courses.update(id, values));
    const changes = diff(
      { name: before.name, duration: before.duration, active: before.active, offerTemplateId: before.offerTemplate ? before.offerTemplate.name : null },
      { ...values, offerTemplateId: values.offerTemplateId === undefined ? undefined : course.offerTemplate ? course.offerTemplate.name : null },
      LABELS,
    );
    if (changes.length) await audit.log({ actorId: req.user.id, entity: 'course', entityId: id, action: 'update', summary: `Changed course domain "${course.name}"`, changes });
    res.json({ course });
  });

  return router;
}

module.exports = { coursesRouter };
