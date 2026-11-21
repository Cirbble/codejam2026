# Brim AP: inbox to payment for Harborline Logistics

Accounts-payable automation for a business-card platform. A supplier invoice arrives by email or upload, gets read (EN/FR, PDF or scan), coded, checked, routed to the right approvers, paid by simulated EFT or a single-use Brim virtual card, and lands in a tamper-evident audit trail.

**Live:** https://web-production-c7f1b889.up.railway.app — pick a role on the sign-in screen (demo users from `users.csv`, no passwords).

## Run it

```bash
cd app
npm install
npm --prefix client install && npm run build   # builds the React client into client/dist
npm start                                        # http://localhost:3000
npm test                                         # 91 tests, ~3 s, no API calls
```

Node 24 (uses the built-in `node:sqlite`, so there is no native build step). On first boot the server builds `app/data/brim.db` from `challenge/dataset/brim_ap_dataset/data/*.csv` and processes the 59-email AP inbox. `npm run seed` rebuilds from scratch; so does Admin → System → Reset demo.

Optional env: `GEMINI_API_KEY` (LLM fallback; without it the text parser still handles every text PDF), `GEMINI_MODEL` (default `gemini-3.5-flash`), `LLM_BUDGET_USD` (hard per-process cap, default 1.5), `DATA_DIR`, `SESSION_SECRET`, `AS_OF_DATE`.

Deploy: `Dockerfile` at the repo root; Railway service with a volume at `/data`.

## Architecture

```
app/
  server/
    index.js          boot: seed if empty, process inbox, serve API + built client
    api.js            REST routes; each declares its capability, then re-checks scope + separation of duties
    policy.js         RBAC: capability matrix, row-level scope, approval & release decisions, HMAC tokens
    db.js             node:sqlite, schema, WAL
    seed.js           CSV -> tables; approval_policies.csv prose -> structured editable rules
    services/
      extract.js      pdf.js text -> deterministic EN/FR parser -> Gemini fallback (cached by file hash)
      ingest.js       email classification, file -> draft bill, recompute (checks + routing)
      vendors.js      vendor resolution, lookalike / duplicate vendor records
      coding.js       GL + department suggestions learned from history, with reasons
      checks.js       tax by province, arithmetic, vendor, bank, PO, contract, dates, duplicates, splits
      routing.js      approval chain from policies: thresholds, delegation, self-approval, one-person-one-step
      payments.js     prepare / release / settle, virtual cards, EFT batch file
      recon.js        bank statement <-> payments, explanations for leftovers
      reports.js      journal export, spend analytics, plain-language Q&A
      insights.js     approval recommendation, best day to pay
      audit.js        append-only, hash-chained audit log
  client/             React + Vite + Tailwind, one screen per job
  test/               node:test suites (RBAC, checks, routing, payments, audit, extraction)
  cache/llm/          committed Gemini results for the sample scans (fresh deploys make zero API calls)
```

One Node process, one SQLite file. The client never decides anything: it reads the user's capability list from `/api/me` only to choose what to show, and every action is re-authorised on the server.

## The nine required features

| # | Feature | How it works | Where |
|---|---|---|---|
| 1 | Intake | `processInbox` classifies each email (invoice / payment question / missing attachment / statement / marketing). Each attachment becomes a draft bill. Payment questions get a suggested reply built from the payment record ("Invoice 1743 was paid on … ref …"). Uploads (single or bulk) and a full mailbox import (`emails.json` + files) use the same pipeline. | `services/ingest.js`, Inbox page |
| 2 | Extraction | PDFs: pdf.js text in **content-stream order** (the visual layout of these invoices is deliberately scrambled, the stream order is not), then a label-driven EN/FR parser (`Facture n°`, `Échéance`, `TPS/TVQ`, `1 014,18 $`). The result is accepted only if every key field is present **and** lines = subtotal and subtotal + tax = total. Otherwise, and for scans/images, Gemini reads the text or the image and returns JSON; results are merged field by field and every decision is written to the capture notes. Taxes map to the provided codes (HST13, GST5, QST9975, PST7_BC, EXEMPT, FOREIGN). | `services/extract.js` |
| 3 | Smart coding | Each line gets a GL + department from three explainable signals: this vendor's past coding, the k most similar past descriptions (token overlap), and the vendor default GL. The reason is shown ("12 of 12 past Polar Freight lines were coded 5010; closest past line …"). Accept or change per line; changes are stored as `coding_source='human'` and immediately become training data. Leave-one-invoice-out on history: **GL 100%, department 92%** (Admin → System). | `services/coding.js` |
| 4 | Validation & matching | Vendor master (unknown, pending, on hold, GST number mismatch, lookalike record), bank details on the invoice vs master, unverified/recent bank changes, sender domain, PO (missing when required, wrong vendor, closed, over remaining balance), contract (fixed fee, hourly cap, fuel-surcharge cap, monthly not-to-exceed, expired), **tax by place of supply** (ON HST 13%; QC GST + QST 9.975%; BC GST + PST 7% on goods only; others GST; foreign = none; insurance exempt), line/subtotal/total arithmetic, dates (future, stale, due before issue, terms). Every flag says what's wrong, the numbers, and what to do. | `services/checks.js` |
| 5 | Duplicates | Same file hash; same vendor + normalised number (`INV-00734` = `734`); re-sent with a suffix (`000903-A`); same amount within 10 days under another number; the same across lookalike vendor records that share a bank account; **already paid by Brim card** (virtual-card payment linked to the same invoice number, or an employee-card charge at that merchant for the same amount around the date). Split invoices (same vendor, a week, each under the limit, together over) are routed as one. | `checks.js#duplicateChecks`, `splitCheck` |
| 6 | Approval workflow | `approval_policies.csv` is translated into structured rules (bands, chains, flags) that the controller edits in Admin; a simulator shows who would approve. Routing applies amount tiers, Legal and new-vendor steps, PO-over-balance, flagged invoices → finance manager, delegation (recorded as *on behalf of*), self-approval → manager, terminated → manager, and never the same person twice. Invoice, coding and approval history are on one screen. | `services/routing.js`, Admin |
| 7 | Payments | AP prepares (method + date suggested), a finance manager (≤ $100k CAD) or controller (any) releases. The releaser can't be anyone who requested, prepared or approved the invoice. EFT settles on the scheduled date and posts a bank-statement line; virtual card pays instantly for the exact amount. Bank details are snapshotted at preparation and re-checked at release. Payments dashboard + CPA-005-style EFT batch file. | `services/payments.js`, Payments page |
| 8 | Audit trail | Every action (including denied attempts) is appended to `audit_log`; each row's SHA-256 covers the previous row's hash, and SQLite triggers reject UPDATE/DELETE. The audit page verifies the chain, exports CSV, and traces each payment to its invoice, approval chain and GL coding. | `services/audit.js`, Audit page |
| 9 | Vendor management | Vendor master with masked bank details, onboarding (from an invoice, prefilled) as `pending_review` until a *different* finance manager approves, hold/lift. Bank-detail changes are a three-step controlled action: AP logs the request (risk-scored), someone calls the vendor on the number on file, a finance manager who didn't request it approves. Duplicate/lookalike vendor records are listed with an explanation. | Vendors page |

## Bonus features

- **Bank reconciliation**: 354 statement debits, 94% matched to payments by reference, then amount + date + payee; every leftover is explained (bank fee → GL 7010, pre-authorised debit with no invoice, unmatched cheque) plus payments not yet on the statement.
- **Plain-language spend Q&A**: Gemini turns the question into a typed query spec (metric, filters, grouping, dates); the server validates it and runs parameterised SQL. The model never writes SQL. A rule parser answers if the LLM is unavailable. Approvers only ever query their own department.
- **Approval recommendation** with reasons (open flags + how the amount compares with this vendor's history).
- **Best day to pay**: takes early-payment discounts when worth it (2/10 net 30 = 37% annualised), otherwise pays as late as terms allow minus rail lead time, never on a weekend; card vendors go on a virtual card.
- **Bank-change fraud alerts**: risk score on every change request; unverified changes block payment; lookalike sender domains and impostor vendor records are flagged.
- **Journal export**: balanced double-entry CSV (expense by GL and cost centre, recoverable GST/HST and QST to 1160/1165, non-recoverable BC PST into cost, AP 2100, payments with FX difference and discounts).
- **Virtual-card pay**: single-use card for the exact amount, recorded as a card transaction.
- **Past duplicate payments**: scans the 10-month history: 4 bills paid twice ($14.3k) plus AP bills an employee had already charged to a card.
- **Spend analytics** by month, vendor, category, GL and department, with budget burn, plus Brim card spend (employee cards vs AP virtual cards) next to AP.
- **Approve from a phone**: the approval queue and invoice screen are responsive, with one-tap approve for clean bills.

## What the sample batch shows

56 attachments from 59 emails → 56 bills (3 emails ignored or routed: marketing, statement, missing attachment; 1 payment question answered). 25 went straight to approval (no issues, ≥ 90% capture confidence). Among the rest: 4 exact duplicates of paid history (one also paid by card), a re-sent `000903-A`, HST charged on an Alberta delivery, missing QST on a Québec delivery, PST charged on services, a 24 × $150 line billed as $3,800, a total that doesn't add up, fuel surcharge 22% vs a 12% cap, fixed-fee contracts billed above price, an expired contract, three Orion invoices on one day split under the $10k limit, an unverified emailed bank change on Cascadia, the "Harlow and Stern LLP" lookalike vendor record (different GST number, address and bank), two unknown vendors, an invoice dated in the future, credit notes, USD invoices, and PO-required vendors with no PO.

## Generalisation check (unseen layouts)

To test against invoices the parser had never seen, we generated 12 synthetic invoices. They used new layouts and wording: "Bill Number", "Amount Due", quantity-first tables, two-page bills, credit memos with `(660.00)` amounts, bank details on separate lines, a fully French bill and two noisy PNG scans. Each carried a planted issue.

On the deployed app, **12 of 12** came out right:
- **The planted issues were all caught**: wrong tax, line arithmetic, USD, closed PO and over balance, changed bank details, price above contract, credit applied to the original invoice, and an unknown vendor.
- **The clean bills raised no flags.**
- **The 2 scans were read by Gemini vision.**

The first run found 7 gaps; they're fixed and covered by `test/extract.test.js`.

See `JUDGE_QA.md` for the design defence and `DEMO.md` for the 3-minute script.
