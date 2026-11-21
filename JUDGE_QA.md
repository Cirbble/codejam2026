# Judge Q&A: defending the design

Short answers first, then the detail you can point at in code.

## 1. How are roles enforced?

**On the server, twice per request.** The UI hides buttons, but that's only cosmetics.

1. **Capability check** (`server/policy.js`, the `R` matrix). Every route declares what it needs, e.g. `api.post('/payments/:id/release', requirePerm('payment.release'), …)`. An AP clerk calling it gets a 403 with a plain reason, and the attempt is written to the audit log as `access.denied`.
2. **Record-level check** after loading the row from the database:
   - **Scope**: `invoiceScope()` builds the SQL filter for what a user can see. An employee sees what they requested or submitted. An approver sees their department, plus anything assigned to them or to someone they're covering for. Everyone else sees all. An out-of-scope invoice returns **404, not 403**, so its existence doesn't leak.
   - **Separation of duties**: `approvalDecision()` and `releaseDecision()` re-read the approval rows, so:
     - nobody approves what they requested (P07);
     - nobody signs two steps of one invoice;
     - a delegate's approval is stored with `on_behalf_of_user_id`;
     - nobody releases a payment they approved, had approved on their behalf, prepared, or requested (P11);
     - the release role depends on the CAD amount (P09/P10): finance manager up to $100k, controller above.

   Vendor approval and bank-change approval also refuse the person who created the request.
- **Tokens**: HMAC-signed `user.expiry.sig`, verified with `timingSafeEqual`. The user row is reloaded on every request, so a role change or termination applies at once. The demo has no passwords; production would put SSO in front and keep exactly the same `policy.js`.
- **Proof**: `test/rbac.test.js` and `test/payments.test.js` call the HTTP API directly, as each role, and check for 403/404. They also check that the auditor's denied writes changed nothing.

## 2. How are duplicates detected?

Five independent signals, cheapest first (`checks.js#duplicateChecks`):

| Signal | Catches | Sample hit |
|---|---|---|
| SHA-256 of the file | the same PDF sent twice | — |
| vendor + **normalised** number (`INV-00734` → `734`, prefix and leading zeros stripped) | exact and re-formatted numbers | Brightline `583` = history `FA-000583` (paid) |
| one number is the other plus a short suffix, **and** same amount | re-sent bills (`000903-A`) | Voyageur |
| same amount within 10 days under a different number | re-issued bills | Cloudbarn INV-01561 vs INV-01567 |
| any of the above across **lookalike vendor records** (similar name or shared bank account) | the same bill entered under a duplicate vendor | Polar Freight Lines Ltd. / Limited |
| **already paid by card**: virtual-card payment linked to the same invoice number, or an unlinked employee-card charge at that merchant, same amount, −10/+45 days | AP paying a bill an employee already put on a Brim card | Cloudbarn INV-01561 (CT-00556) |

- **Within a batch** only the later copy is flagged.
- **Recurring bills**: a monthly fixed-fee bill isn't a duplicate. Different number, about 30 days apart → no flag.
- **Split invoices** (same vendor and department, ≤ 3 days apart, each between 30% and 100% of the limit, together over it) are flagged. They're then routed at their **combined** amount, so they pick up the finance-manager step they were trying to avoid (Orion 279/281/287).
- The same logic run over the history found **4 bills paid twice ($14.3k)**: Audit → Past duplicate payments.

## 3. How are mismatches detected?

Deterministic rules with tolerances, every one explained in words with the numbers (`checks.js#runChecks`):

- **Tax by place of supply**, i.e. the bill-to/ship-to province, not the vendor's province:
  - ON: HST 13%
  - QC: GST 5% + QST 9.975%
  - BC: GST 5% + PST 7% **on goods lines only**. Goods vs services comes from the coding model, which learned it from history's `line_type`.
  - other provinces: GST 5%
  - foreign vendor: none
  - insurance: exempt

  The check compares the expected tax with what's charged, by type and amount (± $0.05). That gives three outcomes: missing, wrong amount, or unexpected. Example: Northbound charged HST on a Calgary delivery.
- **Arithmetic**: qty × unit = line; Σ lines = subtotal; subtotal + tax = total.
- **Vendor**: unknown, pending, on hold; invoice GST number ≠ master; bank account on the invoice ≠ master; an unverified bank change in the last 120 days; sender domain ≠ the vendor's AP contact.
- **PO**: missing when the vendor requires one (P13); unknown; another vendor's; closed; **over the remaining balance** (PO total − already invoiced), which routes to the finance manager (P12).
- **Contract**:
  - fixed monthly fee exceeded;
  - hourly rate over the cap;
  - fuel surcharge % over the cap, with the allowed amount computed;
  - monthly not-to-exceed, summed across the month's bills;
  - expired;
  - currency differs.
- **Dates**: dated after receipt; due before issue; more than 60 days old; due date inconsistent with terms.

**Why rules and not a model?** Every flag has to explain itself to an approver and survive an auditor. A rule gives the exact numbers. The LLM is used only to **read** documents and questions, never to decide.

## 4. How does extraction handle bad inputs?

1. **PDF with a text layer**: pdf.js returns text in content-stream order. These invoices scramble the visual layout (totals printed under the wrong labels when read top to bottom), but the stream order keeps each label next to its value. The parser is label-driven and bilingual (`Facture n°`, `Échéance`, `Sous-total`, `TPS/TVQ`, `1 014,18 $`). French thousands-separator ambiguity (`11 114,18 $`: qty 11 or $11,114.18?) is settled by checking qty × unit = amount.
2. **Self-check**: the parse is accepted only if the vendor, number, date, total and lines are present **and** the totals tie out. 53 of the 54 sample PDFs pass. The one that doesn't (Evergreen) really is wrong: its total is $100 off, and Gemini confirmed it.
3. **Fallback**: anything else, or no text layer (scans, PNG/JPG, image-only PDFs), goes to **Gemini**. A PDF with text is sent as text; an image is sent as an image. The prompt asks for strict JSON and to copy numbers as printed, even if they're wrong. Then:
   - The output is normalised: dates to ISO, money parsed, Harborline's own GST number rejected as the vendor's.
   - It's merged field by field with the parser result. Any disagreement is written to the capture notes.
   - If both readers agree the numbers don't tie, that's an **invoice error**, not a capture error.
4. **Cost and reproducibility**: every LLM result is cached on disk by file SHA-256, so a re-upload costs nothing, and the cache for the sample scans is committed. A per-process budget cap (`LLM_BUDGET_USD`) stops runaway spend. Total spent building and testing: **under $0.05**.
5. **Low confidence** (< 75%) raises a "check the captured fields" flag. The document is shown next to the fields on the same screen, and AP can edit any field; checks and routing re-run immediately.
6. **Unseen layouts**: we tested 12 synthetic invoices in formats the parser had never seen; all 12 came out right on the deployed app (see the README). The gate that decides whether to call the second reader also checks the fields our checks depend on: province, bank details when remittance wording is present, the credit-note reference, and unambiguous quantities. A parse that is incomplete in a way that would silently skip a check never gets accepted.
7. **Prompt injection**: text inside an invoice can't make the model *do* anything. Its output is JSON that we parse and validate, it never executes, and nothing it says changes permissions or routing.

## 5. Why is the data modelled this way?

- **Invoices, lines and taxes are separate tables.** Lines carry their own GL, department and tax codes, so one bill can be split across cost centres. Taxes are stored as captured, which lets us compare captured against expected.
- **Flags are rows**, not booleans: code, category, severity, plain-language detail, related record, resolution note and resolver. They can be resolved with a reason, carried over when the invoice is re-checked, and counted for analytics.
- **Approvals are one row per step**, with `assigned_user_id` (who should act), `approver_user_id` (who did) and `on_behalf_of_user_id`. Delegation and escalation are therefore facts in the data, not recomputed guesses.
- **Policies** started as prose in the CSV. They became structured rows (kind, band, chain, param) that the controller edits; routing reads them on every evaluation, and the "who would approve?" simulator uses the same code path.
- **Payments are separate from invoices**, so one invoice can have a cancelled and then a re-prepared payment. Each payment snapshots the bank details at preparation, and the snapshot is re-checked at release.
- **Bank changes** are their own workflow table (requested → callback verified → approved/rejected, with a risk score). They're never an edit to the vendor row.
- **The audit log is append-only and hash-chained.** It links to the invoice and the entity, so one query rebuilds an invoice's full story. Payments trace back to approvals and coding via foreign keys (Audit → Payment trace).
- **History and new bills share the same tables** (`source = history | email | upload`). Learning, duplicate checks and analytics therefore use one query path.

## 6. What breaks at 100× volume (≈ 5,000 invoices/month)?

What we would change, in order:

1. **Extraction in the request path.** Uploads are processed synchronously. → Use a job queue (pg-boss or BullMQ) with workers, so uploads return immediately; use the Gemini batch API for scans.
2. **SQLite allows a single writer.** That's fine for 50/month and probably for 5,000, but not for many concurrent writers or HA. → Postgres, using row-level security as a second line behind `invoiceScope`, plus read replicas for analytics.
3. **Coding lookup is linear.** k-NN is O(history lines) per suggestion, with an in-memory index rebuilt after each correction. → An inverted index or embeddings in pgvector, updated incrementally.
4. **Recompute fan-out.** A new bill re-checks the vendor's open bills; a policy change re-routes every open bill. → Re-route lazily, or scope by department and vendor, with an event-driven re-check.
5. **The audit chain is one sequence**, so it's a write hotspot. → Chain per tenant or per day, and anchor the head hash daily in WORM storage. That also covers the admin-rewrites-the-whole-chain threat.
6. **Files on a local volume.** → Object storage (S3/R2) with signed URLs.
7. **Money is stored as REAL**, rounded to cents at every write, which is fine at this size. → Integer cents or `NUMERIC` before real money moves.
8. **Lookalike vendor scan is O(V²)**: trivial at 56 vendors. → Blocking keys (normalised name prefix, bank account) at 5,000 vendors.

Things that **don't** break at 100×: the rules engine, routing (per invoice, constant time), duplicate checks (indexed by vendor and normalised number), and reconciliation (one pass over the statement).

## Other likely questions

- **What if Gemini is down?** Text PDFs still work on the deterministic parser, and Q&A falls back to the rule parser. Scans are flagged for manual entry with the image shown.
- **Why not have the LLM code GL accounts?** History is a better teacher and explains itself ("12 of 12 past lines…"). Leave-one-out accuracy is 100% GL and 92% department; corrections feed back immediately.
- **Delegation edge cases.** Liam (Facilities) is on leave, delegate Elise. Elise is also the finance manager. On a $18k Facilities bill she signs step 1 *for Liam*, and step 2 escalates to the Controller so two different people sign. Elise then can't release that payment; the CFO can.
- **Credit notes** are approved like bills, then applied against the vendor's next payment instead of being paid out.
- **Where's the CRA trail?** GST/HST and QST numbers are captured and validated. Recoverable tax goes to 1160/1165 in the journal export. Every action is in the hash-chained audit log, exportable as CSV with the payment → invoice → approval → GL trace.
