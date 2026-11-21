// One vocabulary for issues across the product: short names in lists, grouped decisions on the bill.
export const SHORT = {
  PO_MISSING: 'Missing PO', PO_NOT_FOUND: 'PO not found', PO_VENDOR: 'PO is for another vendor', PO_CLOSED: 'PO closed', PO_OVER_BALANCE: 'Over PO balance', PO_CURRENCY: 'PO currency differs',
  DUP_EXACT: 'Duplicate invoice number', DUP_REFORMATTED: 'Previously received invoice', DUP_NEAR: 'Possible duplicate', DUP_PAID_CARD: 'Already paid by card', DUP_FILE: 'Same file received',
  CONTRACT_PRICE: 'Contract price exceeded', CONTRACT_SCOPE: 'Outside contract scope', CONTRACT_FUEL_CAP: 'Fuel surcharge over cap', CONTRACT_RATE_CAP: 'Hourly rate over cap',
  CONTRACT_NTE: 'Monthly limit exceeded', CONTRACT_EXPIRED: 'Contract expired', CONTRACT_CURRENCY: 'Contract currency differs',
  BANK_MISMATCH: 'Bank details changed', BANK_CHANGE_UNVERIFIED: 'Bank change unverified', BANK_CHANGE_PENDING: 'Bank change pending', BANK_CHANGE_RECENT: 'Recent bank change',
  VENDOR_UNKNOWN: 'Unknown vendor', VENDOR_PENDING: 'Vendor not approved', VENDOR_ON_HOLD: 'Vendor on hold', VENDOR_INACTIVE: 'Vendor inactive',
  VENDOR_LOOKALIKE: 'Lookalike vendor', VENDOR_TAXID_MISMATCH: 'GST number mismatch', SENDER_MISMATCH: 'Unexpected sender', CURRENCY_CHANGE: 'Currency changed',
  ARITH_LINE: 'Line doesn’t add up', ARITH_SUBTOTAL: 'Subtotal doesn’t add up', ARITH_TOTAL: 'Total doesn’t add up',
  DATE_FUTURE: 'Dated in the future', DATE_DUE_BEFORE: 'Due before issue date', DATE_STALE: 'Bill over 60 days old', DATE_TERMS: 'Terms mismatch',
  SPLIT_INVOICE: 'Possible split bill', LOW_CONFIDENCE: 'Check captured fields', TAX_NO_PROVINCE: 'Delivery province unknown', TAX_NO_REG: 'No GST number',
  CREDIT_NO_REF: 'Credit has no original', CREDIT_REF_UNKNOWN: 'Original bill not found', CREDIT_EXCEEDS: 'Credit exceeds original', PO_REQUESTER_DEPARTED: 'PO owner left',
};
export const shortName = (code) => SHORT[code] || (code?.startsWith('TAX_') ? 'Tax mismatch' : code?.replace(/_/g, ' ').toLowerCase());

// Several findings in one category are one decision for the reviewer.
export const GROUP = {
  tax: 'Tax mismatch', duplicate: 'Possible duplicate', fraud: 'Payment-fraud risk', vendor: 'Vendor', po: 'Purchase order', contract: 'Contract pricing',
  arithmetic: 'Amounts don’t add up', dates: 'Dates', credit: 'Credit note', policy: 'Approval policy', capture: 'Capture', currency: 'Currency', payment: 'Payment',
};
export const VERB = {
  tax: 'Review tax', duplicate: 'Review duplicate', fraud: 'Verify vendor', vendor: 'Review vendor', po: 'Review PO', contract: 'Review pricing',
  arithmetic: 'Review amounts', dates: 'Review dates', credit: 'Review credit', policy: 'Review', capture: 'Check fields', currency: 'Review', payment: 'Review',
};

// Parse "CODE:severity,CODE:severity" from the list API.
export function parseIssues(s) {
  return (s || '').split(',').filter(Boolean).map((x) => { const [code, sev] = x.split(':'); return { code, sev }; });
}

// Workflow vocabulary, identical on every screen.
export const STAGE = { review: 'Needs review', pending: 'Awaiting approval', ready: 'Ready to schedule', scheduled: 'In payment', paid: 'Paid' };

// "12d overdue" carries more than a repeated "Overdue" label.
export function overdueDays(due) {
  if (!due) return 0;
  const d = Math.floor((Date.now() - new Date(due + 'T12:00:00').getTime()) / 86400000);
  return d > 0 ? d : 0;
}
