# Progress

### November 23 · Academic and AURA runtime integration

Reconciled the academic branch at 72d33c6, Claude runtime at 89f4cd8, and main at 5af9797 on integration/aura-academic-runtime. The new composer reads real academic data and keeps the approved deterministic CLUBVERSE workflow. Academic tool results refresh against live grants when reopened. Explicit consent gates free-text provider transfers. Duplicate requests share one operation, and a failed proposal-to-preview link rolls back its draft preview. The fixed-topic pilot remains available where free-text model mode is off.

Local verification used a fictional PostgreSQL database. Migrations applied and reran, lint, typecheck, production build and all 34 service tests passed. All 20 ordinary Chromium journeys plus a separate mobile tutor provider-contract journey passed. Three focused AURA journeys also passed during screenshot capture in docs/evidence/aura-academic-runtime. No paid inference or hosted verification was performed. 480 original registry IDs are preserved.


## November 21, 2026

- Implemented Release 1 application code for five role workspaces, academic administration, assignments and feedback, notices, enrollment-letter requests, and scoped reporting. PostgreSQL persists workflow state and mutation audits.
- Verified production compilation, restricted runtime database permissions, clean migrations with a repeat run, and local PostgreSQL persistence after restart. The PostgreSQL integration and Chromium release journeys passed with fictional accounts. See the test report for exact coverage.
- Independent review found that form sign-in used an in-process API that bypassed HTTP throttling. Form and API sign-ins now share PostgreSQL-backed limits, verified through Chromium.
- Prepared a GitHub Actions verification workflow and a manually dispatched Vercel release-candidate workflow. Vercel with managed PostgreSQL was selected by the product owner. The GitHub repository lists no release environment. A Vercel project, release alias and database connections are required for hosted verification.
- User validation, official SIT authorization, hosted backups, restore rehearsal, storage scanning, and institutional privacy and academic policy verification remain open. The first release uses fictional accounts until those gates are met.
- Next release work is staging deployment, a hosted acceptance run, and recovery rehearsal. Release 1.1 starts after the first release is stable.

November 22 delivery integration fast-forwarded experience → CLUBVERSE → deterministic AURA without conflicts. On a fresh local database migrations 000–009 applied and a second pass made no changes. Nine PostgreSQL tests, seven Chromium journeys, lint, typecheck and production build passed before the academic workspace increment. Release 1 was also built separately at e5d507d. The two-stage acceptance runner exercised five roles and denied two unrelated personas. Following a clean shutdown, the fictional database was copied to an isolated instance. The seven migration entries and 12 audit events matched. Fresh sessions on the restored app read the same private file bytes, grade and resolved request. One early replay hit the shared sign-in rate limit; a later run passed without bypassing it. Managed backup, hosted verification and model access remain outstanding.

The registry now tracks 477 permanent IDs. Wave 2 course workspaces at 584c31c use the roster and scheme tables. Fictional-data Chromium journeys went from seven to eight passing tests. The institutional catalog directory, resources, attendance, timetable and faculty grading queue remain separate requirements. Course workspace code stays on its own branch.

November 22 faculty command center (feature/faculty-command-center, separate from main): the faculty home now answers what needs attention from PostgreSQL records — submissions awaiting evaluation with the oldest waiting time, feedback drafts awaiting publication, unpublished assignments including ones whose deadline passed before publication, per-assignment submission and evaluation progress, and the next five deadlines. A new evaluation queue filters by status, course and assignment, sorts by submission age, deadline, student or publication time, and paginates. Each row opens one submission in the existing grading form with a link to the next one awaiting evaluation. No migration and no new write path. FC-001 and FC-011 are tested with fictional and labelled synthetic data; no faculty member has used them.

Follow-up on PR #3: review corrections at 0f2e056 bounded the large-assignment and focused grading reads and added a searchable assignment picker. Local verification found and fixed a test that only worked with CI's environment and left fictional records in the demo course. An automated accessibility scan of the faculty pages found no violations. Faculty use, hosting and a current-term definition remain open.
## November 22 master plan

GitHub main is f62828f with CI 45005295131. PRs #1 and #2 are merged. PR #3 remains open at d9550af with CI 45013323182. The [independent review](FACULTY_PR3_REVIEW.md) records blocking read-volume and assignment-discovery issues. No parallel Experience 2.0 branch was visible. GitHub showed zero release environments, zero deployments and no release-workflow runs.

The pinned main revision built and accepted all five fictional roles locally. Ten migrations applied and verified on rerun. Browser acceptance checked denied section and tenant access, exact private file content, published grades, request resolution and aggregate reports. Hosted Vercel verification and managed recovery remain outstanding.

The [resource booking slice](RESOURCE_BOOKING.md) adds CL-035 and OP-008 evidence on its dedicated branch. All 477 original IDs survive. SA-023, GU-012 and CR-037 capture distinct master-plan requirements.

## November 23 · Student Today integration candidate

Main at 65d38cc contains Faculty Mission Control. integration/student-today reconciles booking PR #4 and experience PR #5 on a separate branch. All 477 main registry identifiers and the three additional booking-branch identifiers are present. The student priority opens a scoped assignment, falls back to published feedback or leads to active courses. Local production verification passed 17 database tests, 15 Chromium tests and the five-role release exercise with post-restart verification. GitHub had zero deployment records and zero release environments at inspection. [Screenshots and evidence](evidence/student-today/README.md).


## November 23 · Staging readiness

PR #6 merged at 030f7ed and main CI 45142587596 passed. Student Today now prioritizes the latest published feedback by the release timestamp for the student's own active roster. Draft corrections retain the prior published timestamp until release. The 480 feature IDs remain in the registry. Assignment summaries read metadata for every published assignment across the active roster and render the full list. Before scaling to long-lived offerings, measure typical row counts and load time, then add a bounded preview with a route to complete history. Term-only filtering can hide a result just released for an earlier term. No benchmark on institutional data exists.

GitHub reported zero deployments. Creating the release environment returned HTTP 403 for the existing integration. The staging account steps are in [Deployment](DEPLOYMENT.md). Hosted HTTPS acceptance, persistence after redeployment, and managed backup recovery require provider access.

### November 23 · Verified opportunity directory

Branch feature/verified-opportunity-directory extends CR-001, CR-005 and CR-006. Fictional-data tests cover administrator publication, replay, withdrawal, expiry, active membership, cross-institution denial, type filtering, search and pagination. On the current main baseline 21 service tests and 18 Chromium journeys passed. The mobile and desktop student captures in docs/evidence/opportunity-directory show a fictional scholarship. A focused mobile check passed again after shortening the mobile navigation label. Official-source verification is a human responsibility. Hosted acceptance, provider feeds and student applications are pending.
