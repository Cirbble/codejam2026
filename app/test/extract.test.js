// Parser regression tests on text snippets shaped like real invoices (no PDFs, no LLM).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_BUDGET_USD = '0';
const { parseInvoiceText, assess, parseMoney, parseDate, findMoney } = await import('../server/services/extract.js');

const BILL_TO_ON = 'Bill to\nHarborline Logistics Inc.\n88 Queens Quay W, Suite 1400, Toronto ON M5J 0B8\nGST/HST 100000001RT0001';

test('money: EN, FR, negatives and parentheses', () => {
  assert.equal(parseMoney('$1,230.00'), 1230);
  assert.equal(parseMoney('-$1,042.76'), -1042.76);
  assert.equal(parseMoney('1 014,18 $'), 1014.18);
  assert.equal(parseMoney('(660.00)'), -660);
  assert.deepEqual(findMoney('Credit (660.00)').map((m) => m.value), [-660]);
});

test('dates: ISO, words, French, DD/MM by default, MM/DD for USD documents', () => {
  assert.equal(parseDate('2026-10-28'), '2026-10-28');
  assert.equal(parseDate('Oct 28, 2026'), '2026-10-28');
  assert.equal(parseDate('5 novembre 2026'), '2026-11-05');
  assert.equal(parseDate('05/11/2026'), '2026-11-05');
  assert.equal(parseDate('11/05/2026', { monthFirst: true }), '2026-11-05');
});

test('bilingual sample layout parses and ties out', () => {
  const t = `Laurentian Logistics Inc.\n1502 Centre St\nMontreal QC G9V 5B6\nTPS/TVH 790628686RT0001 TVQ 1745206219TQ0001\nFACTURE\nFacture n°: FA-002399\nDate: 2026-10-25\nÉchéance: 2026-11-24\nConditions: Net 30\nFacturer à\nHarborline Logistics Inc.\n1250 Rene-Levesque O, Bureau 2200, Montreal QC H3B 4W8\nDescription Qté Prix unitaire Montant\nLTL shipment Ottawa-Regina 1 1 014,18 $ 1 014,18 $\nFuel surcharge (11.62%) 1 117,84 $ 117,84 $\nSous-total 1 132,02 $\nTPS (5 %) 56,60 $\nTVQ (9,975 %) 112,92 $\nTotal CAD 1 301,54 $\nInst. 001 Transit 85308 Acct 177982930`;
  const { result: r } = parseInvoiceText(t);
  assert.equal(r.invoice_number, 'FA-002399');
  assert.equal(r.due_date, '2026-11-24');
  assert.equal(r.ship_to_province, 'QC');
  assert.equal(r.vendor_gst_hst_number, '790628686RT0001');
  assert.deepEqual(r.taxes.map((x) => x.type), ['GST', 'QST']);
  assert.equal(r.line_items.length, 2);
  assert.equal(r.line_items[0].amount, 1014.18);
  assert.equal(r.bank.account, '177982930');
  const q = assess(r);
  assert.ok(q.tiesLines && q.tiesTotal && q.confidence >= 0.9);
});

test('bank details labelled over several lines are captured', () => {
  const t = `Maple Tire & Auto Fleet\nGST/HST 741252350RT0001\nINVOICE\nInvoice #: MT-77812\nDate: 2026-11-13\n${BILL_TO_ON}\nDescription Qty Unit price Amount\nTire service 2 $100.00 $200.00\nSubtotal $200.00\nHST (13%) $26.00\nTotal CAD $226.00\nBanking details for EFT\nFinancial institution: 002\nBranch transit: 41187\nAccount number: 7730215`;
  const { result: r } = parseInvoiceText(t);
  assert.deepEqual(r.bank, { institution: '002', transit: '41187', account: '7730215' });
});

test('quantity-first rows: qty read only when the math agrees; otherwise left for the second reader', () => {
  const ok = parseInvoiceText(`Paper Trail\nINVOICE\nInvoice #: 1\nDate: 2026-11-14\n${BILL_TO_ON}\nQty Description Unit price Amount\n12 Toner cartridge $89.50 $1,074.00\nSubtotal $1,074.00\nTotal CAD $1,074.00`).result;
  assert.equal(ok.line_items[0].quantity, 12);
  assert.equal(ok.line_items[0].description, 'Toner cartridge');
  const bad = parseInvoiceText(`Paper Trail\nINVOICE\nInvoice #: 2\nDate: 2026-11-14\n${BILL_TO_ON}\nQty Description Unit price Amount\n12 Toner cartridge $89.50 $1,104.00\nSubtotal $1,104.00\nTotal CAD $1,104.00`).result;
  assert.equal(bad.line_items[0].quantity, null);
  assert.ok(assess(bad).confidence < 0.9, 'ambiguous line must trigger the fallback reader');
});

test('credit memo with "Applies to invoice" reference and parenthesised amounts', () => {
  const t = `Lattice Ledger Systems\nGST/HST 548383828RT0001\nCREDIT MEMO\nMemo #: CM-0091\nMemo date: 2026-11-06\nApplies to invoice: 554\n${BILL_TO_ON.replace('Toronto ON M5J 0B8', 'Toronto ON M5J 0B8')}\nDescription Qty Unit price Amount\nService credit 1 (660.00) (660.00)\nSubtotal (660.00)\nHST (13%) (85.80)\nTotal CAD (745.80)`;
  const { result: r } = parseInvoiceText(t);
  assert.equal(r.doc_type, 'credit_note');
  assert.equal(r.invoice_number, 'CM-0091');
  assert.equal(r.credit_note_ref, '554');
  assert.equal(r.total, -745.8);
});

test('province falls back to a Harborline office postal code when the bill-to label is unusual', () => {
  const t = `Fixwell Facility Services\nGST/HST 880851885RT0001\nINVOICE\nInvoice #: FA-000437\nDate: 2026-11-10\nAccount holder\nHarborline Logistics Inc., 88 Queens Quay W, Suite 1400, Toronto ON M5J 0B8\nDescription Qty Unit price Amount\nRepair 1 $100.00 $100.00\nSubtotal $100.00\nHST (13%) $13.00\nTotal CAD $113.00`;
  assert.equal(parseInvoiceText(t).result.ship_to_province, 'ON');
});
