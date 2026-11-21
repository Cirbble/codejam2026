// Approval routing driven by the editable `policies` table.
// Output is an ordered list of steps, each with the person assigned and a plain-language reason.
import { all, get } from '../db.js';
import { today } from '../config.js';
import { money } from '../util.js';

const ROLE_ORDER = ['dept_manager', 'finance_manager', 'controller_admin', 'cfo'];
const ROLE_LABEL = { dept_manager: 'Department manager', finance_manager: 'Finance manager', controller_admin: 'Controller', cfo: 'CFO' };
export const roleLabel = (r) => ROLE_LABEL[r] || r;

export function activePolicies() {
  return all('SELECT * FROM policies WHERE active = 1 ORDER BY sort').map((p) => ({ ...p, chain: JSON.parse(p.chain || '[]') }));
}

export function userById(id) {
  return id ? get('SELECT * FROM users WHERE user_id = ?', id) : null;
}

export function activeDelegation(userId, onDate = today()) {
  return get(`SELECT * FROM delegations WHERE user_id = ? AND active = 1 AND starts_on <= ? AND (ends_on IS NULL OR ends_on >= ?) ORDER BY id DESC LIMIT 1`, userId, onDate, onDate);
}

function roleHolder(role) {
  if (role === 'finance_manager') return get(`SELECT * FROM users WHERE role = 'finance_manager' AND status != 'terminated' ORDER BY approval_limit_cad DESC LIMIT 1`);
  if (role === 'controller_admin') return get(`SELECT * FROM users WHERE role = 'controller_admin' AND status != 'terminated' AND title NOT LIKE '%Chief%' ORDER BY approval_limit_cad LIMIT 1`);
  if (role === 'cfo') return get(`SELECT * FROM users WHERE role = 'controller_admin' AND title LIKE '%Chief Financial%' LIMIT 1`);
  return null;
}

// Decide the chain of roles, with the rule that put each role there.
export function requiredRoles({ amountCad, vendor, flags = [], doc_type = 'invoice' }) {
  const pol = activePolicies();
  const roles = new Map();
  const add = (role, rule, why) => { if (!roles.has(role)) roles.set(role, { role, rule, why }); };
  const amt = Math.abs(amountCad || 0);
  const tier = pol.filter((p) => p.kind === 'amount_chain' && inBand(amt, p))
    .sort((a, b) => (b.min_amount_cad || 0) - (a.min_amount_cad || 0))[0];
  if (tier) for (const r of tier.chain) add(r, tier.rule_id, `${tier.condition_text}`);
  else add('dept_manager', 'default', 'Default');
  if (doc_type === 'invoice') {
    for (const p of pol) {
      if (p.kind === 'vendor_new' && (!vendor || vendor.status === 'pending_review' || isNewVendor(vendor))) for (const r of p.chain) add(r, p.rule_id, !vendor ? 'Vendor is not in the vendor master' : 'New or unapproved vendor');
      if (p.kind === 'vendor_category' && vendor && vendor.category === p.param) for (const r of p.chain) add(r, p.rule_id, `${p.param} vendor`);
      if (p.kind === 'po_balance' && flags.some((f) => f.code === 'PO_OVER_BALANCE')) for (const r of p.chain) add(r, p.rule_id, 'Over the PO balance');
    }
    if (flags.some((f) => f.category === 'fraud' || f.code === 'SPLIT_INVOICE')) add('finance_manager', 'flagged', 'Flagged invoice (fraud or split-invoice signal)');
  }
  return [...roles.values()].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

// Bands are (min, max]; the lowest band also includes 0.
function inBand(amt, p) {
  const min = p.min_amount_cad ?? 0;
  return (amt > min || (min === 0 && amt === 0)) && (p.max_amount_cad === null || amt <= p.max_amount_cad);
}

function isNewVendor(v) {
  const n = get(`SELECT count(*) c FROM invoices WHERE vendor_id = ? AND source = 'history'`, v.vendor_id).c;
  return n === 0;
}

// Resolve roles to people, applying self-approval (P07), leave/delegation (P08), terminated users,
// and "one person, one step" so the same individual never fills two steps of the same invoice.
export function buildRoute({ inv, vendor, flags = [], amountCad }) {
  const pol = activePolicies();
  const selfRule = pol.find((p) => p.kind === 'self_approval');
  const leaveRule = pol.find((p) => p.kind === 'on_leave');
  const roles = requiredRoles({ amountCad: amountCad ?? inv.total_cad, vendor, flags, doc_type: inv.doc_type });
  const used = new Set();
  const steps = [];
  const requester = inv.requester_user_id;
  for (const r of roles) {
    let user = r.role === 'dept_manager' ? userById(get('SELECT manager_user_id m FROM departments WHERE department_id = ?', inv.department_id)?.m) : roleHolder(r.role);
    const notes = [];
    let onBehalf = null;
    for (let guard = 0; guard < 6 && user; guard++) {
      if (user.status === 'terminated') { notes.push(`${user.full_name} has left; escalated to their manager`); user = userById(user.manager_id); continue; }
      if (user.user_id === requester && selfRule) { notes.push(`${user.full_name} requested this invoice and can't approve it (${selfRule.rule_id}); escalated to their manager`); user = userById(user.manager_id); continue; }
      const del = leaveRule ? activeDelegation(user.user_id) : null;
      if (del && !onBehalf) { notes.push(`${user.full_name} is away; routed to delegate (${leaveRule.rule_id})`); onBehalf = user.user_id; user = userById(del.delegate_user_id); continue; }
      if (used.has(user.user_id)) { notes.push(`${user.full_name} already approves an earlier step; escalated so two different people sign off`); user = userById(user.manager_id); onBehalf = null; continue; }
      break;
    }
    if (!user || used.has(user.user_id) || user.user_id === requester) {
      // Escalation ran out of people: take the most senior independent approver left, or skip with a note.
      const pool = all(`SELECT * FROM users WHERE role IN ('controller_admin','finance_manager') AND status = 'active' ORDER BY approval_limit_cad DESC`);
      const alt = pool.find((u) => !used.has(u.user_id) && u.user_id !== requester);
      if (alt) { notes.push(`No independent ${roleLabel(r.role).toLowerCase()} left in the chain; assigned to ${alt.full_name}`); user = alt; onBehalf = null; }
      else { continue; }
    }
    used.add(user.user_id);
    steps.push({ step_no: steps.length + 1, approver_role: r.role, rule_id: r.rule, assigned_user_id: user.user_id, on_behalf_of_user_id: onBehalf, reason: [r.why, ...notes].join('. ') });
  }
  return steps;
}

export function describeRoute(steps) {
  return steps.map((s) => `${s.step_no}. ${roleLabel(s.approver_role)}: ${userById(s.assigned_user_id)?.full_name}${s.on_behalf_of_user_id ? ` (for ${userById(s.on_behalf_of_user_id)?.full_name})` : ''}`).join(' → ');
}

// Who may release a payment of this size, under the release policies.
export function releaseRolesFor(amountCad) {
  const p = activePolicies().filter((x) => x.kind === 'release_limit')
    .find((x) => inBand(Math.abs(amountCad), x));
  return p ? { roles: p.chain, rule: p.rule_id, text: p.condition_text } : { roles: ['controller_admin'], rule: 'default', text: 'Default' };
}

export function releaseLimitText(amountCad) {
  const r = releaseRolesFor(amountCad);
  return `${money(amountCad)} needs ${r.roles.map(roleLabel).join(' or ')} (${r.rule})`;
}
