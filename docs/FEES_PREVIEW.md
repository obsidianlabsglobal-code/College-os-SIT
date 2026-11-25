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

## The operator experience

Separate the normal path from exceptions. The operator sees the received amount, suggested allocation, resulting balance and exact reason if a row needs review. A title does not confer finance access: a faculty member, HOD or staff member may be formally designated with a named, scoped and revocable grant. The fictional operator can rehearse partial and split allocation and see why a duplicate or unmatched amount is stopped. Preview confirmation does not post or persist a transaction.

The next production increment is a reviewed import from an SIT-approved ledger: map stable student IDs (unmatched IDs become exceptions), enforce uniqueness and idempotency at the authoritative store, show the before/after effect, and require approved posting and an immutable audit record. Corrections should reverse or adjust entries, never silently overwrite them. Define how waivers, refunds, unallocated credit, instalments, term transitions and reconciler sign-off work with SIT before enabling each. Use the same pattern across attendance corrections, lab scheduling conflicts, and academic approvals: one simple action, a review queue for exceptions, and a traceable outcome.

### Batch rehearsal

The signed-in fictional operator can load one built-in CSV, review the ready rows and exceptions, and demonstrate an allocation correction. The importer validates the whole file, uses stable sample student keys, flags both sides of same-channel duplicate references, and projects balances in source order without writing to the ledger. A correction keeps the original line and records its reason with the proposed revised allocation; it cannot change the received amount or silently match an unknown student. Preview and correction history are browser-memory only; they are not durable audit records. No upload control or posting exists. A production import needs separately authorized inputs, attribution, persistence, locking/revalidation, unique transaction IDs, and independent posting policy.

### Durable approval rehearsal

The dedicated signed-in fictional office profile submits exactly one server-generated corrected example. PostgreSQL stores its original allocation, correction reason, projected balance, evidence fingerprint and submitting account. A separate designated fictional HOD profile reviews that exact fingerprint and confirms it; the database rejects approval by the submitter and duplicate approvals. Existing membership and fixture authorization are checked again at the write. The runtime can only insert or read these review tables, not edit or delete past evidence. The independent approval is approval of the rehearsal, not of a charge or payment.

Use a fresh fictional database to repeat the same template from the beginning. Approval of the five-row practice batch is not supported. This milestone still intentionally has no production finance grant directory, import endpoint, posting command, payment gateway or real ledger.
