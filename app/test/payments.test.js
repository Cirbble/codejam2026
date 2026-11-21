// Approval -> payment preparation -> release, with separation of duties at every hand-off.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, findNew, load } from './helpers.js';

let app, routing, policy, db;
before(async () => {
  app = await start();
  routing = await load('services/routing.js');
  policy = await load('policy.js');
  db = await load('db.js');
});
after(() => app.stop());

const detail = async (id, as = 'U004') => (await app.as(as).get(`/invoices/${id}`)).body;
const pendingStep = (d) => d.approvals.find((a) => a.action === 'pending');

// Approve every remaining step as whoever the route assigned it to.
async function approveAll(id) {
  const signers = [];
  for (let guard = 0; guard < 6; guard++) {
    const d = await detail(id);
    if (d.invoice.status !== 'pending_approval') break;
    const step = pendingStep(d);
    const r = await app.as(step.assigned_user_id).post(`/invoices/${id}/approve`, { acknowledge: true, comment: 'Checked against the lease' });
    assert.equal(r.status, 200, `step ${step.step_no} by ${step.assigned_user_id}: ${r.body.error}`);
    signers.push(step.assigned_user_id);
  }
  return signers;
}

describe('full flow: delegate approval, then release by someone who did not approve', () => {
  let inv, payment;
  before(async () => { inv = await findNew(app.as('U004'), '002935'); }); // Queen Street Properties, $18,758, D07

  test('route is delegate (for the on-leave manager) then a different finance approver', async () => {
    const d = await detail(inv.invoice_id);
    assert.equal(d.invoice.status, 'pending_approval');
    assert.deepEqual(d.flags.filter((f) => f.status === 'open' && f.severity === 'block'), []);
    assert.deepEqual(d.approvals.map((a) => [a.approver_role, a.assigned_user_id, a.on_behalf_of_user_id]), [
      ['dept_manager', 'U003', 'U012'],
      ['finance_manager', 'U002', null],
    ]);
  });

  test('nobody can jump the queue: step 2 assignee cannot sign step 1', async () => {
    const r = await app.as('U002').post(`/invoices/${inv.invoice_id}/approve`, { acknowledge: true });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /assigned to/);
  });

  test('approve all steps; the delegate approval records on_behalf_of', async () => {
    const signers = await approveAll(inv.invoice_id);
    assert.deepEqual(signers, ['U003', 'U002']);
    const d = await detail(inv.invoice_id);
    assert.equal(d.invoice.status, 'approved');
    const step1 = d.approvals.find((a) => a.step_no === 1);
    assert.equal(step1.approver_user_id, 'U003');
    assert.equal(step1.on_behalf_of_user_id, 'U012');
    const { rows } = (await app.as('U006').get(`/audit?action=invoice.approved&q=${inv.invoice_id}`)).body;
    const delegated = rows.find((r) => r.invoice_id === inv.invoice_id && r.actor_user_id === 'U003');
    assert.ok(delegated, 'audit row for the delegate approval');
    assert.equal(delegated.on_behalf_of_user_id, 'U012');
    assert.equal(delegated.details.as_delegate, true);
    assert.ok(rows.some((r) => r.invoice_id === inv.invoice_id && r.actor_user_id === 'U002' && r.on_behalf_of_user_id === null));
  });

  test('approvers cannot prepare the payment; AP clerk can', async () => {
    assert.equal((await app.as('U003').post('/payments', { invoice_id: inv.invoice_id })).status, 403);
    const r = await app.as('U004').post('/payments', { invoice_id: inv.invoice_id });
    assert.equal(r.status, 200, r.body.error);
    payment = r.body;
    assert.equal(payment.status, 'scheduled');
    assert.equal(payment.prepared_by, 'U004');
    assert.equal((await detail(inv.invoice_id)).invoice.status, 'scheduled');
    // Can't prepare a second payment for the same invoice.
    assert.equal((await app.as('U005').post('/payments', { invoice_id: inv.invoice_id })).status, 400);
  });

  test('approvers, the preparer, the on-leave manager and the auditor cannot release', async () => {
    for (const [who, why] of [['U003', /approved this invoice/], ['U002', /approved this invoice/], ['U004', /can't do this/], ['U012', /can't do this/], ['U006', /can't do this/]]) {
      const r = await app.as(who).post(`/payments/${payment.payment_id}/release`);
      assert.equal(r.status, 403, `${who} should not release`);
      assert.match(r.body.error, why);
    }
    const p = db.get('SELECT status, released_by FROM payments WHERE payment_id = ?', payment.payment_id);
    assert.deepEqual({ ...p }, { status: 'scheduled', released_by: null });
  });

  test('a different eligible releaser (CFO) succeeds', async () => {
    const r = await app.as('U001').post(`/payments/${payment.payment_id}/release`);
    assert.equal(r.status, 200, r.body.error);
    assert.equal(r.body.released_by, 'U001');
    assert.ok(['released', 'settled'].includes(r.body.status));
    assert.ok(r.body.reference);
    // Releasing twice is refused.
    assert.equal((await app.as('U001').post(`/payments/${payment.payment_id}/release`)).status, 400);
    const { rows } = (await app.as('U006').get(`/audit?q=${payment.payment_id}`)).body;
    const actions = rows.map((x) => x.action);
    assert.ok(actions.includes('payment.prepared'));
    assert.ok(actions.includes('payment.released'));
    assert.ok(actions.filter((a) => a === 'payment.release_denied').length >= 2);
  });
});

describe('warnings must be acknowledged', () => {
  test('approving with open warnings needs acknowledge:true', async () => {
    const inv = await findNew(app.as('U004'), '287'); // split-invoice warning
    const d = await detail(inv.invoice_id);
    assert.ok(d.flags.some((f) => f.code === 'SPLIT_INVOICE' && f.status === 'open'));
    const step = pendingStep(d);
    const r1 = await app.as(step.assigned_user_id).post(`/invoices/${inv.invoice_id}/approve`, {});
    assert.equal(r1.status, 409);
    assert.match(r1.body.error, /split/i);
    const r2 = await app.as(step.assigned_user_id).post(`/invoices/${inv.invoice_id}/approve`, { acknowledge: true });
    assert.equal(r2.status, 200);
    const row = (await app.as('U006').get(`/audit?action=invoice.approved&q=${inv.invoice_id}`)).body.rows.find((x) => x.invoice_id === inv.invoice_id);
    assert.ok(row.details.acknowledged.some((t) => /split/i.test(t)));
  });
  test('blocked invoices cannot be approved or paid', async () => {
    const inv = await findNew(app.as('U004'), '001468'); // duplicate, draft
    assert.equal((await app.as('U001').post(`/invoices/${inv.invoice_id}/approve`, { acknowledge: true })).status, 403);
    assert.equal((await app.as('U004').post('/payments', { invoice_id: inv.invoice_id })).status, 400);
    assert.equal((await app.as('U004').post(`/invoices/${inv.invoice_id}/submit`)).status, 400);
  });
});

describe('release limits (P09/P10)', () => {
  test('releaseRolesFor: up to $100k finance manager or controller; above, controller only', () => {
    assert.deepEqual(routing.releaseRolesFor(5000).roles.sort(), ['controller_admin', 'finance_manager']);
    assert.equal(routing.releaseRolesFor(100000).rule, 'P09');
    assert.ok(routing.releaseRolesFor(100000).roles.includes('finance_manager'));
    assert.deepEqual(routing.releaseRolesFor(100000.01).roles, ['controller_admin']);
    assert.equal(routing.releaseRolesFor(150000).rule, 'P10');
    assert.deepEqual(routing.releaseRolesFor(-150000).roles, ['controller_admin']);
  });
  test('releaseDecision: a finance manager cannot release a $150k payment; a controller can', () => {
    const user = (id) => db.get('SELECT * FROM users WHERE user_id = ?', id);
    const inv = { invoice_id: 'AP-99999', requester_user_id: 'U013' };
    const pay = { prepared_by: 'U004', amount_cad: 150000 };
    const rule = routing.releaseRolesFor(pay.amount_cad);
    const fm = policy.releaseDecision(user('U003'), pay, inv, rule);
    assert.equal(fm.ok, false);
    assert.match(fm.reason, /controller/);
    assert.equal(policy.releaseDecision(user('U002'), pay, inv, rule).ok, true);
    assert.equal(policy.releaseDecision(user('U003'), { ...pay, amount_cad: 9000 }, inv, routing.releaseRolesFor(9000)).ok, true);
    // Preparer and requester are excluded even with the right role.
    assert.equal(policy.releaseDecision(user('U002'), { ...pay, prepared_by: 'U002' }, inv, rule).ok, false);
    assert.equal(policy.releaseDecision(user('U002'), pay, { ...inv, requester_user_id: 'U002' }, rule).ok, false);
    assert.equal(policy.releaseDecision(user('U004'), pay, inv, rule).ok, false);
  });
});
