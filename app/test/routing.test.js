// Approval routing: amount tiers, leave/delegation, self-approval, one-person-one-step, vendor rules.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, load } from './helpers.js';

let app, routing, db;
before(async () => {
  app = await start({ processIncoming: false });
  routing = await load('services/routing.js');
  db = await load('db.js');
});
after(() => app.stop());

const vendor = (id) => db.get('SELECT * FROM vendors WHERE vendor_id = ?', id);
const route = (amount, department_id = 'D01', extra = {}) => routing.buildRoute({
  inv: { total_cad: amount, department_id, requester_user_id: extra.requester ?? null, doc_type: 'invoice' },
  vendor: vendor(extra.vendor ?? 'V007'), flags: extra.flags ?? [],
});
const preview = async (body) => {
  const r = await app.as('U002').post('/policies/preview', { vendor_id: 'V007', ...body });
  assert.equal(r.status, 200);
  return r.body.steps;
};
const roles = (steps) => steps.map((s) => s.approver_role);
const people = (steps) => steps.map((s) => s.assigned_user_id);

describe('amount tiers (P01-P04)', () => {
  for (const [amount, want] of [
    [500, ['dept_manager']],
    [10000, ['dept_manager']],
    [10000.01, ['dept_manager', 'finance_manager']],
    [50000, ['dept_manager', 'finance_manager']],
    [50000.01, ['dept_manager', 'finance_manager', 'controller_admin']],
    [250000, ['dept_manager', 'finance_manager', 'controller_admin']],
    [250000.01, ['dept_manager', 'finance_manager', 'controller_admin', 'cfo']],
  ]) {
    test(`$${amount} -> ${want.join(' > ')}`, async () => {
      const steps = await preview({ amount_cad: amount, department_id: 'D01' });
      assert.deepEqual(roles(steps), want);
      assert.deepEqual(people(steps), ['U007', 'U003', 'U002', 'U001'].slice(0, want.length));
    });
  }
  test('tier rule ids are recorded on each step', async () => {
    const steps = await preview({ amount_cad: 60000, department_id: 'D01' });
    assert.deepEqual(steps.map((s) => s.rule_id), ['P03', 'P03', 'P03']);
  });
});

describe('leave and delegation (P08)', () => {
  test('on-leave manager U012 routes to delegate U003 with on_behalf_of recorded', async () => {
    const steps = await preview({ amount_cad: 4000, department_id: 'D07' });
    assert.equal(steps.length, 1);
    assert.equal(steps[0].assigned_user_id, 'U003');
    assert.equal(steps[0].on_behalf_of_user_id, 'U012');
    assert.match(steps[0].reason, /delegate/);
    assert.match(steps[0].reason, /P08/);
  });
  test('buildRoute gives the same result', () => {
    const [s] = route(4000, 'D07');
    assert.deepEqual([s.assigned_user_id, s.on_behalf_of_user_id], ['U003', 'U012']);
  });
  test('delegate who also holds the finance step is not used twice', () => {
    const steps = route(20000, 'D07');
    assert.deepEqual(people(steps), ['U003', 'U002']);
    assert.equal(steps[0].on_behalf_of_user_id, 'U012');
    assert.equal(steps[1].on_behalf_of_user_id, null);
    assert.match(steps[1].reason, /two different people/);
  });
});

describe('self-approval (P07)', () => {
  test('requester who is the dept manager escalates to their manager', async () => {
    const steps = await preview({ amount_cad: 3000, department_id: 'D01', requester_user_id: 'U007' });
    assert.equal(steps[0].assigned_user_id, 'U001'); // U007's manager
    assert.match(steps[0].reason, /P07/);
    assert.ok(!people(steps).includes('U007'));
  });
  test('requester never appears anywhere in their own chain', () => {
    for (const [requester, dept, amounts] of [['U007', 'D01', [5000, 20000, 60000]], ['U003', 'D04', [5000, 20000, 60000]], ['U002', 'D04', [5000, 20000]]]) {
      for (const amt of amounts) {
        assert.ok(!people(route(amt, dept, { requester })).includes(requester), `${requester} in own chain at ${amt}`);
      }
    }
  });
});

describe('one person, one step', () => {
  test('no one fills two steps, for every department up to $250k', () => {
    const depts = db.all('SELECT department_id FROM departments').map((d) => d.department_id);
    for (const d of depts) {
      for (const amt of [5000, 20000, 60000, 250000]) {
        const ids = people(route(amt, d));
        assert.equal(new Set(ids).size, ids.length, `${d} $${amt}: ${ids.join(',')}`);
      }
    }
  });
  test('Finance (D04, managed by the controller) over $50k escalates the controller step to the CFO', () => {
    const steps = route(60000, 'D04');
    assert.deepEqual(people(steps), ['U002', 'U003', 'U001']);
  });
  // Known gap: when escalation runs out of eligible people, buildRoute's "controller assigned" fallback
  // reuses someone already in the chain (or the requester), so the invoice can never be fully approved.
  // Happens for D04/D07/D08 over $250k, and for a $50k+ Finance invoice requested by the controller.
  test('the fallback approver is never someone already in the chain or the requester', () => {
    for (const d of ['D04', 'D07', 'D08']) {
      const ids = people(route(300000, d));
      assert.equal(new Set(ids).size, ids.length, `${d}: ${ids.join(',')}`);
    }
    assert.ok(!people(route(60000, 'D04', { requester: 'U002' })).includes('U002'));
  });
});

describe('vendor and flag rules', () => {
  test('a Legal vendor adds the finance manager (P06)', async () => {
    assert.equal(vendor('V026').category, 'Legal');
    const steps = await preview({ amount_cad: 1000, department_id: 'D01', vendor_id: 'V026' });
    assert.deepEqual(roles(steps), ['dept_manager', 'finance_manager']);
    assert.equal(steps[1].assigned_user_id, 'U003');
    assert.equal(steps[1].rule_id, 'P06');
  });
  test('a non-Legal vendor at the same amount needs only the dept manager', async () => {
    assert.deepEqual(roles(await preview({ amount_cad: 1000, department_id: 'D01', vendor_id: 'V007' })), ['dept_manager']);
  });
  test('a pending-review vendor adds the finance manager (P05)', () => {
    const v = db.get(`SELECT vendor_id FROM vendors WHERE status = 'pending_review' LIMIT 1`);
    assert.ok(v);
    const steps = route(1000, 'D01', { vendor: v.vendor_id });
    assert.deepEqual(roles(steps), ['dept_manager', 'finance_manager']);
    assert.equal(steps[1].rule_id, 'P05');
  });
  test('a fraud-flagged invoice adds the finance manager', () => {
    const steps = route(1000, 'D01', { flags: [{ code: 'BANK_MISMATCH', category: 'fraud', severity: 'block' }] });
    assert.deepEqual(roles(steps), ['dept_manager', 'finance_manager']);
  });
});

describe('editable policies drive routing', () => {
  test('controller lowers the manager tier and routing follows; restoring puts it back', async () => {
    const admin = app.as('U002');
    assert.equal((await admin.put('/policies/P01', { min_amount_cad: 0, max_amount_cad: 5000 })).status, 200);
    assert.equal((await admin.put('/policies/P02', { min_amount_cad: 5000, max_amount_cad: 50000 })).status, 200);
    assert.deepEqual(roles(await preview({ amount_cad: 7000, department_id: 'D01' })), ['dept_manager', 'finance_manager']);
    await admin.put('/policies/P01', { min_amount_cad: 0, max_amount_cad: 10000 });
    await admin.put('/policies/P02', { min_amount_cad: 10000, max_amount_cad: 50000 });
    assert.deepEqual(roles(await preview({ amount_cad: 7000, department_id: 'D01' })), ['dept_manager']);
    const log = (await app.as('U006').get('/audit?action=policy.updated')).body.rows;
    assert.equal(log.length, 4);
  });
  test('invalid bands and chains are rejected', async () => {
    const admin = app.as('U002');
    assert.equal((await admin.put('/policies/P01', { min_amount_cad: 5000, max_amount_cad: 100 })).status, 400);
    assert.equal((await admin.put('/policies/P01', { chain: ['intern'] })).status, 400);
  });
});
