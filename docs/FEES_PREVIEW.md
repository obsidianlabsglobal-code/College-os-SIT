# Fees & Dues: fictional prototype and release boundary

Institution Office / Finance requested college, transport, hostel and other fees. The prototype is off by default and is read-only. It accepts only the existing fictional Northfield demo workspace and the matching sample student, department-head, institution-admin and principal personas. No real financial store, receipts, checkout, notice or payment integration exists. The sample student balance (INR 14,000) matches the HOD briefing. The admin preview is a demonstration of aggregate office visibility, not an office-finance grant.

| Viewer | Proposed production access |
| --- | --- |
| Student | Own line items, category, billing period, verified credits, balance, due date and status |
| HOD | Scope-checked department aggregates by category and term; no student details by default; small-group privacy rules |
| Principal or designated leadership | Institution aggregates only by default |
| Office finance staff | Explicit institution or unit grant for ledger operations and scoped reconciliation; ordinary staff, faculty and generic admin roles do not imply access |
| Transport / hostel finance operator | Only authorized charge categories if SIT elects to grant this, not the full account |
| Parent or guardian | No default access; require verified relationship, institutional approval and explicit data scope |

Before a real release: agree on SIT's source-of-truth finance workflow, cohort and reconciler; build integer-minor-unit, institution-scoped ledger and payment-allocation records with immutable references, adjustment approvals, authorization checks and audit trails; prevent duplicates and reconcile verified credits with receipts; agree on access review, retention, dispute handling, and minimum aggregate cohort size. Do not ingest any actual fee amounts or enable collection before authorization.
