'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, addUser, login, client } = require('./helpers');
const { localDate } = require('../src/util');

const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
};

// A Manager whose role is set to "Team records": everyone who reports to them (directly or not) is their team.
describe('team data scope: registrations, enquiries, students, associate filters and insights', () => {
  let ctx, apis, ids, courseId;

  before(async () => {
    ctx = await startApp();
    const people = {
      boss: { name: 'Sita Super', role: 'super_admin' },
      mgr: { name: 'Manoj Manager', role: 'manager' },
      asha: { name: 'Asha Associate', role: 'bd_associate' },
      bala: { name: 'Bala Associate', role: 'bd_associate' },
      chitra: { name: 'Chitra Associate', role: 'bd_associate' }, // another team
    };
    apis = {};
    ids = {};
    for (const [key, p] of Object.entries(people)) ids[key] = (await addUser(ctx.db, { ...p, email: `${key}@sloka.test`, password: `${key}-password-123` })).id;
    // Asha reports to Manoj; Bala reports to Asha (so to Manoj too); Chitra to nobody.
    await ctx.db.run('UPDATE users SET reporting_manager_id = ? WHERE id = ?', [ids.mgr, ids.asha]);
    await ctx.db.run('UPDATE users SET reporting_manager_id = ? WHERE id = ?', [ids.asha, ids.bala]);
    for (const key of Object.keys(people)) apis[key] = client(ctx.base, (await login(ctx.base, `${key}@sloka.test`, `${key}-password-123`)).cookie);

    // The Manager role: Team records, and it may see registrations.
    const role = (await apis.boss.get('/api/roles')).data.roles.find((r) => r.key === 'manager');
    const changed = await apis.boss.patch('/api/roles/manager', { scope: 'team', permissions: [...role.permissions, 'registrations.view', 'registrations.export', 'students.edit'] });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));

    courseId = (await apis.boss.get('/api/courses')).data.courses.find((c) => c.name === 'Data Science').id;
    const register = async (name, phone, bd, fee, token) => {
      const r = await apis.boss.post('/api/registrations', {
        student: { name, phone, email: `${phone}@example.com`, college: 'JNTU' },
        enrollment: { courseId, batchStartDate: day(10), fee, tokenAmount: token, paymentMode: 'upi', balanceDueDate: fee > token ? day(20) : '', bdAssociateId: ids[bd] },
      });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      return r.data.registration;
    };
    ctx.regs = {
      asha: await register('Reg Asha', '9100000001', 'asha', 10000, 4000),
      bala: await register('Reg Bala', '9100000002', 'bala', 8000, 8000),
      chitra: await register('Reg Chitra', '9100000003', 'chitra', 12000, 3000),
    };
    const enquiry = async (name, phone, assignedTo) => {
      const r = await apis.boss.post('/api/inquiries', { source: 'phone-call', name, phone, consent: true, assignedTo: assignedTo ? ids[assignedTo] : null });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      return r.data.inquiry;
    };
    ctx.enq = {
      asha: await enquiry('Enq Asha', '9200000001', 'asha'),
      chitra: await enquiry('Enq Chitra', '9200000002', 'chitra'),
      open: await enquiry('Enq Unassigned', '9200000003', null),
    };
  });
  after(() => ctx.close());

  test('the associate list marks who is in the team; filters and pickers offer only them', async () => {
    const staff = (await apis.mgr.get('/api/staff')).data;
    assert.equal(staff.scope, 'team');
    const inScope = staff.staff.filter((s) => s.inScope).map((s) => s.name).sort();
    assert.deepEqual(inScope, ['Asha Associate', 'Bala Associate', 'Manoj Manager'], 'directly and indirectly reporting, and themselves');
    assert.ok((await apis.boss.get('/api/staff')).data.staff.every((s) => s.inScope), 'All records: everyone');
    assert.deepEqual((await apis.chitra.get('/api/staff')).data.staff.filter((s) => s.inScope).map((s) => s.name), ['Chitra Associate'], 'Own records: themselves');
  });

  test("registrations and their insights: only the team's, whatever the filters ask for", async () => {
    const names = async (q = '') => (await apis.mgr.get(`/api/registrations?${q}`)).data.items.map((e) => e.student.name).sort();
    assert.deepEqual(await names(), ['Reg Asha', 'Reg Bala']);
    assert.deepEqual(await names(`bdAssociateId=${ids.chitra}`), [], 'asking for someone outside the team gives nothing');
    assert.equal((await apis.mgr.get(`/api/registrations/${ctx.regs.chitra.id}`)).status, 404);
    const ins = (await apis.mgr.get('/api/registrations/insights')).data;
    assert.equal(ins.insights.registrations, 2);
    assert.equal(ins.insights.committed, 18000);
    assert.equal(ins.insights.collected, 12000);
    assert.equal(ins.insights.fullyPaid, 1);
    assert.equal(ins.insights.awaitingOfferLetter, 1, 'fully paid, no offer letter yet');
    assert.deepEqual(ins.insights.byAssociate.map((r) => [r.associate.name, r.registrations, r.collected]), [['Bala Associate', 1, 8000], ['Asha Associate', 1, 4000]]);
    const one = (await apis.mgr.get(`/api/registrations/insights?bdAssociateId=${ids.asha}`)).data.insights;
    assert.deepEqual([one.registrations, one.collected, one.outstanding], [1, 4000, 6000], "one associate's performance");
    assert.equal((await apis.mgr.get(`/api/registrations/insights?bdAssociateId=${ids.chitra}`)).data.insights.registrations, 0);
    const all = (await apis.boss.get('/api/registrations/insights')).data.insights;
    assert.equal(all.registrations, 3);
    assert.equal((await apis.mgr.get('/api/stats')).data.registrations.total, 2, 'the overview too');
    const csv = (await apis.mgr.get('/api/registrations/export')).data;
    assert.match(csv, /Reg Bala/);
    assert.doesNotMatch(csv, /Reg Chitra/);
  });

  test("enquiries: the team's and unassigned ones; assigning only within the team", async () => {
    const names = async () => (await apis.mgr.get('/api/inquiries')).data.items.map((i) => i.name).sort();
    assert.deepEqual(await names(), ['Enq Asha', 'Enq Unassigned']);
    assert.equal((await apis.mgr.get(`/api/inquiries/${ctx.enq.chitra.id}`)).status, 404);
    assert.equal((await apis.mgr.patch(`/api/inquiries/${ctx.enq.chitra.id}`, { status: 'contacted' })).status, 404);
    assert.equal((await apis.mgr.post(`/api/inquiries/${ctx.enq.chitra.id}/notes`, { body: 'Called' })).status, 404);
    const away = await apis.mgr.patch(`/api/inquiries/${ctx.enq.open.id}`, { assignedTo: ids.chitra });
    assert.equal(away.status, 400, 'not to someone outside the team');
    assert.ok(away.data.fields.assignedTo);
    const mine = await apis.mgr.patch(`/api/inquiries/${ctx.enq.open.id}`, { assignedTo: ids.bala });
    assert.equal(mine.status, 200, JSON.stringify(mine.data));
    assert.deepEqual(await names(), ['Enq Asha', 'Enq Unassigned'], 'still visible: assigned within the team');
    const stats = (await apis.mgr.get('/api/stats')).data;
    assert.equal(stats.total, 2, 'pipeline numbers within the scope');
    assert.equal((await apis.boss.get('/api/stats')).data.total, 3);
    assert.deepEqual((await apis.chitra.get('/api/inquiries')).data.items.map((i) => i.name), ['Enq Chitra'], 'own records');
  });

  test("students: those with the team's registrations or enquiries", async () => {
    const names = async () => (await apis.mgr.get('/api/students')).data.items.map((s) => s.name).sort();
    assert.deepEqual(await names(), ['Enq Asha', 'Enq Unassigned', 'Reg Asha', 'Reg Bala']);
    const chitras = (await apis.boss.get('/api/students?q=Chitra')).data.items;
    assert.equal(chitras.length, 2);
    for (const s of chitras) {
      assert.equal((await apis.mgr.get(`/api/students/${s.id}`)).status, 404);
      assert.equal((await apis.mgr.patch(`/api/students/${s.id}`, { name: 'Renamed', phone: '9300000000' })).status, 404);
    }
    assert.equal((await apis.mgr.get('/api/stats')).data.students, 4);
    assert.equal((await apis.boss.get('/api/stats')).data.students, 6);
  });
});
