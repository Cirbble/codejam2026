// Duplicate, tax and arithmetic checks: unit tests on synthetic invoices, plus the processed sample batch.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, findNew, load } from './helpers.js';

let app, checks, db, util;
before(async () => {
  app = await start();
  checks = await load('services/checks.js');
  db = await load('db.js');
  util = await load('util.js');
});
after(() => app.stop());

// ---------- synthetic invoice builders ----------
function synth({ province = 'ON', lines, taxes, subtotal, total, currency = 'CAD', taxId = '123456789RT0001', ...rest } = {}) {
  const sub = subtotal ?? Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  const tax = taxes.reduce((a, t) => a + t.amount, 0);
  return {
    inv: {
      invoice_id: 'AP-99990', doc_type: 'invoice', currency, ship_to_province: province, subtotal: sub, total: total ?? Math.round((sub + tax) * 100) / 100,
      total_cad: total ?? sub + tax, fx_rate_to_cad: 1, extracted_vendor_tax_id: taxId, invoice_date: '2026-10-15', received_date: '2026-10-16', due_date: '2026-11-14',
      vendor_invoice_number: 'T-1', invoice_number_norm: 'T1', source: 'upload', ...rest,
    },
    lines: lines.map((l, i) => ({ line_no: i + 1, description: l.description || `Line ${i + 1}`, quantity: l.quantity ?? 1, unit_price: l.unit_price ?? l.amount, amount: l.amount, line_type: l.line_type || 'services' })),
    taxes,
    vendor: null,
    email: null,
  };
}
const codes = (flags, category) => flags.filter((f) => !category || f.category === category).map((f) => f.code).sort();
const taxCodes = (ctx) => codes(checks.runChecks(ctx), 'tax');

describe('expectedTaxes (place of supply)', () => {
  test('ON expects HST 13%', () => {
    const e = checks.expectedTaxes('ON');
    assert.deepEqual(e.parts.map((p) => [p.type, p.rate, p.base]), [['HST', 0.13, 'all']]);
  });
  test('QC expects GST 5% + QST 9.975%', () => {
    const e = checks.expectedTaxes('QC');
    assert.deepEqual(e.parts.map((p) => [p.type, p.rate]), [['GST', 0.05], ['QST', 0.09975]]);
  });
  test('BC expects GST 5% + PST 7% on goods only', () => {
    const e = checks.expectedTaxes('BC');
    assert.deepEqual(e.parts.map((p) => [p.type, p.rate, p.base]), [['GST', 0.05, 'all'], ['PST', 0.07, 'goods']]);
  });
  test('AB expects GST only; Atlantic HST 15%; foreign and exempt expect nothing', () => {
    assert.deepEqual(checks.expectedTaxes('AB').parts.map((p) => p.type), ['GST']);
    assert.deepEqual(checks.expectedTaxes('NS').parts.map((p) => [p.type, p.rate]), [['HST', 0.15]]);
    assert.deepEqual(checks.expectedTaxes('ON', { foreign: true }).parts, []);
    assert.deepEqual(checks.expectedTaxes('ON', { exempt: true }).parts, []);
  });
});

describe('runChecks: tax', () => {
  const base = [{ amount: 1000 }];
  test('ON with correct HST is clean', () => {
    assert.deepEqual(taxCodes(synth({ province: 'ON', lines: base, taxes: [{ type: 'HST', amount: 130 }] })), []);
  });
  test('ON with wrong HST amount is blocked', () => {
    const flags = checks.runChecks(synth({ province: 'ON', lines: base, taxes: [{ type: 'HST', amount: 120 }] }));
    const f = flags.find((x) => x.code === 'TAX_AMOUNT_HST');
    assert.ok(f, 'TAX_AMOUNT_HST');
    assert.equal(f.severity, 'block');
  });
  test('ON with no tax warns HST missing', () => {
    assert.deepEqual(taxCodes(synth({ province: 'ON', lines: base, taxes: [] })), ['TAX_MISSING_HST']);
  });
  test('QC with GST + QST is clean; QST missing is flagged', () => {
    assert.deepEqual(taxCodes(synth({ province: 'QC', lines: base, taxes: [{ type: 'GST', amount: 50 }, { type: 'QST', amount: 99.75 }] })), []);
    assert.deepEqual(taxCodes(synth({ province: 'QC', lines: base, taxes: [{ type: 'GST', amount: 50 }] })), ['TAX_MISSING_QST']);
  });
  test('BC goods: GST + PST 7% is clean; PST missing is flagged', () => {
    const goods = [{ amount: 1000, line_type: 'goods' }];
    assert.deepEqual(taxCodes(synth({ province: 'BC', lines: goods, taxes: [{ type: 'GST', amount: 50 }, { type: 'PST', amount: 70 }] })), []);
    assert.deepEqual(taxCodes(synth({ province: 'BC', lines: goods, taxes: [{ type: 'GST', amount: 50 }] })), ['TAX_MISSING_PST']);
  });
  test('BC mixed: PST is charged on the goods lines only', () => {
    const mixed = [{ amount: 600, line_type: 'goods' }, { amount: 400, line_type: 'services' }];
    assert.deepEqual(taxCodes(synth({ province: 'BC', lines: mixed, taxes: [{ type: 'GST', amount: 50 }, { type: 'PST', amount: 42 }] })), []);
    assert.deepEqual(taxCodes(synth({ province: 'BC', lines: mixed, taxes: [{ type: 'GST', amount: 50 }, { type: 'PST', amount: 70 }] })), ['TAX_AMOUNT_PST']);
  });
  test('BC services charged PST is blocked', () => {
    const flags = checks.runChecks(synth({ province: 'BC', lines: [{ amount: 1000, line_type: 'services' }], taxes: [{ type: 'GST', amount: 50 }, { type: 'PST', amount: 70 }] }));
    const f = flags.find((x) => x.code === 'TAX_UNEXPECTED_PST');
    assert.ok(f, 'TAX_UNEXPECTED_PST');
    assert.equal(f.severity, 'block');
  });
  test('AB charged HST is TAX_UNEXPECTED (and GST missing)', () => {
    const flags = checks.runChecks(synth({ province: 'AB', lines: base, taxes: [{ type: 'HST', amount: 130 }] }));
    assert.deepEqual(codes(flags, 'tax'), ['TAX_MISSING_GST', 'TAX_UNEXPECTED_HST']);
    assert.equal(flags.find((x) => x.code === 'TAX_UNEXPECTED_HST').severity, 'block');
  });
  test('AB with GST 5% is clean', () => {
    assert.deepEqual(taxCodes(synth({ province: 'AB', lines: base, taxes: [{ type: 'GST', amount: 50 }] })), []);
  });
  test('foreign vendor (USD, no Canadian tax number) charging GST is flagged', () => {
    const flags = checks.runChecks(synth({ province: 'ON', currency: 'USD', taxId: null, lines: base, taxes: [{ type: 'GST', amount: 50 }] }));
    assert.deepEqual(codes(flags, 'tax'), ['TAX_UNEXPECTED_GST']);
    assert.match(flags.find((f) => f.code === 'TAX_UNEXPECTED_GST').detail, /outside Canada/);
  });
  test('foreign vendor from the vendor master charging GST is flagged', () => {
    const vendor = db.get(`SELECT * FROM vendors WHERE country != 'CA' AND status = 'active' LIMIT 1`);
    assert.ok(vendor, 'dataset has a foreign vendor');
    const ctx = synth({ province: 'ON', currency: vendor.currency, taxId: null, lines: base, taxes: [{ type: 'GST', amount: 50 }] });
    ctx.vendor = vendor;
    ctx.inv.vendor_id = vendor.vendor_id;
    assert.ok(codes(checks.runChecks(ctx), 'tax').includes('TAX_UNEXPECTED_GST'));
    // Same vendor, no tax: no tax flags at all.
    ctx.taxes = [];
    ctx.inv.total = ctx.inv.subtotal;
    assert.deepEqual(codes(checks.runChecks(ctx), 'tax'), []);
  });
  test('tax charged without a registration number warns', () => {
    assert.deepEqual(taxCodes(synth({ province: 'ON', taxId: null, lines: base, taxes: [{ type: 'HST', amount: 130 }] })), ['TAX_NO_REG']);
  });
});

describe('runChecks: arithmetic', () => {
  test('qty x unit != amount is ARITH_LINE', () => {
    const ctx = synth({ province: 'ON', lines: [{ description: 'Media buy', quantity: 24, unit_price: 150, amount: 3800 }], taxes: [{ type: 'HST', amount: 494 }] });
    const flags = checks.runChecks(ctx);
    const f = flags.find((x) => x.code === 'ARITH_LINE');
    assert.ok(f);
    assert.equal(f.severity, 'block');
    assert.match(f.detail, /3,?600/);
  });
  test('subtotal + tax != total is ARITH_TOTAL', () => {
    const ctx = synth({ province: 'ON', lines: [{ amount: 1000 }], taxes: [{ type: 'HST', amount: 130 }], total: 1150 });
    assert.ok(codes(checks.runChecks(ctx)).includes('ARITH_TOTAL'));
  });
  test('lines that do not sum to the subtotal are ARITH_SUBTOTAL', () => {
    const ctx = synth({ province: 'ON', lines: [{ amount: 600 }, { amount: 300 }], subtotal: 1000, taxes: [{ type: 'HST', amount: 130 }] });
    assert.ok(codes(checks.runChecks(ctx)).includes('ARITH_SUBTOTAL'));
  });
  test('a correct invoice has no arithmetic flags (cent rounding tolerated)', () => {
    const ctx = synth({ province: 'ON', lines: [{ quantity: 3, unit_price: 33.333, amount: 100 }], taxes: [{ type: 'HST', amount: 13 }] });
    assert.deepEqual(codes(checks.runChecks(ctx), 'arithmetic'), []);
  });
});

describe('duplicateChecks (synthetic vs history)', () => {
  let hist, vendor;
  before(() => {
    hist = db.get(`SELECT * FROM invoices WHERE source = 'history' AND status = 'paid' AND doc_type = 'invoice' AND vendor_id = 'V007' AND total > 100 ORDER BY invoice_id LIMIT 1`);
    vendor = db.get('SELECT * FROM vendors WHERE vendor_id = ?', hist.vendor_id);
  });
  const candidate = (over) => ({ invoice_id: 'AP-99991', doc_type: 'invoice', source: 'upload', vendor_id: vendor.vendor_id, invoice_date: hist.invoice_date, total: hist.total, total_cad: hist.total_cad, currency: hist.currency, ...over });

  test('same number as a paid history invoice is DUP_EXACT', () => {
    const out = checks.duplicateChecks({ inv: candidate({ vendor_invoice_number: hist.vendor_invoice_number, invoice_number_norm: hist.invoice_number_norm }), vendor });
    const f = out.find((x) => x.code === 'DUP_EXACT' && x.related_id === hist.invoice_id);
    assert.ok(f, 'DUP_EXACT against the history invoice');
    assert.equal(f.severity, 'block');
    assert.match(f.detail, /already been paid/);
  });
  test('reformatted number (suffix) with the same amount is DUP_REFORMATTED', () => {
    const num = `${hist.vendor_invoice_number}-A`;
    const out = checks.duplicateChecks({ inv: candidate({ vendor_invoice_number: num, invoice_number_norm: util.normInvoiceNumber(num) }), vendor });
    assert.ok(out.some((x) => x.code === 'DUP_REFORMATTED' && x.related_id === hist.invoice_id));
  });
  test('different number, same amount, a few days apart is DUP_NEAR', () => {
    const out = checks.duplicateChecks({ inv: candidate({ vendor_invoice_number: 'ZZ-777', invoice_number_norm: 'ZZ777' }), vendor });
    const f = out.find((x) => x.related_id === hist.invoice_id);
    assert.equal(f?.code, 'DUP_NEAR');
    assert.equal(f.severity, 'warn');
  });
  test('different number and amount is not a duplicate of it', () => {
    const out = checks.duplicateChecks({ inv: candidate({ vendor_invoice_number: 'ZZ-778', invoice_number_norm: 'ZZ778', total: hist.total + 123.45, total_cad: hist.total_cad + 123.45 }), vendor });
    assert.ok(!out.some((x) => x.related_id === hist.invoice_id));
  });
  test('unknown vendor yields no vendor-based duplicate flags', () => {
    assert.deepEqual(checks.duplicateChecks({ inv: candidate({ vendor_invoice_number: hist.vendor_invoice_number, invoice_number_norm: hist.invoice_number_norm }), vendor: null }), []);
  });
});

// ---------- the processed sample batch ----------
async function flagsOf(number) {
  const api = app.as('U004');
  const hit = await findNew(api, number);
  const { body } = await api.get(`/invoices/${hit.invoice_id}`);
  return { inv: body.invoice, vendor: body.vendor, flags: body.flags };
}
const openFlag = (flags, code) => flags.find((f) => f.code === code && f.status === 'open');

describe('sample batch: duplicates', () => {
  for (const [number, vendorName] of [['001468', /Harlow & Stern/], ['000961', /Polar/], ['583', /Brightline/]]) {
    test(`#${number} (${vendorName.source}) is an exact duplicate of a paid history invoice`, async () => {
      const { vendor, flags } = await flagsOf(number);
      assert.match(vendor.legal_name, vendorName);
      const f = openFlag(flags, 'DUP_EXACT');
      assert.ok(f, 'DUP_EXACT');
      assert.equal(f.severity, 'block');
      const orig = db.get('SELECT * FROM invoices WHERE invoice_id = ?', f.related_id);
      assert.equal(orig.source, 'history');
      assert.equal(orig.status, 'paid');
      assert.equal(orig.invoice_number_norm, util.normInvoiceNumber(number));
    });
  }
  test('Brightline #583 matches history FA-000583', async () => {
    const { flags } = await flagsOf('583');
    const orig = db.get('SELECT * FROM invoices WHERE invoice_id = ?', openFlag(flags, 'DUP_EXACT').related_id);
    assert.equal(orig.vendor_invoice_number, 'FA-000583');
  });
  test('Voyageur #000903-A is DUP_REFORMATTED', async () => {
    const { vendor, flags } = await flagsOf('000903-A');
    assert.match(vendor.legal_name, /Voyageur/);
    const f = openFlag(flags, 'DUP_REFORMATTED');
    assert.ok(f);
    assert.equal(db.get('SELECT invoice_number_norm n FROM invoices WHERE invoice_id = ?', f.related_id).n, '903');
  });
  test('Cloudbarn #INV-01561 is DUP_PAID_CARD (paid by Brim virtual card)', async () => {
    const { vendor, flags } = await flagsOf('INV-01561');
    assert.match(vendor.legal_name, /Cloudbarn/);
    const f = openFlag(flags, 'DUP_PAID_CARD');
    assert.ok(f);
    assert.equal(f.severity, 'block');
    assert.match(f.detail, /virtual card/);
    const txn = db.get('SELECT * FROM card_transactions WHERE txn_id = ?', f.related_id);
    assert.ok(txn?.invoice_id, 'card transaction is linked to an invoice');
  });
  test('a clean invoice in the batch carries no duplicate flags', async () => {
    const { flags } = await flagsOf('TR26-1042');
    assert.deepEqual(flags.filter((f) => f.category === 'duplicate'), []);
  });
});

describe('sample batch: tax and arithmetic', () => {
  test('Northbound Couriers #000639 (Calgary AB) charged HST is flagged', async () => {
    const { inv, vendor, flags } = await flagsOf('000639');
    assert.match(vendor.legal_name, /Northbound/);
    assert.equal(inv.ship_to_province, 'AB');
    assert.equal(openFlag(flags, 'TAX_UNEXPECTED_HST')?.severity, 'block');
  });
  test('Northstar #NO26-1773 (24 x 150 != 3800) is ARITH_LINE', async () => {
    const { vendor, flags } = await flagsOf('NO26-1773');
    assert.match(vendor.legal_name, /Northstar/);
    const f = openFlag(flags, 'ARITH_LINE');
    assert.ok(f);
    assert.match(f.detail, /24 ×/);
  });
  test('blocked invoices stay out of approval', async () => {
    for (const n of ['000639', 'NO26-1773', '001468', 'INV-01561']) {
      const { inv } = await flagsOf(n);
      assert.notEqual(inv.status, 'pending_approval', `#${n} should not be routed while blocked`);
    }
  });
});
