'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, addUser, login, client } = require('./helpers');
const { localDate } = require('../src/util');
const { longDate } = require('../src/certificatePdf');

const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
};

const student = (extra = {}) => ({
  name: 'Priya Sharma',
  phone: '98765 43210',
  email: 'Priya@Example.com',
  gender: 'female',
  dateOfBirth: '2004-05-17',
  college: 'CVR College of Engineering',
  qualification: 'B.Tech',
  specialization: 'Computer Science',
  yearOfStudy: 'year-3',
  city: 'Hyderabad',
  state: 'Telangana',
  ...extra,
});

describe('internship registrations', () => {
  let ctx, apis, ids, courses;

  before(async () => {
    // Invoices are emailed after every payment: lift the daily limit per address, which these tests would reach.
    ctx = await startApp({ studentEmail: true, config: { emailDailyLimit: 100 } });
    const people = {
      admin: { name: 'Anita Admin', role: 'admin' },
      owner: { name: 'Sam Super', role: 'super_admin' },
      lead: { name: 'Lakshmi Lead', role: 'bd_manager' },
      bhavana: { name: 'Bhavana BD', role: 'bd_associate' },
      ravi: { name: 'Ravi BD', role: 'bd_associate' },
      accounts: { name: 'Arun Accounts', role: 'accounts' },
    };
    apis = {};
    ids = {};
    for (const [key, p] of Object.entries(people)) {
      const u = await addUser(ctx.db, { ...p, email: `${key}@sloka.test`, password: `${key}-password-123` });
      ids[key] = u.id;
    }
    // Bhavana reports to Lakshmi; Ravi to nobody.
    await ctx.db.run('UPDATE users SET reporting_manager_id = ? WHERE id = ?', [ids.lead, ids.bhavana]);
    for (const key of Object.keys(people)) apis[key] = client(ctx.base, (await login(ctx.base, `${key}@sloka.test`, `${key}-password-123`)).cookie);
    courses = (await apis.bhavana.get('/api/courses')).data.courses;
  });
  after(() => ctx.close());

  const courseId = (name) => courses.find((c) => c.name === name).id;
  const enrollment = (extra = {}) => ({
    courseId: courseId('Data Science'),
    fee: '14,999',
    tokenAmount: 2000,
    paymentMode: 'upi',
    transactionReference: 'UPI-REF-1',
    balanceDueDate: day(20),
    remarks: 'Negotiated a scholarship.',
    ...extra,
  });
  const register = (api, body) => api.post('/api/registrations', { student: student(), enrollment: enrollment(), ...body });

  test('the course master lists the website domains for the registration form', async () => {
    assert.ok(courses.length >= 40);
    const ds = courses.find((c) => c.name === 'Data Science');
    assert.equal(ds.duration, '2 months');
    assert.equal(ds.active, true);
    assert.equal((await apis.bhavana.post('/api/courses', { name: 'New Domain', duration: '3 months' })).status, 403);
    const made = await apis.admin.post('/api/courses', { name: 'Retired Domain', duration: '6 weeks' });
    assert.equal(made.status, 201);
    assert.equal((await apis.admin.post('/api/courses', { name: 'retired domain', duration: '6 weeks' })).status, 400, 'names are unique');
    assert.equal((await apis.admin.patch(`/api/courses/${made.data.course.id}`, { active: false })).data.course.active, false);
    courses = (await apis.bhavana.get('/api/courses')).data.courses;
  });

  test('validations: mobile and email, token > ₹0 and ≤ fee, the balance due date always and not before registration', async () => {
    const cases = [
      [{ student: student({ phone: '', email: 'nope' }) }, ['student.phone', 'student.email']],
      [{ enrollment: enrollment({ tokenAmount: 0 }) }, ['enrollment.tokenAmount']],
      [{ enrollment: enrollment({ tokenAmount: 20000 }) }, ['enrollment.tokenAmount']],
      [{ enrollment: enrollment({ balanceDueDate: '' }) }, ['enrollment.balanceDueDate']],
      [{ enrollment: enrollment({ balanceDueDate: day(-1) }) }, ['enrollment.balanceDueDate']],
      [{ enrollment: enrollment({ courseId: courseId('Retired Domain') }) }, ['enrollment.courseId']],
      [{ enrollment: enrollment({ fee: 'lots', paymentMode: 'barter' }) }, ['enrollment.fee', 'enrollment.paymentMode']],
    ];
    for (const [body, keys] of cases) {
      const r = await register(apis.bhavana, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      for (const k of keys) assert.ok(r.data.fields[k], `${k} for ${JSON.stringify(body)}: ${JSON.stringify(r.data.fields)}`);
    }
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM enrollments')).n, 0);
    // The BD always enters the balance due date, even when the fee is paid in full at registration.
    const fullPayer = { student: student({ name: 'Full Payer', phone: '9000011111', email: 'full@example.com' }) };
    const noDate = await register(apis.ravi, { ...fullPayer, enrollment: enrollment({ fee: 5000, tokenAmount: 5000, balanceDueDate: '' }) });
    assert.equal(noDate.status, 400);
    assert.equal(noDate.data.fields['enrollment.balanceDueDate'], 'Balance due date is required.');
    // No batch start date is asked for (it is entered when the offer letter is issued); one sent anyway is ignored.
    const full = await register(apis.ravi, { ...fullPayer, enrollment: enrollment({ fee: 5000, tokenAmount: 5000, balanceDueDate: day(0), batchStartDate: day(9) }) });
    assert.equal(full.status, 201, JSON.stringify(full.data));
    assert.equal(full.data.registration.paymentStatus, 'fully-paid');
    assert.equal(full.data.registration.batchStartDate, null);
    assert.equal(full.data.registration.internshipStartDate, null);
  });

  test('a new student: master record, enrollment, token payment, slot confirmed; no offer letter until fully paid', async () => {
    assert.deepEqual((await apis.bhavana.get('/api/registrations/lookup?phone=9876543210&email=priya@example.com')).data.matches, []);
    const r = await register(apis.bhavana, {});
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const reg = r.data.registration;
    assert.equal(reg.fee, 14999);
    assert.equal(reg.paid, 2000);
    assert.equal(reg.balance, 12999);
    assert.equal(reg.paymentStatus, 'slot-confirmed');
    assert.equal(reg.overdue, false);
    assert.equal(reg.registrationDate, localDate());
    assert.equal(reg.bdAssociate.name, 'Bhavana BD', 'the logged-in associate');
    assert.match(reg.student.studentCode, /^SLK-STU-\d{4}-\d{5}$/);
    assert.equal(reg.student.phone, '+919876543210');
    assert.equal(reg.student.email, 'priya@example.com');
    assert.equal(reg.offerLetter, null, 'issued once the fee is fully paid');
    // The invoice, with the registration amount, goes to the student at once.
    assert.equal(r.data.invoiceEmail, 'sent');
    assert.match(reg.invoice.invoiceNumber, new RegExp(`^SLK/INV/${new Date().getFullYear()}/\\d{4}$`));
    assert.equal(reg.invoice.status, 'sent');
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM offer_letters')).n, 0);
    const s = await ctx.db.get('SELECT * FROM students WHERE id = ?', [reg.student.id]);
    assert.equal(s.gender, 'female');
    assert.equal(s.qualification, 'B.Tech');
    assert.equal(s.city, 'Hyderabad');
    const pays = (await apis.bhavana.get(`/api/registrations/${reg.id}`)).data.payments;
    assert.deepEqual(pays.map((p) => [p.kind, p.amount, p.paymentMode, p.transactionReference]), [['token', 2000, 'upi', 'UPI-REF-1']]);
    ctx.priya = reg;
  });

  test('duplicate check: the mobile number or email finds the master record; the associate confirms or flags it', async () => {
    const m = (await apis.ravi.get('/api/registrations/lookup?phone=%2B91%2098765%2043210')).data.matches;
    assert.equal(m.length, 1);
    assert.equal(m[0].name, 'Priya Sharma');
    assert.equal(m[0].phoneMasked, '98XXXXX210', 'masked mobile');
    assert.equal(m[0].email, 'priya@example.com');
    assert.deepEqual(m[0].matchedBy, ['phone']);
    assert.deepEqual(m[0].enrollments.map((e) => e.course), ['Data Science'], 'previous enrollments');
    assert.equal(m[0].details.qualification, 'B.Tech', 'the master details the form fills in and locks');
    assert.equal(m[0].details.city, 'Hyderabad');

    // Submitting as new is refused with the match.
    const again = await register(apis.ravi, { student: student({ email: 'different@example.com' }) });
    assert.equal(again.status, 409);
    assert.equal(again.data.error, 'student_exists');
    assert.equal(again.data.matches[0].id, ctx.priya.student.id);

    // "Yes, same student": a new enrollment on the existing Student ID; master details stay as they are.
    const yes = await register(apis.ravi, {
      studentId: ctx.priya.student.id,
      student: student({ name: 'Somebody Else', college: 'Elsewhere', email: 'priya@example.com' }),
      enrollment: enrollment({ courseId: courseId('AWS'), fee: 9999, tokenAmount: 1000 }),
    });
    assert.equal(yes.status, 201, JSON.stringify(yes.data));
    assert.equal(yes.data.registration.student.id, ctx.priya.student.id);
    assert.equal(yes.data.registration.student.name, 'Priya Sharma');
    assert.equal(yes.data.registration.student.college, 'CVR College of Engineering');
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM enrollments WHERE student_id = ?', [ctx.priya.student.id])).n, 2);
    ctx.raviReg = yes.data.registration;

    // A confirmed student must actually own the mobile number or email entered.
    const wrong = await register(apis.ravi, { studentId: ctx.priya.student.id, student: student({ phone: '9111111111', email: 'x@example.com' }) });
    assert.equal(wrong.status, 400);
    assert.match(wrong.data.fields.studentId, /do not belong/);

    // "No, not the same student": blocked, and flagged for an admin.
    const flag = await apis.ravi.post('/api/registrations/flags', { name: 'Pooja S', phone: '9876543210', email: 'pooja@example.com', note: 'Student says the number is new' });
    assert.equal(flag.status, 201);
    assert.equal(flag.data.flag.matched[0].studentCode, ctx.priya.student.studentCode);
    assert.equal((await apis.ravi.get('/api/registrations/flags')).status, 403);
    const open = (await apis.admin.get('/api/registrations/flags')).data.flags;
    assert.equal(open.length, 1);
    assert.equal(open[0].raisedBy.name, 'Ravi BD');
    const done = await apis.admin.post(`/api/registrations/flags/${open[0].id}/resolve`, { note: 'Called the student; number corrected' });
    assert.equal(done.data.flag.status, 'resolved');
    assert.equal((await apis.admin.post(`/api/registrations/flags/${open[0].id}/resolve`, {})).status, 409);
  });

  test('payments: status moves Slot Confirmed -> Partially Paid -> Fully Paid; no overpaying', async () => {
    const id = ctx.priya.id;
    assert.equal((await apis.bhavana.post(`/api/registrations/${id}/payments`, { amount: 1000, paymentMode: 'cash' })).status, 403, 'BD Associates do not record later payments');
    const over = await apis.accounts.post(`/api/registrations/${id}/payments`, { amount: 13000, paymentMode: 'upi' });
    assert.equal(over.status, 400);
    assert.match(over.data.fields.amount, /₹12,999/);
    assert.match((await apis.accounts.post(`/api/registrations/${id}/payments`, { amount: 100, paymentMode: 'upi', paidOn: day(1) })).data.fields.paidOn, /future/);
    const part = await apis.accounts.post(`/api/registrations/${id}/payments`, { amount: '5,000', paymentMode: 'bank-transfer', transactionReference: 'NEFT-9', balanceDueDate: day(30) });
    assert.equal(part.status, 201, JSON.stringify(part.data));
    assert.equal(part.data.registration.paymentStatus, 'partially-paid');
    assert.equal(part.data.registration.balance, 7999);
    assert.equal(part.data.registration.balanceDueDate, day(30));
    const full = await apis.accounts.post(`/api/registrations/${id}/payments`, { amount: 7999, paymentMode: 'card' });
    assert.equal(full.data.registration.paymentStatus, 'fully-paid');
    assert.equal(full.data.registration.balance, 0);
    assert.equal(full.data.payments.length, 3);
    assert.match((await apis.accounts.post(`/api/registrations/${id}/payments`, { amount: 1, paymentMode: 'card' })).data.fields.amount, /fully paid/);

    // Corrections (logged): a later payment amount, then removing it.
    const later = full.data.payments.find((p) => p.amount === 7999);
    const fix = await apis.accounts.patch(`/api/registrations/${id}/payments/${later.id}`, { amount: 6999, paymentMode: 'card' });
    assert.equal(fix.status, 200, JSON.stringify(fix.data));
    assert.equal(fix.data.registration.paymentStatus, 'partially-paid');
    const token = full.data.payments.find((p) => p.kind === 'token');
    assert.equal((await apis.owner.del(`/api/registrations/${id}/payments/${token.id}`)).status, 400, 'the token payment stays');
    for (const who of ['accounts', 'admin']) assert.equal((await apis[who].del(`/api/registrations/${id}/payments/${later.id}`)).status, 403, 'only Super Admins delete payments');
    const removed = await apis.owner.del(`/api/registrations/${id}/payments/${later.id}`);
    assert.equal(removed.data.registration.balance, 7999);
    const log = (await apis.admin.get('/api/audit?entity=payment')).data.items;
    assert.ok(log.some((i) => i.action === 'update' && i.changes.some((c) => c.field === 'Amount (₹)' && c.from === 7999 && c.to === 6999)));
    assert.ok(log.some((i) => i.action === 'delete'));
  });

  test('fee and due date edits after submission: Accounts and Admins only, never below what was paid, logged', async () => {
    const id = ctx.priya.id;
    assert.equal((await apis.bhavana.patch(`/api/registrations/${id}`, { fee: 20000 })).status, 403);
    assert.match((await apis.accounts.patch(`/api/registrations/${id}`, { fee: 1000 })).data.fields.fee, /cannot be less/);
    assert.match((await apis.accounts.patch(`/api/registrations/${id}`, { balanceDueDate: null })).data.fields.balanceDueDate, /balance remains/);
    const r = await apis.accounts.patch(`/api/registrations/${id}`, { fee: 15999, remarks: 'Added a module' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.registration.balance, 8999);
    const entry = (await apis.admin.get(`/api/audit?entity=enrollment&entityId=${id}`)).data.items[0];
    assert.equal(entry.actor.name, 'Arun Accounts');
    assert.deepEqual(entry.changes.find((c) => c.field === 'Committed fee (₹)'), { field: 'Committed fee (₹)', from: 14999, to: 15999 });
  });

  test('data scope: own (BD Associate), team (BD Manager), all (Accounts, Admin)', async () => {
    const names = async (api) => (await api.get('/api/registrations')).data.items.map((e) => `${e.student.name}/${e.course.name}`).sort();
    assert.deepEqual(await names(apis.bhavana), ['Priya Sharma/Data Science']);
    assert.deepEqual(await names(apis.ravi), ['Full Payer/Data Science', 'Priya Sharma/AWS']);
    assert.deepEqual(await names(apis.lead), ['Priya Sharma/Data Science'], "her own and her team's");
    assert.equal((await names(apis.accounts)).length, 3);
    assert.equal((await apis.bhavana.get(`/api/registrations/${ctx.raviReg.id}`)).status, 404, 'outside the scope is not found');
    assert.equal((await apis.bhavana.get(`/api/registrations/${ctx.raviReg.id}/offer-letter/pdf`)).status, 404);
    const profile = await apis.bhavana.get(`/api/registrations/students/${ctx.priya.student.id}`);
    assert.equal(profile.status, 200);
    assert.deepEqual(profile.data.enrollments.map((e) => e.course.name), ['Data Science'], 'only the enrollments in scope');
    assert.equal(profile.data.student.gender, 'female');
    assert.equal(profile.data.enrollments[0].payments.length, 2, "token + one later payment (the other was removed)");
    assert.equal((await apis.accounts.get(`/api/registrations/students/${ctx.priya.student.id}`)).data.enrollments.length, 2);
    // Exports keep to the scope too.
    assert.equal((await apis.bhavana.get('/api/registrations/export')).status, 403, 'BD Associates do not export');
    const csv = (await apis.lead.get('/api/registrations/export')).data;
    assert.match(csv, /Priya Sharma/);
    assert.doesNotMatch(csv, /Full Payer/);
    // Registering for someone else, or reassigning, needs the edit permission.
    assert.equal((await register(apis.bhavana, { student: student({ name: 'Other', phone: '9000022222', email: 'o@example.com' }), enrollment: enrollment({ bdAssociateId: ids.ravi }) })).status, 403);
    const moved = await apis.admin.patch(`/api/registrations/${ctx.raviReg.id}`, { bdAssociateId: ids.bhavana });
    assert.equal(moved.data.registration.bdAssociate.name, 'Bhavana BD');
    assert.equal((await names(apis.bhavana)).length, 2);
  });

  test('Due This Week and Overdue views, filters and search', async () => {
    // An older registration whose balance date has passed.
    const old = await register(apis.ravi, { student: student({ name: 'Late Payer', phone: '9000033333', email: 'late@example.com' }), enrollment: enrollment({ courseId: courseId('VLSI'), balanceDueDate: day(3) }) });
    await ctx.db.run('UPDATE enrollments SET registration_date = ?, balance_due_date = ? WHERE id = ?', [day(-40), day(-2), old.data.registration.id]);
    const list = async (q) => (await apis.admin.get(`/api/registrations?${q}`)).data.items.map((e) => e.student.name);
    assert.deepEqual(await list('view=overdue'), ['Late Payer']);
    const overdue = (await apis.admin.get('/api/registrations?view=overdue')).data.items[0];
    assert.equal(overdue.overdue, true);
    assert.equal(overdue.paymentStatus, 'slot-confirmed', 'the flag is on top of the status');
    await ctx.db.run('UPDATE enrollments SET balance_due_date = ? WHERE id = ?', [day(2), ctx.raviReg.id]);
    assert.deepEqual(await list('view=due-week'), ['Priya Sharma']);
    assert.deepEqual(await list('status=overdue'), ['Late Payer']);
    assert.deepEqual((await list('status=fully-paid')).sort(), ['Full Payer']);
    assert.deepEqual(await list(`courseId=${courseId('VLSI')}`), ['Late Payer']);
    assert.deepEqual((await list(`bdAssociateId=${ids.ravi}`)).sort(), ['Full Payer', 'Late Payer']);
    assert.deepEqual(await list(`regFrom=${day(-60)}&regTo=${day(-30)}`), ['Late Payer']);
    assert.deepEqual(await list(`dueFrom=${day(1)}&dueTo=${day(3)}`), ['Priya Sharma']);
    assert.deepEqual(await list('q=33333'), ['Late Payer'], 'by mobile');
    assert.deepEqual(await list(`q=${ctx.priya.student.studentCode}`).then((l) => [...new Set(l)]), ['Priya Sharma'], 'by Student ID');
    assert.equal((await apis.admin.get('/api/registrations?status=nope')).status, 400);
    const stats = (await apis.admin.get('/api/stats')).data.registrations;
    assert.equal(stats.total, 4);
    assert.equal(stats.overdue, 1);
    assert.equal(stats.dueThisWeek, 1);
  });

  test('insights follow the filters: period, associate and both together, matching the list', async () => {
    // Now: Full Payer (Ravi, 5000/5000), Priya DS (Bhavana, 7000/15999), Priya AWS (Bhavana, 1000/9999, due in 2 days),
    // Late Payer (Ravi, registered 40 days ago, 2000/14999, overdue).
    const get = async (api, q = '') => (await api.get(`/api/registrations/insights?${q}`)).data;
    const all = await get(apis.admin);
    assert.equal(all.insights.registrations, 4);
    assert.equal(all.insights.committed, 45997);
    assert.equal(all.insights.collected, 15000);
    assert.equal(all.insights.outstanding, 30997);
    assert.deepEqual([all.insights.fullyPaid, all.insights.partiallyPaid, all.insights.slotConfirmed], [1, 1, 2]);
    assert.deepEqual([all.insights.dueThisWeek, all.insights.overdue, all.insights.overdueAmount], [1, 1, 12999]);
    assert.equal(all.insights.collectionRate, 32.6);
    assert.deepEqual(all.insights.byAssociate.map((r) => [r.associate.name, r.registrations, r.committed, r.collected]), [
      ['Bhavana BD', 2, 25998, 8000],
      ['Ravi BD', 2, 19999, 7000],
    ]);
    assert.deepEqual(all.views, { all: 4, dueThisWeek: 1, overdue: 1 });
    assert.equal(all.received, null, 'no period chosen');

    // One associate.
    const ravi = (await get(apis.admin, `bdAssociateId=${ids.ravi}`)).insights;
    assert.deepEqual([ravi.registrations, ravi.collected, ravi.overdue], [2, 7000, 1]);
    // A period: registrations made in it, and the payments received in it (whenever the student registered).
    const past = await get(apis.admin, `regFrom=${day(-60)}&regTo=${day(-30)}`);
    assert.equal(past.insights.registrations, 1);
    assert.deepEqual(past.received, { amount: 0, payments: 0, from: day(-60), to: day(-30) }, "Late Payer's token was paid today");
    const todayOnly = await get(apis.admin, `regFrom=${localDate()}&regTo=${localDate()}`);
    assert.equal(todayOnly.insights.registrations, 3);
    assert.deepEqual([todayOnly.received.amount, todayOnly.received.payments], [15000, 5], 'every payment so far was made today');
    // Both, and a view on top: the same registrations as the list.
    const q = `bdAssociateId=${ids.ravi}&regFrom=${day(-60)}&regTo=${localDate()}&view=overdue`;
    const both = await get(apis.admin, q);
    assert.equal(both.insights.registrations, (await apis.admin.get(`/api/registrations?${q}`)).data.total);
    assert.deepEqual([both.insights.registrations, both.insights.collected], [1, 2000]);
    assert.deepEqual(both.views, { all: 2, dueThisWeek: 0, overdue: 1 }, 'tab counts under the other filters');
    // A team lead: her team only, whatever she asks for.
    const lead = await get(apis.lead);
    assert.deepEqual([lead.insights.registrations, lead.insights.byAssociate.length], [2, 1]);
    assert.equal((await get(apis.lead, `bdAssociateId=${ids.ravi}`)).insights.registrations, 0);
    assert.equal((await apis.admin.get('/api/registrations/insights?regFrom=soon')).status, 400);
    // The associate list tells the portal who is in her team (for the filter).
    const staff = (await apis.lead.get('/api/staff')).data.staff;
    assert.deepEqual(staff.filter((s) => s.inScope).map((s) => s.name).sort(), ['Bhavana BD', 'Lakshmi Lead']);
  });

  test('offer letter: only once fully paid, with the internship start date entered; regenerate (same ID), email with status and log', async () => {
    const id = ctx.priya.id;
    assert.equal((await apis.bhavana.get(`/api/registrations/${id}/offer-letter`)).data.offerLetter, null);
    // A balance is due: no letter yet.
    const early = await apis.bhavana.post(`/api/registrations/${id}/offer-letter/generate`, { startDate: day(10) });
    assert.equal(early.status, 409);
    assert.equal(early.data.error, 'balance_due');
    assert.match(early.data.message, /₹8,999 is still due/);
    assert.equal((await apis.bhavana.post(`/api/registrations/${id}/offer-letter/send`, { startDate: day(10) })).status, 409);
    const paid = await apis.accounts.post(`/api/registrations/${id}/payments`, { amount: 8999, paymentMode: 'upi' });
    assert.equal(paid.data.registration.paymentStatus, 'fully-paid');

    // The internship start date: required, a real date, not before the registration.
    for (const [body, re] of [[{}, /Enter the internship start date/], [{ startDate: '2026-02-30' }, /valid date/], [{ startDate: day(-1) }, /before the registration/]]) {
      const r = await apis.bhavana.post(`/api/registrations/${id}/offer-letter/generate`, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(r.data.fields.startDate, re);
    }
    const made = await apis.bhavana.post(`/api/registrations/${id}/offer-letter/generate`, { startDate: day(10) });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const letter = made.data.offerLetter;
    assert.match(letter.offerLetterId, new RegExp(`^SLK/OL/${new Date().getFullYear()}/\\d{4}$`));
    assert.equal(letter.internshipStartDate, day(10));
    assert.equal(letter.status, 'generated');
    const stored = JSON.parse((await ctx.db.get('SELECT content FROM offer_letters WHERE enrollment_id = ?', [id])).content);
    assert.equal(stored.values.internship_start_date, longDate(day(10)), 'printed on the letter');
    const pdf = await fetch(`${ctx.base}/api/registrations/${id}/offer-letter/pdf`, { headers: { Cookie: (await login(ctx.base, 'bhavana@sloka.test', 'bhavana-password-123')).cookie } });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(pdf.headers.get('content-disposition'), /Offer-Letter-SLK-OL-\d{4}-\d{4}\.pdf/);

    // Regenerate with another date: same ID.
    const again = (await apis.bhavana.post(`/api/registrations/${id}/offer-letter/generate`, { startDate: day(12) })).data.offerLetter;
    assert.equal(again.offerLetterId, letter.offerLetterId);
    assert.equal(again.internshipStartDate, day(12));
    assert.deepEqual(again.events.map((e) => e.type), ['regenerated', 'generated']);
    assert.equal((await apis.bhavana.get(`/api/registrations/${id}`)).data.registration.internshipStartDate, day(12), "the registration shows the letter's start date");
    assert.equal((await apis.accounts.post(`/api/registrations/${id}/offer-letter/send`, { startDate: day(12) })).status, 403, 'Accounts only view letters');
    // Sending with the same date emails the letter as it is.
    const sent = (await apis.bhavana.post(`/api/registrations/${id}/offer-letter/send`, { startDate: day(12) })).data.offerLetter;
    assert.equal(sent.status, 'sent');
    assert.ok(sent.sentAt);
    assert.deepEqual(sent.events.map((e) => e.type), ['sent', 'regenerated', 'generated']);
    const mail = ctx.outbox.find((m) => m.subject.includes('offer letter'));
    assert.equal(mail.to, 'priya@example.com');
    assert.match(mail.attachments[0].filename, /^Offer-Letter-SLK-OL-/);
    assert.match(mail.text, /internship in Data Science at Sloka Academy, commencing on/);
    assert.match(mail.text, /confirm your acceptance by writing to hr@slokaacademy\.com, quoting the reference number/);
    assert.match(mail.subject, /^Your offer letter: internship in Data Science, Sloka Academy \(SLK\/OL\//);
    // Another date: the letter is regenerated, then sent.
    ctx.mail.fail = 'mailbox full';
    const failed = (await apis.bhavana.post(`/api/registrations/${id}/offer-letter/send`, { startDate: day(15) })).data.offerLetter;
    ctx.mail.fail = null;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.internshipStartDate, day(15));
    assert.match(failed.emailError, /mailbox full/);
    assert.deepEqual(failed.events.slice(0, 3).map((e) => e.type), ['failed', 'regenerated', 'sent']);

    // Fully paid at registration: the letter can be issued straight away.
    const fullPayer = (await apis.ravi.get('/api/registrations')).data.items.find((e) => e.student.name === 'Full Payer');
    assert.equal((await apis.ravi.post(`/api/registrations/${fullPayer.id}/offer-letter/generate`, { startDate: day(7) })).status, 200);
    const ins = (await apis.admin.get('/api/registrations/insights')).data.insights;
    assert.deepEqual([ins.offerLetters, ins.awaitingOfferLetter], [2, 0]);
  });

  test('invoice: emailed after every payment with the history, total paid and balance; download, resend, the payment policy', async () => {
    const id = ctx.priya.id;
    const number = ctx.priya.invoice.invoiceNumber;
    // One email at registration and one after each later payment (5,000, 7,999 and 8,999), each with the invoice.
    const mails = ctx.outbox.filter((m) => m.to === 'priya@example.com' && m.subject.includes(number));
    assert.equal(mails.length, 4);
    assert.match(mails[0].subject, /balance Rs\. 12,999\.00$/);
    assert.match(mails.at(-1).subject, /paid in full$/);
    const first = mails[0];
    assert.match(first.attachments[0].filename, /^Invoice-SLK-INV-\d{4}-\d{4}\.pdf$/);
    for (const v of ['Total amount paid: Rs. 2,000.00', 'Outstanding balance: Rs. 12,999.00 (due by', 'All payments are non-refundable.', 'Payments are collected exclusively for training purposes.', '/terms/']) {
      assert.ok(first.text.includes(v), v);
    }
    // Corrections do not email by themselves; the invoice always shows the ledger as it is now.
    const text = async (bytes) => {
      globalThis.pdfjsWorker ||= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
      const page = await (await task.promise).getPage(1);
      const out = (await page.getTextContent()).items.map((i) => i.str).join(' ');
      await task.destroy();
      return out;
    };
    const cookie = (await login(ctx.base, 'bhavana@sloka.test', 'bhavana-password-123')).cookie;
    const pdf = await fetch(`${ctx.base}/api/registrations/${id}/invoice/pdf`, { headers: { Cookie: cookie } });
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get('content-disposition'), /Invoice-SLK-INV-\d{4}-\d{4}\.pdf/);
    const printed = await text(Buffer.from(await pdf.arrayBuffer()));
    for (const v of [
      'INVOICE', number, 'Priya Sharma', 'Data Science', 'PAYMENT HISTORY', 'Registration amount', 'Rs. 2,000.00', 'Rs. 5,000.00', 'Rs. 8,999.00',
      'Rs. 15,999.00', 'PAID IN FULL', 'Rs. 0.00', 'All payments are non-refundable.', 'Payments are collected exclusively for training purposes.',
    ]) assert.ok(printed.includes(v), v);
    assert.ok(!printed.includes('7,999'), 'the payment that was removed is not on it');
    assert.equal((await apis.ravi.get(`/api/registrations/${id}/invoice/pdf`)).status, 404, 'outside the scope');
    // Sending it again, and a failure.
    const again = await apis.accounts.post(`/api/registrations/${id}/invoice/send`);
    assert.equal(again.data.invoiceEmail, 'sent');
    ctx.mail.fail = 'mailbox full';
    const failed = await apis.bhavana.post(`/api/registrations/${id}/invoice/send`);
    ctx.mail.fail = null;
    assert.equal(failed.data.invoiceEmail, 'failed');
    assert.equal(failed.data.registration.invoice.status, 'failed');
    assert.match(failed.data.registration.invoice.error, /mailbox full/);
    // A registration from before invoices gets its number when its invoice is first needed; numbers are not reused.
    const other = (await apis.ravi.get('/api/registrations')).data.items.find((e) => e.student.name === 'Full Payer');
    await ctx.db.run('UPDATE enrollments SET invoice_code = NULL WHERE id = ?', [other.id]);
    assert.equal((await apis.ravi.get(`/api/registrations/${other.id}/invoice/pdf`)).status, 200);
    const fresh = (await apis.ravi.get(`/api/registrations/${other.id}`)).data.registration.invoice.invoiceNumber;
    assert.notEqual(fresh, other.invoice.invoiceNumber);
    // The policy travels with the labels the portal loads; it is on invoices, not in the offer letter email.
    assert.deepEqual((await apis.bhavana.get('/api/meta')).data.paymentPolicy, ['All payments are non-refundable.', 'Payments are collected exclusively for training purposes.']);
    const offerMail = ctx.outbox.find((m) => m.subject.includes('offer letter')).text;
    assert.ok(!offerMail.includes('non-refundable') && !offerMail.includes('exclusively for training'));
  });

  test('registration CSV export and deletion (logged); erasing a student removes their registrations', async () => {
    const csv = (await apis.accounts.get('/api/registrations/export')).data;
    const [header, ...rows] = csv.replace(/^﻿/, '').trim().split('\r\n');
    assert.match(header, /Course domain,Internship start date,Committed fee \(INR\),Paid \(INR\),Balance \(INR\),Balance due date,Payment status,Overdue,BD Associate,Offer letter ID/);
    assert.equal(rows.length, 4);
    assert.equal((await apis.accounts.del(`/api/registrations/${ctx.raviReg.id}`)).status, 403);
    assert.equal((await apis.admin.del(`/api/registrations/${ctx.raviReg.id}`)).status, 403, 'only Super Admins delete');
    assert.equal((await apis.owner.del(`/api/registrations/${ctx.raviReg.id}`)).status, 204);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM payments WHERE enrollment_id = ?', [ctx.raviReg.id])).n, 0);
    assert.equal((await apis.owner.del(`/api/students/${ctx.priya.student.id}`)).status, 204);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM enrollments WHERE student_id = ?', [ctx.priya.student.id])).n, 0);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM offer_letters')).n, 1, "Full Payer's stays");
    const log = (await apis.admin.get('/api/audit')).data.items;
    assert.ok(log.some((i) => i.entity === 'enrollment' && i.action === 'delete'));
    assert.ok(log.some((i) => i.entity === 'student' && i.action === 'delete'));
  });
});
