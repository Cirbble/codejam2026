// Append-only, hash-chained audit trail.
// hash_n = sha256(prev_hash || canonical(row_n)). Editing or deleting any row breaks every later hash,
// and SQLite triggers reject UPDATE/DELETE on the table outright.
import crypto from 'node:crypto';
import { getDb, all } from '../db.js';
import { nowIso } from '../config.js';

function canonical(r) {
  return JSON.stringify([r.ts, r.actor_user_id, r.actor_role, r.on_behalf_of_user_id, r.action, r.entity_type, r.entity_id, r.invoice_id, r.details]);
}

export function audit({ actor, action, entityType, entityId, invoiceId = null, details = {}, onBehalfOf = null, ts = null }) {
  const d = getDb();
  const prev = d.prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1').get();
  const row = {
    ts: ts || nowIso(),
    actor_user_id: actor?.user_id ?? (typeof actor === 'string' ? actor : 'system'),
    actor_role: actor?.role ?? (actor === 'system' || !actor ? 'system' : null),
    on_behalf_of_user_id: onBehalfOf,
    action,
    entity_type: entityType,
    entity_id: entityId,
    invoice_id: invoiceId,
    details: JSON.stringify(details ?? {}),
  };
  const prevHash = prev?.hash || 'GENESIS';
  const hash = crypto.createHash('sha256').update(prevHash + canonical(row)).digest('hex');
  d.prepare(`INSERT INTO audit_log (ts, actor_user_id, actor_role, on_behalf_of_user_id, action, entity_type, entity_id, invoice_id, details, prev_hash, hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(row.ts, row.actor_user_id, row.actor_role, row.on_behalf_of_user_id, row.action, row.entity_type, row.entity_id, row.invoice_id, row.details, prevHash, hash);
  return hash;
}

export function verifyChain() {
  const rows = all('SELECT * FROM audit_log ORDER BY seq');
  let prevHash = 'GENESIS';
  for (const r of rows) {
    const h = crypto.createHash('sha256').update(prevHash + canonical(r)).digest('hex');
    if (r.prev_hash !== prevHash || r.hash !== h) return { ok: false, brokenAt: r.seq, count: rows.length };
    prevHash = r.hash;
  }
  return { ok: true, count: rows.length, head: prevHash };
}
