# 3-minute demo script

Live: https://web-production-c7f1b889.up.railway.app. Before the demo, as Marcus Webb, run Admin → System → **Reset demo** so the data is fresh. Switch users from the avatar menu (top right).

| Time | Who | Do | Say |
|---|---|---|---|
| 0:00 | Sign-in screen | Show the six role cards | "Harborline gets 50 bills a month by email. Every person gets the screens for their job, and the server enforces it." |
| 0:15 | **Jordan Okafor**, AP clerk | **Inbox**. Point at the badges: invoice / payment question / missing attachment / ignored. Open the Torque *"Where is payment"* email | "59 emails became 56 draft bills. The marketing email was ignored, and the payment question already has an answer from the payment record." |
| 0:35 | Jordan | **Home → Needs review**, highest risk first. Open **Cloudbarn INV-01561** | "Duplicate of a bill we already paid, and already paid on a Brim virtual card. Every flag says what's wrong and what to do." |
| 0:55 | Jordan | Open **Northbound #000639**, then scroll to **Lines & coding** and expand **Why** | "Delivered to Calgary but charged Ontario HST: tax is checked against the delivery province. GL coding is learned from history and shows its reasoning. Accept it, or change it and the model learns." |
| 1:10 | Jordan | Open **Harlow and Stern LLP #HA26-2766** | "Impostor vendor record: the name looks like our law firm, but the GST number, address and bank are different. Only a finance manager can clear a fraud flag." |
| 1:25 | Jordan | **Invoices → Needs review → Send all for approval** (clean bills) | "Clean bills go straight to approval." |
| 1:35 | **Elise Tremblay**, finance manager | **Approvals**. Note the *for Liam O'Connor* badge. Approve **Queen Street #002935 ($18,758)**, then open it | "Liam is on leave, so Elise approves on his behalf, and the audit trail records that. Because Elise is also the finance manager, step 2 escalates to the Controller so two different people sign." |
| 1:55 | **Marcus Webb**, controller | Approve Queen Street | Fully approved. |
| 2:00 | Jordan | **Payments → Ready to schedule**: point at **Best day**. Schedule Queen Street | "We pay on the last good day the terms allow, or early when a discount is worth it. 2/10 net 30 is a 37% annualised return." |
| 2:15 | Elise | **Payments → Awaiting release → Release** Queen Street | Blocked: *"You approved this invoice…"*. Separation of duties is enforced on the server. |
| 2:25 | **Priya Raman**, CFO | Release it | Released by simulated EFT. A card vendor would get a single-use virtual card instead. |
| 2:35 | Priya | **Spend**: ask *"What did Operations spend on freight last quarter?"* | "Gemini turns the question into a query spec, and we run it ourselves. The model never touches SQL." |
| 2:45 | **Hannah Lindqvist**, auditor | **Audit trail**: *hash chain intact*, **Payment trace**, **Past duplicate payments** | "Every action is hash-chained and exportable, and each payment traces back to its invoice, approvals and GL codes. Running our duplicate logic over the history found $14k paid twice." |
| 2:55 | — | — | "Upload any new invoice and it goes through the same pipeline." |

**Backup if asked:**
- **Admin → Approval policies**: change a band, then use *Who would approve?* to show the new route.
- **Vendors → Bank changes**: the Cascadia change requested by email with no callback blocks its invoices.
- **Reconciliation**: 94% of bank lines are auto-matched, and every leftover is explained.
- **Early-payment discount**: once Grace Mbeki approves Paper Trail #2217 (2/10 net 30), Ready to schedule shows that its discount window closed on Nov 5, which is money the old process left on the table. A freshly dated 2/10 invoice gets "Pay by … to take the 2% discount".
- **Upload a hidden-batch file** from Inbox → Upload invoices, or import `emails.json` with its attachments via Import mailbox.
