// Audit trail: every decision is logged, the hash chain verifies, and the table is append-only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, findNew, load } from './helpers.js';

let app, db, audit;
before(async () => {
  app = await start();
  db = await load('db.js');
  audit = await load('services/audit.js');
});
after(() => app.stop());

const count = (action, invoiceId) => db.get('SELECT count(*) c FROM audit_log WHERE action = ? AND invoice_id = ?', action, invoiceId).c;

test('processing the inbox wrote a valid chain', async () => {
  const { status, body } = await app.as('U006').get('/audit');
  assert.equal(status, 200);
  assert.equal(body.chain.ok, true);
  assert.ok(body.chain.count > 100);
  assert.ok(body.rows.length > 0);
});

test('approving creates an audit row with actor, role and step', async () => {
  const inv = await findNew(app.as('U004'), 'TR26-1042'); // clean, D01, one step for U007
  assert.equal(count('invoice.approved', inv.invoice_id), 0);
  const r = await app.as('U007').post(`/invoices/${inv.invoice_id}/approve`, { acknowledge: true, comment: 'Fuel for October' });
  assert.equal(r.status, 200, r.body.error);
  assert.equal(count('invoice.approved', inv.invoice_id), 1);
  assert.equal(count('invoice.fully_approved', inv.invoice_id), 1);
  const row = db.get(`SELECT * FROM audit_log WHERE action = 'invoice.approved' AND invoice_id = ?`, inv.invoice_id);
  assert.equal(row.actor_user_id, 'U007');
  assert.equal(row.actor_role, 'approver');
  assert.equal(JSON.parse(row.details).comment, 'Fuel for October');
});

test('a denied approval is logged too', async () => {
  const inv = await findNew(app.as('U004'), 'FA-002399'); // D01 pending, assigned U007
  const before = count('invoice.approve_denied', inv.invoice_id);
  assert.equal((await app.as('U002').post(`/invoices/${inv.invoice_id}/approve`, { acknowledge: true })).status, 403);
  assert.equal(count('invoice.approve_denied', inv.invoice_id), before + 1);
});

test('resolving a flag creates an audit row; fraud flags need a finance manager', async () => {
  const inv = await findNew(app.as('U004'), 'NO26-1773');
  const d = (await app.as('U004').get(`/invoices/${inv.invoice_id}`)).body;
  const flag = d.flags.find((f) => f.code === 'ARITH_LINE');
  assert.equal((await app.as('U004').post(`/invoices/${inv.invoice_id}/flags/${flag.id}/resolve`, { note: 'no' })).status, 400); // needs a real note
  const r = await app.as('U004').post(`/invoices/${inv.invoice_id}/flags/${flag.id}/resolve`, { note: 'Vendor confirmed 24 x 150; corrected invoice on file' });
  assert.equal(r.status, 200, r.body.error);
  assert.equal(r.body.flags.find((f) => f.id === flag.id).status, 'resolved');
  // Flag ids survive the recompute that follows a resolve, so the audit row's entity_id stays valid.
  assert.deepEqual(r.body.flags.map((f) => f.id).sort(), d.flags.map((f) => f.id).sort());
  const row = db.get(`SELECT * FROM audit_log WHERE action = 'flag.resolved' AND invoice_id = ? ORDER BY seq DESC`, inv.invoice_id);
  assert.equal(row.actor_user_id, 'U004');
  assert.equal(JSON.parse(row.details).code, 'ARITH_LINE');

  const lookalike = await findNew(app.as('U004'), 'HA26-2766');
  const fraud = (await app.as('U004').get(`/invoices/${lookalike.invoice_id}`)).body.flags.find((f) => f.category === 'fraud');
  assert.ok(fraud);
  const denied = await app.as('U004').post(`/invoices/${lookalike.invoice_id}/flags/${fraud.id}/resolve`, { note: 'Looks fine to me honestly' });
  assert.equal(denied.status, 403);
  const ok = await app.as('U003').post(`/invoices/${lookalike.invoice_id}/flags/${fraud.id}/resolve`, { note: 'Called vendor on file number; record is genuine' });
  assert.equal(ok.status, 200, ok.body.error);
  assert.ok(db.get(`SELECT 1 FROM audit_log WHERE action = 'flag.resolved' AND invoice_id = ? AND actor_user_id = 'U003'`, lookalike.invoice_id));
});

test('chain still verifies after the new rows', async () => {
  const { body } = await app.as('U006').get('/audit');
  assert.equal(body.chain.ok, true);
  assert.equal(body.chain.count, db.get('SELECT count(*) c FROM audit_log').c);
});

test('audit_log rejects UPDATE and DELETE (append-only triggers)', () => {
  const seq = db.get('SELECT min(seq) s FROM audit_log').s;
  assert.throws(() => db.run(`UPDATE audit_log SET action = 'tampered' WHERE seq = ?`, seq), /append-only/);
  assert.throws(() => db.run('DELETE FROM audit_log WHERE seq = ?', seq), /append-only/);
  assert.notEqual(db.get('SELECT action FROM audit_log WHERE seq = ?', seq).action, 'tampered');
  assert.equal(audit.verifyChain().ok, true);
});

test('only auditors, finance managers and controllers can read the audit log', async () => {
  for (const who of ['U004', 'U007', 'U013']) assert.equal((await app.as(who).get('/audit')).status, 403, who);
  for (const who of ['U006', 'U003', 'U002']) assert.equal((await app.as(who).get('/audit')).status, 200, who);
});

// Last: deliberately break the table's protection to prove the hash chain catches edits on its own.
test('editing a row behind the triggers breaks the hash chain', async () => {
  const seq = db.get('SELECT min(seq) + 5 s FROM audit_log').s;
  db.getDb().exec('DROP TRIGGER audit_no_update');
  db.run(`UPDATE audit_log SET details = '{"tampered":true}' WHERE seq = ?`, seq);
  const v = audit.verifyChain();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, seq);
  assert.equal((await app.as('U006').get('/audit')).body.chain.ok, false);
});
