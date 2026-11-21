// Role enforcement on the server: every check hits the HTTP API directly, as a UI-less attacker would.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, findNew, load } from './helpers.js';

let app;
let pending; // a clean D01 invoice awaiting approval
let flagged; // an invoice with an open flag
before(async () => {
  app = await start();
  pending = await findNew(app.as('U004'), 'TR26-1042');
  flagged = await findNew(app.as('U004'), 'NO26-1773');
});
after(() => app.stop());

const flagIdOf = async (invoiceId) => (await app.as('U004').get(`/invoices/${invoiceId}`)).body.flags.find((f) => f.status === 'open').id;

test('unauthenticated requests are rejected', async () => {
  const r = await fetch(`${app.base}/invoices`);
  assert.equal(r.status, 401);
});

test('AP clerk cannot approve invoices or release payments', async () => {
  const clerk = app.as('U004');
  assert.equal((await clerk.post(`/invoices/${pending.invoice_id}/approve`, { acknowledge: true })).status, 403);
  assert.equal((await clerk.post('/payments/PAY-00001/release')).status, 403);
  assert.equal((await clerk.post('/payments/release-batch', { ids: ['PAY-00001'] })).status, 403);
  const after = (await clerk.get(`/invoices/${pending.invoice_id}`)).body;
  assert.equal(after.invoice.status, 'pending_approval');
  assert.ok(after.approvals.every((a) => a.action === 'pending'));
});

test('approver cannot release payments or request/approve bank changes', async () => {
  const approver = app.as('U007');
  assert.equal((await approver.post('/payments/PAY-00001/release')).status, 403);
  assert.equal((await approver.post('/payments', { invoice_id: pending.invoice_id })).status, 403);
  const bank = { institution: '001', transit: '12345', account: '1234567', request_channel: 'phone' };
  assert.equal((await approver.post('/vendors/V007/bank-changes', bank)).status, 403);
  assert.equal((await approver.post('/bank-changes/BC-001/approve')).status, 403);
  assert.equal((await approver.post('/bank-changes/BC-001/verify', { note: 'called the number on file' })).status, 403);
});

test('auditor gets 403 on every mutation', async () => {
  const auditor = app.as('U006');
  const flagId = await flagIdOf(flagged.invoice_id);
  const attempts = [
    ['patch', `/invoices/${pending.invoice_id}`, { total: 1 }],
    ['post', `/invoices/${flagged.invoice_id}/flags/${flagId}/resolve`, { note: 'auditor trying to clear it' }],
    ['post', `/invoices/${pending.invoice_id}/approve`, { acknowledge: true }],
    ['post', `/invoices/${flagged.invoice_id}/submit`, {}],
    ['post', '/vendors', { legal_name: 'Auditor Shell Co' }],
    ['put', '/policies/P01', { max_amount_cad: 999999 }],
    ['post', '/payments', { invoice_id: pending.invoice_id }],
    ['post', '/payments/PAY-00001/release', {}],
    ['post', '/vendors/V007/bank-changes', { institution: '001', transit: '12345', account: '1234567' }],
    ['patch', '/users/U013', { role: 'controller_admin' }],
    ['post', '/admin/reset', {}],
  ];
  for (const [method, path, body] of attempts) {
    const r = await auditor[method](path, body);
    assert.equal(r.status, 403, `${method.toUpperCase()} ${path} should be 403, got ${r.status}`);
  }
  // Nothing changed.
  const pol = (await auditor.get('/policies')).body.find((p) => p.rule_id === 'P01');
  assert.equal(pol.max_amount_cad, 10000);
  const inv = (await auditor.get(`/invoices/${pending.invoice_id}`)).body.invoice;
  assert.equal(inv.total, pending.total);
  const fl = (await auditor.get(`/invoices/${flagged.invoice_id}`)).body.flags.find((f) => f.id === flagId);
  assert.equal(fl.status, 'open');
  // Auditor can still read the trail.
  assert.equal((await auditor.get('/audit')).status, 200);
});

test('employee only sees their own invoices', async () => {
  const emp = app.as('U013');
  const { status, body } = await emp.get('/invoices');
  assert.equal(status, 200);
  assert.ok(body.length > 0, 'U013 has at least one invoice in the batch');
  for (const i of body) assert.equal(i.requester_user_id, 'U013', `${i.invoice_id} leaked to U013`);
  // Another department's invoice looks like it doesn't exist.
  const itInvoice = await findNew(app.as('U004'), 'FA-002853'); // D05 (IT)
  assert.equal(itInvoice.department_id, 'D05');
  assert.equal((await emp.get(`/invoices/${itInvoice.invoice_id}`)).status, 404);
  // Even a same-department invoice they didn't request.
  assert.equal((await emp.get(`/invoices/${pending.invoice_id}`)).status, 404);
  assert.equal((await emp.get('/invoices/AP-99999')).status, 404);
});

test('approver only sees their own department', async () => {
  const it = app.as('U010');
  const { body } = await it.get('/invoices?source=new');
  assert.ok(body.length > 0);
  for (const i of body) assert.equal(i.department_id, 'D05', `${i.invoice_id} (${i.department_id}) leaked to the IT approver`);
  assert.equal((await it.get(`/invoices/${pending.invoice_id}`)).status, 404); // D01
  assert.equal((await it.post(`/invoices/${pending.invoice_id}/approve`, { acknowledge: true })).status, 404);
});

test('finance manager cannot edit policies or users', async () => {
  const fm = app.as('U003');
  assert.equal((await fm.put('/policies/P01', { max_amount_cad: 20000 })).status, 403);
  assert.equal((await fm.patch('/users/U013', { role: 'approver' })).status, 403);
  assert.equal((await fm.patch('/users/U003', { approval_limit_cad: 9999999 })).status, 403);
  assert.equal((await fm.post('/admin/reset')).status, 403);
  const users = (await app.as('U001').get('/users')).body;
  assert.equal(users.find((u) => u.user_id === 'U013').role, 'employee');
  assert.equal(users.find((u) => u.user_id === 'U003').approval_limit_cad, 50000);
});

test('terminated user cannot log in, and an old token stops working', async () => {
  const r = await fetch(`${app.base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user_id: 'U015' }) });
  assert.equal(r.status, 401);
  const { signToken } = await load('policy.js');
  const me = await fetch(`${app.base}/me`, { headers: { authorization: `Bearer ${signToken('U015')}` } });
  assert.equal(me.status, 401);
  // Forged token is rejected too.
  const forged = await fetch(`${app.base}/me`, { headers: { authorization: 'Bearer U001.9999999999.forged' } });
  assert.equal(forged.status, 401);
});

test('denied attempts are recorded in the audit log', async () => {
  const { body } = await app.as('U006').get('/audit?action=access.denied');
  assert.ok(body.rows.some((r) => r.actor_user_id === 'U006'));
  assert.ok(body.rows.some((r) => r.actor_user_id === 'U004'));
});
