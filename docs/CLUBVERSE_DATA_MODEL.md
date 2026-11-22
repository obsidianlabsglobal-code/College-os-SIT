# CLUBVERSE data model

Migration 007 adds category and template reference tables and tenant-qualified proposal, recognized club, member, scoped grant, handover, event and registration tables. Recognized clubs link to the approved proposal. Each event links to exactly one club. Each registration links to one event and user. Verification timestamp, verifier and written evidence must be present together.

Composite keys keep parents in the same institution. Active-grant and single-lead indexes support safe delegation. Proposal and event revisions protect transitions from stale writes. The club row lock serializes its sensitive changes, and registration also locks the event while checking capacity. Audit events reuse the NEXUS append-only table and commit with the domain operation. This slice retains the current membership status plus audit events. A richer per-member timeline and scheduled officer terms remain future work.
