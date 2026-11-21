# Decisions

- Use a modular monolith and relational PostgreSQL. The first workflows use joined records and transactions. Revisit topology when measured performance or isolation requirements justify it.
- Use Better Auth and persisted sessions. Resolve institutional grants inside application services and maintain a separate migration identity.
- Keep small release-candidate attachments in PostgreSQL behind a storage boundary. File and audit writes roll back together. Bound payload size to 4 MiB for the Vercel Functions request limit and prepare private object storage and scanning before institutional rollout.
- Reject late submissions and permit one final submission in Release 1. Verify extension and resubmission requirements with the pilot before adding policy.
- Preserve published grade versions while corrections are drafted and retain superseded draft revisions. Lock grade writes by submission and reject stale revision numbers.
- Target Vercel with managed PostgreSQL per the product owner's selection. Require protected staging and separate migration credentials.
