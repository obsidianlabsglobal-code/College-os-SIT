# Progress

## November 21, 2026

- Implemented Release 1 application code for five role workspaces, academic administration, assignments and feedback, notices, enrollment-letter requests, and scoped reporting. PostgreSQL persists workflow state and mutation audits.
- Verified production compilation, restricted runtime database permissions, clean migrations with a repeat run, and local PostgreSQL persistence after restart. The PostgreSQL integration and Chromium release journeys passed with fictional accounts. See the test report for exact coverage.
- Independent review found that form sign-in used an in-process API that bypassed HTTP throttling. Form and API sign-ins now share PostgreSQL-backed limits, verified through Chromium.
- Prepared a GitHub Actions verification workflow and a manually dispatched Vercel release-candidate workflow. Vercel with managed PostgreSQL was selected by the product owner. The GitHub repository lists no release environment. A Vercel project, release alias and database connections are required for hosted verification.
- User validation, official SIT authorization, hosted backups, restore rehearsal, storage scanning, and institutional privacy and academic policy verification remain open. The first release uses fictional accounts until those gates are met.
- Next release work is staging deployment, a hosted acceptance run, and recovery rehearsal. Release 1.1 starts after the first release is stable.

November 22 delivery integration fast-forwarded experience → CLUBVERSE → deterministic AURA without conflicts. On a fresh local database migrations 000–009 applied and a second pass made no changes. Nine PostgreSQL tests, seven Chromium journeys, lint, typecheck and production build passed before the academic workspace increment. Release 1 was also built separately at e5d507d. The two-stage acceptance runner exercised five roles and denied two unrelated personas. Following a clean shutdown, the fictional database was copied to an isolated instance. The seven migration entries and 12 audit events matched. Fresh sessions on the restored app read the same private file bytes, grade and resolved request. One early replay hit the shared sign-in rate limit; a later run passed without bypassing it. Managed backup, hosted verification and model access remain outstanding.

The registry now tracks 477 permanent IDs. Wave 2 course workspaces at 584c31c use the roster and scheme tables. Fictional-data Chromium journeys went from seven to eight passing tests. The institutional catalog directory, resources, attendance, timetable and faculty grading queue remain separate requirements. Course workspace code stays on its own branch.
