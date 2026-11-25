# Test report

## November 21, 2026

| Check | Evidence |
| --- | --- |
| Lint and type check | `npm run lint` and `npm run typecheck` |
| Production build | `npm run build` compiled all workspaces and routes |
| PostgreSQL migrations | Applied all seven migrations to a clean database and reran without pending changes |
| Restricted-role integration | Four tests via `npm test` exercised assignment state, cross-tenant and section permissions, duplicate and late submissions, unpublished feedback, grade revisions, concurrent writes, revoked access, notice scope, service requests, and transactional rollback |
| Chromium end to end | Four journeys passed against the production build with fictional accounts. Covered assignments and feedback, a disconnected submission response, scoped notices, an enrollment-letter request, principal reporting, administration, keyboard navigation, a mobile viewport, and sign-in throttling shared by the API and browser form |
| Persistence | Stopped and started PostgreSQL against the same local data directory. Assignment, submission, published grade revision, and audit counts matched |
| Dependencies | `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities at the time of the run |

Earlier browser runs identified an HTTP status issue on streamed denials and an empty optional file that the multipart parser presented as an upload. The route now authorizes before sending its response and accepts an empty generic file field as absent. The browser also verified that admin role and roster changes work against the database.

Hosted smoke tests, production monitoring, backup restore and institutional user validation require access to the release environment.

## November 22 integration and course workspaces

Release 1 e5d507d ran in a separate detached checkout with its seven migrations. Using fictional accounts, the acceptance runner exercised an academic submission, draft privacy, publication, private byte-for-byte file download, scoped denials, an enrollment-letter outcome and leadership reports. Restoring a stopped local database into a new directory and starting a separate server preserved seven migration entries, twelve audit events and the run-specific records. The restored runner passed with the same run ID. Local restore does not validate the managed backup service. Vercel protection-cookie handling and the hosted alias remain untested.

Integration 73816fb passed GitHub CI 45001106510. On the separate academic feature at 584c31c, a fresh database applied migrations 000–009, then verified checksums on a second pass. Fictional seed, lint, typecheck, production build, nine PostgreSQL tests and eight Chromium tests passed locally. The student opened the course by keyboard on a 390 px viewport, an unrelated section received 404, and an ended roster lost course access. The assignment journey now enters through the course. Screenshots were inspected at 390×844 and 1440×900. User validation remains open.

## November 22 faculty command center

Branch feature/faculty-command-center on a fresh local database (migrations 000–009, second pass unchanged, fictional seed). Lint, typecheck and production build passed. `npm test`: 15 PostgreSQL tests passed, including six new faculty tests covering state transitions from submission through draft, publication and correction; draft versus published separation; pagination without overlap, out-of-range pages and hostile filter values; co-instructor sharing; denial for unrostered faculty, another institution, another role selection, a forged student scope, an ended membership and an ended roster; focused submission reads; withdrawn students counted apart from enrolled submissions; tab totals matching filtered lists; and unpublished counts unaffected by display limits. Removing either the membership or the roster `ended_at` guard made the authorization test fail. The faculty and Release 1 suites also passed under Node 24.22.3; the container default was Node 22.

Chromium: 10 tests passed, including two new faculty journeys — create and publish from mission control, student submission, queue navigation by keyboard, draft persisted after reload, publication, published filter, 390 px layout, 404 for student and forged roles, unrostered faculty and another institution, and malformed filters falling back to defaults.

Manual visual review used a separate synthetic load (240 synthetic students, about 345 submissions in mixed states) at 1440×900 and 390×844. Server render times were 60–150 ms per page locally; this is not a load test. Review found and fixed missing spacing in status counts, a redundant state tag in the single-state queue view, and inconsistent row alignment in the large-assignment list. User validation, hosted verification and accessibility review with assistive technology remain open.

An independent review of the diff by a separate agent found no tenant or injection defects and confirmed the scope and grade-state derivation. It did find statements the interface could make untruthfully: submitted counts that included withdrawn students and could exceed enrollment, "every assignment is published" computed from a 100-row list, and status counts that ignored active filters. These were fixed and covered by tests, as were filter contradictions and a lower page cap. Open review items: keyset pagination and term scoping for long teaching histories, and the large-assignment list still loading every submission body. Screenshots are in [evidence/faculty-command-center](evidence/faculty-command-center/).

### PR #3 review corrections

Regression fixtures cover a 23-submission compact assignment, 205 higher-ranked unsubmitted drafts, and a title search with 28 results across two pages. Compact previews read bounded student names and status flags. The focused view reads only the selected submission and its attachment metadata alongside assignment instructions. Assignment options are filtered before pagination and retain an authorized selection outside the current results. Invalid and out-of-range queue pages offer explicit recovery without changing filters. A pending correction appears in both relevant queue tabs and leaves the student's published result visible until publication.

Local PostgreSQL tests also verify that unrelated faculty and tenants cannot read the preview or picker records. The browser exercise covers keyboard focus and activation, mobile compact and focused grading, title-search selection, and queue widths from 360 to 1440 px. Broad filters still use count and offset pagination. No production-size query benchmark or assistive-technology audit was conducted.

### Follow-up verification at 0f2e056

GitHub CI passed for 0f2e056. Run locally against .env-configured PostgreSQL, the new compact-assignment browser test failed before reaching the application because it read `MIGRATION_DATABASE_URL` without loading `scripts/environment`, which CI's exported variables had masked. It now loads the environment like the release journeys, and it deletes its 23 fictional learners, submissions, attachments and assignment afterwards so repeated local runs do not fill the demo faculty queue; a query confirmed none remained. After the fix: lint, typecheck and build passed, 16 PostgreSQL tests and 11 Chromium tests passed.

An automated axe-core 4.10 scan (WCAG 2.0–2.2 A/AA rules) of mission control, four queue states including title search and an invalid page, the focused grading view, the compact 210-submission list and the course page reported no violations at 1440×900 or 390×844. The same scanner flagged injected contrast and missing-label defects, confirming it ran. Automated rules cover a subset of WCAG; a screen-reader and keyboard audit by a person is still outstanding.

### November 23 · Release acceptance on current main

A production build of 5af9797 ran locally against a freshly migrated and seeded PostgreSQL 18.7 instance. The release operator runner exercised faculty publication, student submission, draft privacy, feedback publication, a resolved enrollment-letter request, department and institution reporting, and scoped attachment downloads. The same run passed after a database restart and through a separate app connected to a restored copy. All 12 migration names and checksums and the audit, attachment and booking counts matched at restore time.

The updated runner additionally checks the exact persisted submission and feedback text and opens direct assignment URLs as two unrelated personas. During repeated exercises it hit the expected sign-in throttle. It now waits one configured window and retries a throttled sign-in once. The authenticated runner uses the ordinary login form throughout. The GitHub acceptance workflow defaults to verifying an existing run and can be dispatched for the fictional staging host after its environment is provisioned. Hosted HTTPS, provider-native backup recovery and Vercel deployment protection are pending.

### November 24 · Dedicated-target controls and AURA academic lookups

Local verification used Node 24, PostgreSQL 18.7, a restricted runtime login and fictional records. All 16 migrations applied and a second pass made no changes. Lint, type checking, the production build and the production dependency audit passed. An initial type error in the target validator's test environment signature was corrected before the final run.

| Check | Result |
| --- | --- |
| `npm test` | 37 passed, including PostgreSQL workflows, connection configuration rejection, current permissions and pending work disappearing after submission. |
| `npm run test:e2e` | 21 Chromium journeys passed, including mobile, keyboard and academic-day AURA navigation. |
| `npx playwright test --config playwright.tutor.config.ts` | One isolated provider-fixture journey passed. No external model calls. |
| Release acceptance | The five-role production-build exercise passed. A separate app process against an offline restore passed verify with the same run ID, `nov24-nexus-allowlist`. Verified scoped assignment and private file denial, exact feedback and file content, published grade and resolved request. |
| Local restore | Compared all 16 migration names and checksums plus audit (8), attachment (1) and resource booking (0) counts before restored-instance sign-in. |
| Pending work query | On a separate local fictional dataset containing 3,200 added assignments (3,000 expired), 30 serial warm reads returned 11 rows per query, median 5.36 ms and p95 17.92 ms. This measures the service on one local dataset. |

Hosted HTTPS, managed pooling and TLS, Vercel redeployment, provider-native restore and institutional user validation remain pending.

### November 25 · Living Atmosphere

Candidate `5e7b0a9` passed lint, TypeScript, production build, and 38 PostgreSQL and service tests. A fresh PostgreSQL 18 database applied all 16 migrations, reapplied the migration command with no pending files, and seeded fictional records. The production dependency audit reported zero vulnerabilities. The local release acceptance script verified all five roles, section and tenant denials, exact private file content, published grades and the resolved request through a new application process using the same database.

The [visual evidence](evidence/living-atmosphere/README.md) includes the 72 authenticated candidate captures, 20 baseline captures and lab measurements. An axe-core 4.10.3 scan reported zero rule violations across 20 light and dark route/theme combinations. Field Core Web Vitals and manual assistive-technology acceptance are open.

A local rerun exposed a hydration race on mobile More after navigating back from a notice. Interactive menus, sheets and theme controls now wait for hydration. The follow-up passed all 22 standard Chromium tests and the one isolated tutor-contract test. A final table CSS adjustment leaves column headings and department names readable within the horizontally scrollable region.

The 72 candidate captures from `57669bf` had no page-level horizontal overflow or browser exceptions. Local LCP was 48–420 ms with a 100 ms median and no recorded layout shift through capture. Decoded route JavaScript ranged from 471,776 to 476,848 bytes. The same candidate passed the five-role release verification against an isolated PostgreSQL 18 copy restored from a stopped fictional cluster. Managed backups and hosted redeployment still require provider verification.
