# NEXUS engineering ledger

Single continuation record for Claude Code sessions. Newest entry first. Keep entries short; link evidence.

## Sources of truth
Registry `docs/NEXUS_MASTER_FEATURE_REGISTRY.md` → [matrix](NEXUS_TRACEABILITY_MATRIX.md) (regenerate: `python3 scripts/traceability.py --suites-passed`).
Founder specs (not in repo): Master Handoff PDF, Engineering Reference Pack ZIP, UI/UX Design Bible PDF (58 pp.). Bible essentials:
- Tokens: porcelain #F9F7F3, ink #25232E, violet #6E54B7, lavender #EAE2F6, mint #DDEFE6, sky #DCEAF5, apricot #F8E5D2, rose #F1DCE4; success #316B51, error #A03F48; dark canvas #171720 / surface #22232D / elevated #2C2D38 / text #F4F1F6 / muted #B7B4C0 / accent #B7A4F4.
- Type: Inter/system sans, optional editorial serif for AURA/hero, tabular numerals. Radii: controls 10–12, cards 16–20, hero 24–32, pills 999. Spacing 4/8 rhythm.
- Student dock: Today, Learn, AURA, Campus, Profile. Staff: sidebar + command palette + action inbox.
- Motion: press 80–140 ms scale .98; tabs 160–240; card→detail 280–420; sheets 240–360; springs 500/38, 360/30, 260/25. Reduced-motion fallbacks.
- Signature: Orbit entry, Adaptive dock, Bento unfold, Evidence reveal, AURA action capsule, Live route pulse, Knowledge constellation.
- Charts: SVG default, Canvas dense, data contract (question, measure, provenance, quality state, interaction).
- First slice: Student Today + timetable + attendance + AURA action capsule.
- Automation: 90% = eligible manual-minute reduction vs frozen baseline; L0–L4 authority; outbox + worker.

## Entries
### 2026-11-27 — Audit checkpoint (branch `audit/nexus-engineering-audit`, base `main` c0902ae)
- Audit: [NEXUS_ENGINEERING_AUDIT.md](NEXUS_ENGINEERING_AUDIT.md). 47/47 PostgreSQL, 24/24 Chromium, 1/1 tutor; 0 axe violations; permission probes clean.
- Coverage: 63 tested, 8 implemented-unverified, 6 partial, 13 blocked, 390 missing.
- Defects queued: invisible admin active nav label; seed-walkthrough migration count; missing classes-needed maths; duplicate model ledgers; partial CSP.
- Next: Design Bible token foundation + Student Today slice; fix defects; Ponytail review.

### 2026-11-27 — Design Bible foundation + Student Today slice (same branch)
- Ponytail 5.3.3 installed (user scope, this container only; hooks local-only, webhook empty). Rules applied manually this session.
- Fixed: invisible active secondary nav (all roles, desktop); walkthrough seed migration-count check.
- Tokens: Bible palette light/dark via existing variable names (one change restyles every screen); sans display type, editorial serif only for hero; violet active rail.
- Student Today (SA-001, SA-006, SA-008): violet next-class hero; attendance ring with exact counts; per-course bars with target marker and deterministic "attend next N" (`lib/attendance-math.ts`, exhaustive test incl. 130/150→50 at 90%).
- Dock (Board 02): student order Today, Timetable, AURA (raised centre), CLUBVERSE, More. "Learn" label withheld until a learning studio exists.
- AURA action capsule (AI-006/007): persisted-state track Proposed → Preview → Approval → Saved; read track Understood → Checked → Answered; no optimistic steps.
- Verified: 49/49 PostgreSQL; affected Chromium suites pass in CI order; axe 0 violations light (88 pages) and dark phone (74 pages); no overflow. Evidence `docs/evidence/design-bible-slice-2026-11-27/`.
- Found: e2e tests depend on PostgreSQL suite data (academic-day next-class, atmosphere work list); fail on fresh seed alone or with walkthrough fixtures.
- Next: timetable Board 03 (segmented day/week, date strip, human dates, now marker, cancelled styling); chart kit; faculty/HOD/principal visual pass.

### 2026-11-27 — Timetable Board 03 (SA-009, FC-004)
- Day/Week segmented control, period stepper with readable dates, 7-day date strip with class dots, day-grouped time rail, explicit Now/Scheduled/Cancelled/Recorded/Draft states with change reasons, attendance rings with planning target.
- Same URLs, links and actions; e2e updated for the strip. academic-day e2e passes on fresh seed; fails when walkthrough fixtures add an earlier class (test assumes it owns the next class) — fragile test, not a product defect.

## 2026-11-27 — WP1 chart kit, first primitive
- Added `SegmentedBar` (`app/experience/segmented-bar.tsx`) with data contract `Segment` and validated widths in `lib/segments.ts` (rejects negative, fractional or over-total counts; unit test `tests/segments.test.ts`).
- Ordinal violet ramp `--chart-1..3` in `app/tokens.css` (light and dark). Colour is never the only cue: exact counts in the legend and in the accessible label; forced-colours fallback; reduced-motion gated.
- Applied to faculty assignment progress (published / awaiting publication / awaiting evaluation / not submitted), HOD department table (new "Results progress" column) and principal institution activity.
- Verified on fresh build: lint ✓, typecheck ✓, build ✓, PostgreSQL+unit 51/51, Chromium 24/24. Screenshots: `docs/evidence/chart-kit-2026-11-27/`.
- Not done: trend/line charts (no time-series data contract yet), hover tooltips beyond native titles, table view toggle.

## 2026-11-27 — Backend Blueprint (vol. 03) package 4: durable automation
Read all 55 pages of `NEXUS_Backend_Integration_and_Automation_Blueprint.pdf`. Reconciled with the repo rather than adding a parallel schema:
- **Transactional outbox.** The existing `audit_event` insert (already inside every domain transaction) fires trigger `audit_event_automation`, which enqueues one `job` per matching `automation_rule`. Domain code is unchanged, so UI, AURA and workers share the same services and the same event. A failed or denied write enqueues nothing.
- **Worker.** `scripts/worker.ts` (`npm run worker`, `--once` for cron-style runs) → `runJobs` in `lib/automation.ts`. Leased claim with `FOR UPDATE SKIP LOCKED`, per-job fenced transaction (lease token), pause check, deterministic handler, idempotent writes (`UNIQUE(institution, recipient, event)`), backoff with jitter, dead-letter after 5 attempts, heartbeat. No network calls inside transactions.
- **Rules (L3, deterministic).** assignment.published → enrolled active students; grade.published → the student (re-checks publication, so draft grades are never announced); service_request.submitted → active admins. Each handler re-reads current state and records `skipped` with a reason when stale or paused.
- **UI.** Student Today "For you" inbox with read state; admin home "Routed to you"; `/automation` Automation Centre (admin and principal read, admin pause/resume/retry) with honest worker status ("Worker not running … queued, not executed").
- **Measurement.** `automation_rule.baseline_minutes` stays NULL and the UI says "not measured yet". No time-saved figure is reported until a consented baseline exists (blueprint p. 17).
- **Providers.** Nothing provider-specific: plain Postgres with short transactions and no session-level locks in the worker, so it works with Neon or Supabase poolers. The worker needs an always-on process (e.g. Render background worker) or a cron running `npm run worker -- --once`. A Vercel request must not host it. No provider was used.
- **Verified (local, fictional data).** lint ✓, typecheck ✓, build ✓, PostgreSQL+unit 55/55 (new `tests/automation.test.ts`: atomic enqueue, roster-only delivery, tenant isolation, crash/expired-lease re-run without duplicates, pause, draft-grade privacy, dead-letter, admin-only retry), Chromium 26/26 (new `tests/automation.e2e.ts`), tutor 1/1. Live check: the background worker routed a UI-submitted request to the admin in 0.7–1.6 s. Evidence: `docs/evidence/automation-2026-11-27/`.
- **Registry.** AI-013, AD-023, SL-011 → Tested (qualified). Matrix: 63 tested, 9 partial, 8 unverified, 13 blocked, 387 missing.
- **Not done.** Cron schedules and missed-run policy, cancellation, email/WhatsApp channels, notification preferences, attendance recalculation (already computed on read, so no job is needed), the reusable workflow engine (AD-020), hosted worker.

## 2026-11-27 — Independent review mandate: checkpoint, branch recovery, automation hardening
- **Checkpoint.** Draft PR obsidianlabsglobal-code/College-os-SIT#17 (not merged, no auto-deploy).
- **Branch recovery.** The ten divergent branches form two chains. `feature/nexus-prepared-messages` contains faculty-timetable, campus-change-brief, ux-quality, sites-direction and attendance-workbench. `feature/nexus-fee-approval` contains fees-preview, reconciliation and batch-review. Both share the faculty-timetable commit. I merged only the two tips (no redundant predecessors, nothing deleted). Conflicts were resolved to the violet identity (Sites blue → violet; `--brand-blue` aliased to `--accent`; brand mark uses `--on-accent`). Board 03 is kept, with the branches' session-preserving links, in-planner attendance, group-message draft and room-change brief ported in. Fixes: a stale hero `::after` ring overflowed phones by 68 px; branch tests updated for Week view and the ring.
- **Migrations.** `016_automation`, `016_fee_review_rehearsal`, `017_campus_change_brief` and `018_automation_hardening` are independent. Fresh install applied all 21 and a second run was a no-op. Upgrade of the existing DB applied only the missing files. Applied files were not edited.
- **Hardening (018 + lib/automation.ts + scripts/worker.ts).**
  - Composite tenant FKs (job/notification → `audit_event(institution_id,id)`).
  - Read-time re-check of membership, roster and record state for every notification kind.
  - Explicit states: paused = held (no attempts spent), disabled = events ignored and waiting jobs cancelled; job cancel; defer without spending attempts.
  - Operator audit (`audit_event.ref` = rule key or `job:<id>`).
  - `nexus_worker` least-privilege role (no access to `account`/credentials, no domain writes).
  - LISTEN/NOTIFY wake-ups with adaptive 1–30 s polling.
  - Per-institution job health vs global worker liveness.
  - Institution effort evidence table (synthetic vs measured never mixed).
  - Error storage limited to categories.
  - Versioned handlers (`handler_version`).
- **New deterministic workflows.**
  - T-24h deadline reminders: deferred, reschedule-aware, skip submitters, expire after the deadline.
  - Class moved/cancelled/room-changed notices: stale revisions skipped as superseded.
  - Teacher attendance summary (L1 prepared draft, teacher shares it).
  - 48 h request follow-up to admins and escalation to the principal.
  - Shared `Inbox` component on student, faculty, admin and principal homes.
- **90% measurement.** Five workflows are instrumented. The seed holds labelled **synthetic** rehearsal samples (≈89–90% reduction by construction from blueprint example volumes). These are not evidence of real savings. Measured institutional baselines are empty by design.
- **Traceability.**
  - The generator no longer trusts a global flag. Rows are Functionally tested only when every `// covers:`-linked test file passed in `docs/evidence/test-run.json` (per-file, recorded at `da0ee07`, fresh DB: 111 passed / 0 failed).
  - Result: 58 functionally tested (local), 9 partial, **5 Tested claims without linked evidence** (CR-001, CR-006, DH-015, LE-007, AD-035), 8 unverified, 13 blocked, 387 missing.
- **Deployment prep (not provisioned).** `deploy/render-automation.example.yaml` holds a worker or a 5-minute cron `--once` (both paid on Render). `render.yaml` is unchanged.
- **AI.** `docs/AURA_SMOKE_TEST_PLAN.md` sets a $1 cap and five cases. Not executed; needs founder approval.
- **Verified (fresh DB, CI order):** migrate ×2 + seed ✓, lint ✓, typecheck ✓, build ✓, PostgreSQL+unit 69/69, Chromium 31/31, tutor 1/1. Automation browser test passed 3/3 consecutive runs after fixing a reload race.
- **Known UI debt.** The faculty home shows two "Teaching priorities" sections after the merge (to be fixed in the faculty structural redesign).
- **Not done yet (next packages):** periodic institutional reports (needs schedule occurrences without an audit event), reusable office workflow engine (AD-020), structural redesigns of faculty/HOD/principal/admin, command palette and sheets, AURA ledger unification.

## 2026-11-27 — Progress push toward 30: institutional boards, office operations, linked evidence

Implemented (commit 66574f2):
- HOD board: workload, section rosters and attendance. Principal board: escalations with decisions, department comparison. Faculty home gets a workload line; the duplicated "Teaching priorities" heading is fixed. The reports live in `lib/department.ts`; HOD and faculty share one workload definition.
- Request ownership: `db/019`, `assignRequest`, and the "mine", "unassigned" and "all" queue views. Only the owner can advance a request, and starting review claims it. The new rule `request-assigned-notify` uses the existing outbox; a superseded assignment is skipped.
- Audit viewer (`/audit`): admin only, metadata only, filters validated with Zod.
- 30-day operations report (`operationsReport`) on the admin home: queue age, median resolution, and attendance and result corrections. On demand only; no scheduled delivery yet.
- Student assessment history (`/history`): shows only the latest published result.
- New tests: notices, internships and competitions, department, operations and history (PostgreSQL); leadership and operations (Chromium).

Observed: a fresh DB in CI order passed migrate ×2, seed, lint, typecheck and build; 81/81 PostgreSQL and unit tests, 33/33 Chromium, 1/1 tutor. Recorded in `docs/evidence/test-run.json` (66574f2, 125 files passed).

Recovery: a worker started before this change marked two jobs `unknown_handler`. After restarting the worker they were retried and correctly skipped because the requests had closed.

Traceability: 69 functionally tested (local), 14 partial, 0 claims without evidence, 8 unverified, 13 blocked, 376 missing.

Not done: academic calendar (SA-010), scheduled periodic reports, the reusable workflow engine (AD-020), admin home structural redesign, command palette, and AURA unification.

## 2026-11-27 — Progress push toward 40: learning records, corrections, finder, admin board

Implemented (commits b4b27cc, f9da764):
- **Attendance corrections (SA-021):**
  - Added in `db/020` and `lib/corrections.ts`.
  - A student can challenge only their own latest "absent" mark on a recorded class. Only the session's current teacher decides, with a reason.
  - Acceptance writes a new attendance revision in the same transaction, copying every other mark unchanged. A decline leaves the record as it was.
  - One open request per class and student.
  - Requests and decisions are audited and use the outbox: `attendance-correction-route` notifies the teacher and `attendance-correction-decided` notifies the student.
- **Academic calendar (SA-010, `/calendar`):** shows a month of the student's or teacher's own deadlines and classes plus campus events they registered for. Filters: course and type. Students and faculty only.
- **Course catalog (SA-002, `/catalog`):** every institution offering for active members, with the current teacher. Own rosters are marked. Search treats `%` and `_` as plain text.
- **CSV records (`/records/export`):**
  - Student: own published results and latest attendance marks, each with a source ID and revision (SA-022).
  - Faculty: one row per current teaching offering (FC-028).
  - Cells that could run as spreadsheet formulas are neutralised. Downloads are private, not cached, and return 404 for other roles.
- **Page finder:** Ctrl/⌘+K, or "Find a page" in the More sheet, filters the caller's own role destinations.
- **Admin home board:** "Office focus" hero (open, unowned, oldest waiting), routed inbox beside the office tools, and the 30-day operations record.
- **Fixed:**
  - The student phone dock sorted pages missing from its preferred order (Assessment history, Calendar, Catalog) ahead of Today. They now follow it.
  - `tests/automation.test.ts` now drains all due jobs. On a reused database, one bounded worker pass could miss the test's own jobs.

Observed, local fresh PostgreSQL, CI order at f9da764:
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 86/86 PostgreSQL and unit tests, 35/35 Chromium, 1/1 tutor.
- Recorded in `docs/evidence/test-run.json` (132 files passed, 0 failed). Screenshots are in `docs/evidence/records-2026-11-27/`.

On a reused, non-fresh database two older tests failed because of accumulated fictional data:
- automation job starvation, now fixed;
- an AURA assignment list whose row limit drops a far-future test assignment, not fixed and still order-dependent.

The recorded evidence is from a fresh database only.

Traceability: 70 functionally tested (local), 18 partial, 0 claims without evidence, 8 unverified, 13 blocked, 371 missing.

Not done:
- scheduled periodic report delivery (notification uniqueness is per event, so recurring delivery needs an occurrence record);
- the reusable workflow engine (AD-020);
- HOD or office override of correction decisions (needs a policy);
- institution-wide calendar entries;
- catalog publication controls;
- AURA unification.

## 2026-11-27 — Toward 40, batch 2: course materials, course plans, mentoring, executive report

Implemented (commit bbdc5fc, `db/021`):
- **Course materials (SA-018, FC-020):**
  - Teachers publish PDF or TXT files and upload new versions with a note. The course's teachers can still download earlier versions.
  - Students and the department HOD get the latest version only.
  - Withdrawal hides the material. Every change is audited.
- **Course plans and delivery (FC-006, DH-005, DH-011, DH-022 slice):**
  - The teacher drafts topics and submits them. An HOD of the course's department approves, or returns with a reason.
  - Approval freezes the plan, and students see topics only once it is approved.
  - Each ended class gets a delivery record linked to an approved topic. A correction updates the record (revision), so a topic is not counted twice.
  - The HOD board shows coverage and logged classes.
- **Mentoring (FC-016):**
  - An admin assigns one current faculty mentor per student. A replacement ends the earlier pairing and removes that mentor's access; the records are kept.
  - The mentor records goals and follow-ups, and the student marks goals agreed.
- **Executive report (LE-019 slice):** a principal-only CSV where each figure carries its definition, time window and source table.

Observed, fresh local PostgreSQL in CI order at bbdc5fc:
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 90/90 PostgreSQL and unit tests, 37/37 Chromium, 1/1 tutor (138 files).
- Screenshots: `docs/evidence/delivery-2026-11-27/`.

Traceability: 70 functionally tested (local), 26 partial, 8 unverified, 13 blocked, 363 missing. All eight new rows carry a stated scope limit, so they count as partial.

UI note: on a database with many test assignments, the student course page lists every assignment before materials and plan. That is acceptable for the pilot volume but should be paginated.

## 2026-11-27 — Toward 40, batch 3: scheduled digest, case engine, cohort progress

Implemented (commit 371d1f7, `db/022`):
- **Weekly operations digest (AD-024):**
  - The worker loop writes one digest per institution per local week, after Monday 08:00, covering the previous full week.
  - The period is the key, so later runs that week do nothing.
  - Verified running as the least-privilege `nexus_worker` role.
  - Shown on the admin and principal boards.
- **Case engine (AD-020 slice):** one record, ownership, transitions (assign → start → resolve/decline), staff notes, audit, and notifications through the outbox.
  - **Support cases (DH-014, FC-015):**
    - Opened by an HOD or teacher, assigned by the HOD to a department teacher.
    - Students never see them.
    - Time to close is measured over 90 days.
  - **Grievances (AD-017):**
    - The student submits; the office triages and owns them.
    - The student sees the state and outcome but not staff notes or the owner's name.
    - After 7 days open, the principal sees the title and state only.
- **Cohort progress (LE-003):** per term and section: students, results-published rate, mean latest score and latest-record attendance.

Observed, fresh local PostgreSQL in CI order at 371d1f7:
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 95/95 PostgreSQL and unit tests, 39/39 Chromium, 1/1 tutor.
- Screenshots: `docs/evidence/cases-2026-11-27/`.

Not migrated onto the case engine: enrollment letters and fees. Digest delivery is in-app only (no email).

## 2026-11-27 — Toward 40, batch 4: examinations, improvement actions, completed workload and attendance records

Implemented (commits 11ae492 and 7157466, `db/023`):
- **Examination sittings (SA-015, SA-016, AD-009, AD-029, LE-008):**
  - The office drafts each sitting with a room and an invigilator. External sittings must cite their official source.
  - Publication is refused for:
    - a section, room or invigilator overlap (database exclusion constraints, same as classes);
    - a class in the room, or taught by the invigilator, at that time;
    - a confirmed booking of the room.
  - Students see only their courses' published sittings, faculty their duties and courses, the HOD their department.
  - Sittings appear in the calendar.
  - Unresolved issues are recomputed from current records: invigilator without a faculty post, room smaller than the cohort.
- **Improvement actions (LE-010, LE-011, DH-025):**
  - Each action has one owner, a measure, a due date and dated progress updates. Only the owner closes it.
  - Measures: open, overdue, done, done on time.
- **FC-019** is now complete: workload includes current mentees.
- **SA-005** is now complete: students can request a correction (SA-021).
- **Test fix:** the page-finder browser test pressed Ctrl+K before hydration on one run. It now waits for the finder button to be enabled; passed 3/3 consecutive runs.

Observed, fresh local PostgreSQL in CI order at 7157466:
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 100/100 PostgreSQL and unit tests, 41/41 Chromium, 1/1 tutor (152 files).
- Screenshots: `docs/evidence/exams-2026-11-27/`.

Traceability: 75 functionally tested (local), 34 partial, 8 unverified, 13 blocked, 350 missing.

## 2026-11-27 — Toward 40, batch 5: allocation, schemes, quality indicators, project teams, offboarding

Implemented (commit 8398a53, `db/024`):
- **Teaching allocation (DH-007):** the HOD proposes a current faculty member for an offering in their department. The office approves (which adds the faculty roster row in the same transaction) or rejects, with a reason. Duplicates and existing teachers are refused.
- **Schemes and cohorts (DH-004):** read-only scheme → term → course → section mapping for the HOD's departments.
- **Quality indicators (LE-004):** seven measures from records, each with a definition and a stated limitation.
- **Project teams (FC-017, FC-018):**
  - Teachers form teams from the active roster (one team per student per offering) and set milestones.
  - Students submit evidence; the teacher accepts or requests changes; teams can resubmit.
  - Students see only their own team.
- **Offboarding (ID-009 slice):**
  - Admin-only, behind a confirmation dialog. Ends every post, roster and mentoring pairing in this institution in one audited transaction.
  - Reports the cases and requests the person still owns.
  - Refuses the caller's own account and other admins.
- **Caught by the new tests before commit:**
  - The draft HOD scope check reused the caller's table alias inside its subquery, which made the offering filter always true. Fixed with distinct aliases.
  - A `FOR SHARE` lock on `team_member` needed a privilege the app role lacks. The lock was removed because membership changes are not a feature.

Observed, fresh local PostgreSQL in CI order at 8398a53:
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 104/104 PostgreSQL and unit tests, 43/43 Chromium, 1/1 tutor.
- Screenshots: `docs/evidence/teams-2026-11-27/`.

Traceability: 77 functionally tested (local), 38 partial, 8 unverified, 13 blocked, 344 missing.

## 2026-11-27 — Toward 40, batch 6: policies, eligibility, three more case kinds, question bank

Implemented (commits 90806b3 and 36b543e, `db/025`):
- **Policies (AD-021, AD-016 slice, SL-007 slice):**
  - Admins draft versions; the principal approves or rejects each one with a reason. Only approved versions are published, to everyone, staff or students.
  - One open draft per policy. Rejected versions never take effect.
- **Attendance eligibility (SA-007):** each course's record-based rate is compared with the latest approved attendance policy version. The student timetable cites the policy and its version. This explains a figure; it is not an official eligibility decision.
- **Case engine (AD-020) now serves five kinds:**
  - **Repair reports (AD-031, AD-032):** office-owned; the reporter can reopen within 14 days with a reason.
  - **Integrity appeals (SA-023):** student-only, tied to the published integrity policy version and one of their own assignments, reviewed in the course's department. Students never see staff notes.
  - **Department requests (DH-023):** student-only, routed by the HOD.
- **Question bank (FC-009, FC-008 slice):**
  - Teachers keep private or department-shared questions. Each edit adds a version.
  - A draft assignment can be composed from current versions, citing each version and summing the marks.
- **Caught before commit:** a `FOR UPDATE` lock on `policy` needed a privilege the app role lacks. The lock was removed; the one-draft index already serialises drafts.
- **Test fix:** the automation inbox browser test now clears earlier suites' job backlog before publishing. In one full run, six later notifications pushed its item out of the six-item panel; the database confirmed the ordering.

Observed, fresh local PostgreSQL in CI order at 36b543e:
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 109/109 PostgreSQL and unit tests, 45/45 Chromium, 1/1 tutor (165 files).

Traceability: 82 functionally tested (local), 43 partial, 8 unverified, 13 blocked, 334 missing.

## 2026-11-27 — Toward 40, batch 7: development, research, campus operations, catalog corrections

Implemented (commits 99b5357 and dd5f518, `db/026`):
- **Professional development (FC-025, DH-016):** teachers record activities with hours and evidence; an HOD of a department they teach in verifies or returns them. An HOD cannot verify their own records.
- **Research projects (DH-017, FC-021, LE-012):**
  - A teacher proposes; the HOD approves or returns and chooses department or institution disclosure.
  - The lead adds milestones and completes them with evidence. The project completes when every milestone is done.
  - The principal sees only projects disclosed to the institution.
- **Principal board additions:**
  - Campus operations (LE-015): open and reopened repairs, oldest open, resolutions that held 14 days.
  - Room use for the next 7 days (LE-005): booked hours from classes, exams and bookings, against seats, plus sections larger than any room.
- **Catalog name corrections (AD-008 slice):** admin-only, with the old name, reason and actor kept in a history.
- **Fixes:**
  - The quality indicator table no longer breaks words mid-word.
  - The case-closure definition now covers all case kinds.
  - The admin heading was renamed because it collided with the Release 1 test's "Section name" label lookup.

Observed, fresh local PostgreSQL in CI order at dd5f518:
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 113/113 PostgreSQL and unit tests, 47/47 Chromium, 1/1 tutor (171 files).

Traceability: 83 functionally tested (local), 50 partial, 8 unverified, 13 blocked, 326 missing.

Session summary (seven batches since 30-push): fully tested 69 → 83, partial 14 → 50, missing 376 → 326. Migrations 020–026 add 27 tables. Production readiness is still 0: nothing is hosted, no real users have been measured, and the founder approvals listed in the handoff are still outstanding.

## 2026-11-27 — Toward 40, batch 8: My work, closing partial rows, acceptance review

Implemented (commit f6c0ade, `db/027`):
- My work (AD-018).
- Institution calendar dates (SA-010).
- Catalog visibility controlled by the office (SA-002).
- Scheme- and term-aware student record (SA-022).
- Workload totals in the teaching report (FC-028).
- Reopenings in the operations report (AD-024).
- Grievance escalations on the principal board (LE-009).
- Section counts below the approved attendance policy (DH-009).
- A date window on the executive report (LE-019).

Acceptance review: each row below was re-read against its registry acceptance text. The scope note was removed only where the text is now met. Rows with a real gap keep their note: SA-015, SA-016, LE-003, LE-010, LE-011, FC-025, DH-016, FC-021, AD-008, ID-009, SL-007, SA-007, FC-008, AD-016, AD-020, AD-023, DH-009.

| ID | Previous status | Why the acceptance is now met |
| --- | --- | --- |
| AD-018 | Tested (service requests) | one queue of actionable records per office across requests, cases, approvals and reviews |
| SA-010 | Tested (own course deadlines, classes and registered campus events; no institution-wide calendar entries) | institution dates plus course deadlines, classes, exams and events, filterable |
| SA-002 | Tested (every institution offering visible to active members; no catalog publication controls) | office-controlled catalog visibility |
| SA-022 | Tested (CSV of own published results and latest attendance marks with source IDs) | record names scheme, term and the source record |
| FC-028 | Tested (CSV per current teaching offering) | per-offering teaching plus workload totals |
| AD-024 | Tested (on-demand 30-day report and a scheduled weekly in-app digest written by the worker) | queue age, resolution, rework (corrections) and reopenings; scheduled weekly digest |
| LE-009 | Tested (service-request escalations) | request and grievance escalations with the office's decisions |
| LE-019 | Tested (CSV with definitions, windows and source per figure; no custom time window) | each figure with definition, source and a chosen date window |
| DH-022 | Tested (course plan approval or return with reason only) | HOD decisions with reasons on plans, development records, research, cases and allocation proposals |
| DH-004 | Tested (read-only scheme, term and section mapping) | review is read-only by definition |
| LE-004 | Tested (seven fixed record-derived measures with definitions and limitations) | defined measures shown with their limitations |
| LE-008 | Tested (issues: invigilator without a post, room below cohort size) | published schedules with recomputed unresolved issues |
| FC-017 | Tested (team milestones with evidence review and resubmission) | milestones reviewed with evidence and resubmission |
| AD-032 | Tested (outcome text as repair evidence, reporter reopen within 14 days; no photos) | repair evidence recorded as the outcome; reporter reopen |
| LE-015 | Tested (estate repairs: open, reopened, oldest, resolutions held 14 days) | critical repairs and resolutions verified by 14 days without reopening |
| LE-005 | Tested (room hours booked next 7 days against seats; no demand forecast) | rooms compared with scheduled demand |
| LE-012 | Tested (HOD-approved projects disclosed to the institution; no outcome metrics) | disclosure-approved projects with milestone evidence |
| DH-005 | Tested (logged classes against an HOD-approved plan; no institution curriculum source) | logged classes compared with the approved plan |
| DH-011 | Tested (approved topics covered by logged classes) | coverage of approved topics with delivery summaries as evidence |
| FC-006 | Tested (per-class delivery summary linked to an approved plan topic) | delivery logged per class against the approved plan |
| FC-020 | Tested (versioned PDF/TXT per offering with withdrawal) | versioned materials with withdrawal |
| SA-018 | Tested (PDF/TXT materials; students get the latest version) | latest authorized version for the roster |
| FC-016 | Tested (admin-assigned mentor; goals, follow-ups and student agreement) | goals agreed by the student and follow-ups recorded |
| DH-014 | Tested (HOD-coordinated support cases owned by department teachers) | assignment and follow-up of support by the HOD |
| FC-015 | Tested (support cases with time-to-close measure) | coordination with department staff and time-to-close measure |
| AD-017 | Tested (student grievance intake, single owner, outcome, 7-day principal visibility) | confidential intake, single owner, 7-day escalation, outcome |
Observed, fresh local PostgreSQL in CI order at f6c0ade:
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 118/118 PostgreSQL and unit tests, 48/48 Chromium, 1/1 tutor (177 files).

Traceability: 109 functionally tested (local), 24 partial, 8 unverified, 13 blocked, 326 missing.

Handoff: `docs/handoff/NEXUS_CODEX_HANDOFF.pdf` (and its HTML source) splits the next work between Claude and Codex, with reserved migration ranges.

## 2026-11-27 — Batches 9–10 (Claude track): delegation, certificates, student life, meetings, scenarios

Implemented (commits 3dfef75, 69e1965 and 103ab35; `db/028`, `db/029`):
- **Delegated duties (AD-019, ID-008 slice):**
  - Admins lend the exam cell or the institution calendar to a faculty member or HOD for 1–365 days, and can revoke early.
  - Exams and calendar checks accept a live delegation in the delegate's own role. A revoked or expired duty grants nothing.
- **Certificates (AD-011, AD-012):**
  - Bonafide, attendance and results certificates are drafted from current records, with their sources listed.
  - An admin issues each one with a 12-character verification code, and can revoke it with a reason.
  - Public `/verify` shows only the type, institution, date, status and holder initials.
- **Student life:**
  - Study groups (SL-014): opt-in, limited to the course roster and a capacity.
  - Profile (SL-009): visibility is private, teachers (including the mentor) or classmates.
  - Portfolio (SL-013): only the student's own verified records, shared by the same visibility.
- **Meetings (FC-027):** invited staff only. The organizer records minutes after the start and assigns actions to participants; owners close their own actions.
- **Representation issues (SL-016):** a sixth case kind on the shared engine. Every current student can read an issue and support it once; the office owns the response.
- **Decision simulation (LE-018 slice):** principal-only and read-only. Compares a proposed attendance minimum with the approved one, per section, on the same records, with the assumptions stated.
- **Test update:** admins now reach `/calendar` (they manage institution dates). The earlier test expected 404 and now checks the principal instead.

Observed, fresh local PostgreSQL in CI order at 103ab35:
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 127/127 PostgreSQL and unit tests, 50/50 Chromium, 1/1 tutor (188 files).

Traceability: 113 functionally tested (local), 30 partial, 8 unverified, 13 blocked, 316 missing.

## 2026-11-28 — Batch 11 (Claude track): letters on the case engine, preferences, support services; Codex parallel plan

Implemented (commit 014188c; `db/030`):
- **Letters (AD-020):** a seventh case kind. A leave or permission letter from Letter drafts is submitted to the office; only the sender and the office read it, and it follows the shared assign → start → close rules with audit events. Admins cannot submit letters to themselves; the principal cannot submit. Fee review keeps its own workflow.
- **Preferences (SL-010, SL-011):** per member and institution: larger text, reduced motion, study-group discovery (hidden names appear as "A classmate") and per-kind in-app notification muting. Muting hides inbox items only; records are unchanged. No locale setting: the interface is English only.
- **Support services (SL-015):** the office publishes and withdraws services by category; every current member browses them. Other tenants and roles without membership see nothing.
- **Styling:** checkbox labels now sit beside their box in every form (meetings and question bank also benefit).
- **Codex plan:** `docs/handoff/NEXUS_CODEX_PARALLEL_PLAN.pdf` assigns outcomes, sports, careers, transport and campus operations to Codex (migrations 040–064) and keeps authority and workflow code with Claude (030–039).

Observed, fresh local PostgreSQL in CI order at 014188c:
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 131/131 PostgreSQL and unit tests, 51/51 Chromium, 1/1 tutor (193 recorded).
- Evidence: `docs/evidence/letters-preferences-2026-11-28/`.

Traceability: 114 functionally tested (local), 31 partial, 8 unverified, 13 blocked, 314 missing.
Note: commit 014188c said the registry rows would be confirmed after the full run; they were already set in that commit, and this run confirms them.

## 2026-11-28 — Batches 12–13 (Claude, Codex paused): sports and careers

Codex reached its limit, so Claude took the sports and careers tracks from the parallel plan, using migrations 031–032 in its own range. Codex's reserved 045–054 stay unused.

Implemented (commits 91f6321 and 6ececc5):
- **Sports (`db/031`, `lib/sports.ts`, `app/sports`):**
  - The office creates tournaments (intramural, interdepartmental, intercollege), department and open teams, and validated external opponents. It assigns coaches and match officials and enters teams by level.
  - Coaches open trials, decide eligible students' requests with a reason, publish training at a free venue and post squad-only announcements.
  - Fixtures refuse clashes for the venue, the teams and the selected players' published classes.
  - Only the assigned official records a result after the start; a revision needs a reason and raises the revision number.
  - Standings use completed fixtures only (3/1/0). Official-verified participation can go into the student's portfolio.
- **Careers (`db/032`, `lib/careers.ts`, `app/careers`, `app/opportunities`):**
  - Listings may be jobs, placement drives, hackathons, fellowships or research openings, optionally limited to one department's current students. Eligibility explains how to correct it.
  - Students track, draft and record submission, and may withdraw before an outcome. The office records placement-drive outcomes in order.
  - The department outcome summary counts office-recorded offers only. A plain-text résumé draft is built from the student's own chosen records.
- **Layout fix:** a compact `.standings` table so phone widths no longer break words.

Observed:
- A background run started on 91f6321 showed 133/135. The 2 opportunity failures were caused by editing `lib/opportunities.ts` for careers while that run was in progress (the new column was not yet migrated). The run was stopped and not recorded.
- Fresh local PostgreSQL in CI order at 6ececc5: migrate ×2 + seed, lint, typecheck and build passed; 140/140 PostgreSQL and unit tests, 53/53 Chromium, 1/1 tutor.
- Evidence: `docs/evidence/sports-2026-11-28/`, `docs/evidence/careers-2026-11-28/`.

## 2026-11-28 — Batch 14 (Claude, Codex paused): campus operations

Implemented (commit 8575dbe, `db/033`, `lib/operations.ts`, `app/facilities`):
- **Room and lab bookings (OP-002, OP-014):** staff and students request a slot with a purpose; a student must name a current teacher as supervisor, who can also see the request. The office approves or declines with a reason. Approval refuses overlaps with approved bookings (exclusion constraint) and with published classes in the room. Requesters can cancel future bookings.
- **Library and equipment custody (OP-003, OP-004, OP-005):** any member searches the holdings with live availability. The office issues a copy or a piece of equipment to a current member with a due date. One open loan per piece of equipment; no more loans than copies. Returns record a condition; members see only their own loans.
- **Room use (OP-009 slice):** class and approved-booking hours per room for the next seven days, office only.
- **Linked existing evidence:** repairs on the case engine cover OP-006, OP-007 (no file evidence), OP-013 and OP-015; request routing covers OP-012; the audit viewer covers OP-016. SP-018 and CR-014 are now linked to their tests.

Fixes found while testing:
- The draft migration 033 check refused cancelling an approved booking. It was corrected before the commit; the migration had not been committed or applied anywhere else.
- The course-delivery browser test assumed three held classes. That count includes classes other browser tests leave behind and depends on time of day; one run saw one. The test now reads the count first (d220450).

Observed, fresh local PostgreSQL in CI order at d220450:
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 143/143 PostgreSQL and unit tests, 54/54 Chromium, 1/1 tutor.
- An earlier run at 8575dbe showed 53/54 Chromium; the one failure was the course-delivery count above.
- Evidence: `docs/evidence/facilities-2026-11-28/`.

## 2026-11-28 — Batch 15 (Claude, Codex paused): outcome-based evidence

Implemented (commit 0a0f185, `db/034`, `lib/outcomes.ts`, `app/outcomes`):
- **Outcome definitions (DH-012, DH-013):**
  - The office defines programme outcomes (PO/PSO codes).
  - A current teacher of a course proposes a course outcome with programme-outcome mapping levels 1–3.
  - The head of the course's department approves or returns it with a reason. Approved outcomes are fixed; a returned code can be proposed again.
- **Assessment tagging (FC-014):** only a current teacher of the offering can tag its assessments, and only with approved outcomes of that course.
- **Attainment (FC-014, DH-013):** per course outcome, from published marks only:
  - A student attains an outcome at 60% of the available marks.
  - Levels 3/2/1 apply when 70/60/50% of assessed students attain it.
  - Programme outcome levels are mapping-weighted means.
  - The rule is stated on the page. Teachers see their offerings, HODs their department's, the principal all; admins do not see attainment.
- **Student evidence (SA-019):** a student sees only their own per-outcome percentage, labelled as evidence, not a grade.
- **Not done:** rubric criteria (FC-010) and item-level concept analysis remain open.

Observed, fresh local PostgreSQL in CI order at 0a0f185:
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 146/146 PostgreSQL and unit tests, 55/55 Chromium, 1/1 tutor.
- Evidence: `docs/evidence/outcomes-2026-11-28/`.

## 2026-11-28 — Demo preparation for 2 December (priority change from the founder)

The founder moved today's goal from full coverage to a 2 December demo.

Demo set: 14 capabilities across student, teacher, HOD, office and principal journeys, listed with status in `docs/DEMO_DEC2.md`:
- 13 are Tested.
- LE-018 stays partial: only attendance-minimum scenarios are modelled.

Done (commit 7bfc278):
- **SP-004 completed:** a trial decision reaches the student's inbox through the outbox (`db/035`, rules `sport-selected-notify` and `sport-declined-notify`). Students can mute it in Settings.
- **DH-012, CR-002, OP-002:** bracketed notes removed after review. They described what was built, not a missing part of the requirement.
- **`scripts/seed-demo.ts` (`npm run db:seed-demo`):** fictional demo data for a dedicated local database only. Integration tests keep the plain seed.
- **`tests/demo/dec2.rehearsal.ts` with `playwright.demo.config.ts`:** walks the whole demo script on a clean demo database. It is not part of CI because it changes the demo data.

Problems the rehearsal caught, and how each was fixed:
- The script said one submission awaited evaluation. Asha's Lab 3 submission makes it two; the script was corrected.
- Decided correction requests leave the teacher's queue. The step and its check were corrected.
- The demo data published a grade before its submission time, which showed −72 h turnaround on the principal board. The submission is now dated before the grade.

Observed:
- Demo rehearsal on a clean demo database: 1/1 passed.
- One manual worker drain delivered the three inbox notices to the student: result, correction and team selection.
- Fresh local PostgreSQL in CI order at 7bfc278: migrate ×2 + seed, lint, typecheck and build passed; 146/146 PostgreSQL and unit tests, 55/55 Chromium, 1/1 tutor.

## 2026-11-28 — New plan from the founder; integration step 1: pilot foundation (migration 036)

The founder's plan ("College OS build plan to Dec 2") replaces the module split in `docs/PARALLEL_PLAN.md`.
- **Coders:** three.
  - This session (CC-A): integration on `audit/nexus-engineering-audit`, migrations 036–039.
  - CC-B on `cc/pilot-access`: sign-in, consent and search, migrations 070–089.
  - Codex on `codex/transport` from 15:00 IST, migrations 055–069.
  - Migrations 040–054 and 060–064 stay unused.
- **Goals:** Dec 2 demo with transport as the headline, then an EEE-only pilot after the college's written permission.
- **Freeze:** Dec 1, 12:00 IST; rehearsal at 18:00 IST.

**Migration 036 landed in commit 3794d44.** Other sessions branch from it.
- **New roles:** `transport` (transport office) and `driver`. Drivers' phones will report with per-vehicle tokens, so a driver login is optional.
- **New case kinds:** `transport_incident` and `lost_and_found`. Only the reporter and the transport office read them; the transport office coordinates them. Case-closed notices name both kinds.
- **Coordinator helper:** `coordinatorRole(kind)` in `lib/cases.ts` replaces the admin-or-HOD checks in the cases page and My work.
- **Department switch:** `department.active`, changed by the office with an audited reason (Academic setup → Departments switched on). It defaults to on.
- **Shared rule:** `lib/active-departments.ts` exports `departmentActiveSql` and `accountInActiveDepartmentSql`. Sign-up, imports and live buses must use them.
- **Navigation:** the Transport entry appears once `app/transport/page.tsx` exists (codex/transport), so no build links to a 404. The transport office and drivers get a short menu.

**Observed:**
- Fresh local PostgreSQL in CI order at 3794d44: migrate ×2 + seed, lint, typecheck and build passed; 148/148 PostgreSQL and unit tests, 56/56 Chromium, 1/1 tutor.
- Evidence: `docs/evidence/pilot-foundation-2026-11-28/`.

## 2026-11-28 — Integration steps 2–4: app shell, pilot runbook, phone-notification plumbing

Implemented:
- **App shell (4ddb317):**
  - Web app manifest and icons, an "Install app" button where the browser offers it, and a static offline page.
  - The service worker caches only `/offline.html` and one icon and never stores app responses. The browser test checks the cache contents.
  - The main Playwright config now blocks service workers, because they hide navigations from `page.route`; `tests/app-shell.e2e.ts` allows them.
  - Every role's home, including the new transport office and driver, fits 390 px.
- **Pilot runbook (3f882bd):**
  - `docs/DEPLOYMENT.md` → "SIT EEE pilot runbook": deployment shape, secrets, first-time order with a backup and restore test before any real sign-in, binding a driver's phone with Traccar Client, rollback, and daily checks.
  - `scripts/bootstrap-institution.ts` creates a real institution, its departments (only the listed ones on) and the first office account. It is a dry run by default and refuses to overwrite.
  - Tested locally with fictional values: dry run, apply, refusal on rerun, and rejected input.
  - No resources created; no spend.
- **Phone notifications (542e0e1, `db/037`):**
  - `lib/push.ts` sends empty VAPID-signed pushes (Node crypto, no new dependency) and removes subscriptions the push service reports gone.
  - Messages wait in a per-member queue that the service worker fetches with the member's session from `/api/push`; without a session it returns 401.
  - Settings has a per-phone switch when keys are configured. `scripts/push-keys.ts` generates a key pair.
  - Real delivery through a browser push service is untested here: it needs network access to the push services and a real phone.

Observed, fresh local PostgreSQL in CI order at 542e0e1:
- migrate ×2 + seed, lint, typecheck and build passed.
- 151/151 PostgreSQL and unit tests, 57/57 Chromium, 1/1 tutor.

Request to codex/transport:
- Send the 5-minute and delay alerts with `sendPush` to riders of that route in switched-on departments (`accountInActiveDepartmentSql`), from the position or notice request, not the worker.
- Create `app/transport/page.tsx` so the Transport menu entry appears.

## 2026-11-28 — Revised coder assignment and integration step 5: Ask AURA

**Revised assignment (founder, 07:47 UTC):**
- Integration: this branch, migrations 036–039.
- Sign-in and consent: Claude Code on `cc/pilot-access`, 070–089.
- Transport: a ChatGPT Dot on `dot/transport`, 055–069. It replaces codex/transport; the ledger requests above addressed to codex/transport now apply to dot/transport.
- Mentors and research: Codex on `codex/mentors-research` from 15:00 IST, 090–099.
- Migrations 040–054 stay unused. The foundation refactor and templates T1–T5 are dropped.

Steps 1–4 of the integration brief were already done (036 in 3794d44, app shell, runbook, push plumbing).

**Step 5, Ask AURA (88acb02):**
- `lib/aura/ask.ts` answers plain questions without a model. Questions route by keywords to readers that already enforce membership and roster: due work, next classes and rooms, attendance.
- Process questions quote the latest approved policy versions the asker's role may read, with a version citation and a scoped next step.
- A student in Section B asking the same question sees only Section B's work. A staff-only policy is never quoted to a student.
- AI-011 is Tested with a scope note; AI-017 is Tested.

**Step 6:**
- The demo data adds an approved "Letters and certificates" policy.
- `docs/DEMO_DEC2.md` and the rehearsal add step 1b, Ask AURA.

Observed:
- Demo rehearsal on a clean demo database: 1/1 passed.
- Fresh local PostgreSQL in CI order at 88acb02: migrate ×2 + seed, lint, typecheck and build passed; 154/154 PostgreSQL and unit tests, 58/58 Chromium, 1/1 tutor.

## 2026-11-28 — cc/pilot-access (taken on by the integration session): teacher import, email sign-in, student sign-up, consent

The founder assigned the pilot-access work to this session (branch `cc/pilot-access`, migrations 070–089). It merges into the audit branch at the 18:00 IST review.

Implemented (8f8990c, `db/070`):
- **Teacher import (ID-012):**
  - The office uploads or pastes a CSV (`name,email,phone,department,teaches,mentor_of`). The preview checks every row (duplicate emails, switched-off departments, unknown classes or sections, bad phones) and stores only the checked rows.
  - Confirming re-checks and writes exactly those rows, or nothing: accounts, faculty memberships, rosters, class mentors and phone numbers.
- **Email sign-in (AD-002):**
  - better-auth email OTP: 6 digits, 10-minute expiry, 3 attempts, stored hashed.
  - Limits: 10 requests per address per 10 minutes (auth library) and 5 codes per email per hour (no email is sent past the limit; the reply is identical, so nobody learns whether an email exists).
  - Mail goes through `lib/email`. Its console adapter runs only against a local database or the fictional pilot; a real provider needs approval.
  - `/login/code` keeps a safe same-site `next` link.
- **Student sign-up (ID-009):**
  - `/join/student?institution=…` asks for code sign-in (which confirms the email), then name, USN, semester, section in a switched-on department, phone and stop. The student sees nothing until a decision.
  - Only current teachers of that section, or its class mentor who is a current teacher, see and decide requests (bulk approve, reject with a reason the student sees).
  - Approval records a `student_admission`, the student membership, the section's rosters and the details.
  - The office's revoke now ends those rosters and the membership.
  - Every request and decision is audited.
- **Consent (ID-010 slice):**
  - A versioned privacy notice. When an institution requires it (office switch), every workspace page sends members to it until they accept.
  - The office sees who has not accepted.
  - The wording is a draft until the college approves it.
- **Step 5 (one search box):** not started.

Fixes during the full run:
- The pilot-access integration test left a Mechanical-only section that broke the catalog browser test's selector; it now cleans up.
- The admission preview test expected `/join/student` to return 404; it now expects the code sign-in, and the preview check moved to `/join/faculty`.

Observed, fresh local PostgreSQL in CI order on cc/pilot-access (8f8990c plus the test fixes):
- migrate ×2 + seed, lint, typecheck, build: all passed.
- 158/158 PostgreSQL and unit tests, 59/59 Chromium, 1/1 tutor.

**cc/pilot-access step 5, one search box (26e2eb3):**
- `lib/search.ts` reads notices and circulars, college dates, verified opportunities, approved policies and support services, each through its existing reader, so access matches that kind's own page.
- Every typed word must match.
- Tested: another section's notice, drafts, staff-only policies and other colleges stay hidden, and a role without membership sees nothing.
- Club events are not included yet: their visibility rules are richer and searching them needs a club-aware reader.
- The demo data gains an assessment circular; the demo script and rehearsal gain step 1c.

Observed at 26e2eb3 on cc/pilot-access:
- Demo rehearsal on a clean demo database: 1/1 passed.
- Fresh local PostgreSQL in CI order: migrate ×2 + seed, lint, typecheck and build passed; 159/159 PostgreSQL and unit tests, 60/60 Chromium, 1/1 tutor.

**cc/pilot-access change (founder, 08:19 UTC):**
- Sign-up no longer collects a bus stop. Migration 071 drops the columns; transport owns the route and stop.
- Newly approved students see "Pick your bus stop (coming soon)", which becomes a link once the transport page lands.
- Pending for integration: dot/transport will send "Request to integration:" lines for bus-delay late marks on first-period attendance. This session builds them in attendance when they arrive.
- Observed at c0ceb78, fresh local PostgreSQL in CI order: migrate ×2 + seed, lint, typecheck and build passed; 159/159 PostgreSQL and unit tests, 60/60 Chromium, 1/1 tutor.

**cc/pilot-access, continued (coordinator's standing order):**
- **Student import (33e189e, `db/072`):**
  - The office checks a student CSV with the same refusals as self sign-up.
  - It then either sends the rows to section teachers as pending requests or admits them on its own authority. Teacher approval and the office import share `admitStudent`.
- **Club events in search:** published events open to eligible members, or to members of that club, as on the club page.
- **Hardening (7163419, `db/073`):**
  - Failed sign-ins from the app's forms are recorded.
  - The office's pilot health page shows members by role, students waiting by section (with a reminder after 48 hours), notice acceptance, failed sign-ins in the last 24 hours (only this college's members and applicants), and phones with bus alerts.
  - Sessions last 3 days, and Settings can end every session on every device.
  - A browser test loads sign-in, code sign-in, join, student home, settings and approvals on emulated slow 3G at 390 px.
- The "Sign out on all devices" label collided with existing "Sign out" button lookups; it is now "End sessions on all devices".

Observed at 7163419, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, typecheck, build: passed. **Lint failed** on two unescaped apostrophes and an unused variable.
- 161/161 PostgreSQL and unit tests, 63/63 Chromium, 1/1 tutor.
- f31c988 fixes the lint, which then passed. Its full run happens at the 18:00 integration review.

**Matrix work on cc/pilot-access (888e84d, `db/074`):**
- **Rubrics (FC-010):**
  - A course teacher sets criteria before marking starts; the points must add up to the maximum marks.
  - Scoring by criterion saves an ordinary grade draft whose marks are the total, with the scores tied to that revision. `updateGrade` now wraps `gradeIn`, so the grade and its scores share one transaction.
  - Publication and corrections are unchanged. The student sees the per-criterion breakdown only for the published revision.
- **Linked to tests that already cover them**, with scope notes where narrower:
  - Full: SL-002 sports participation, LE-014 placement performance.
  - Partial: AD-033 sports coordination (no travel approvals), AD-028 placement office (no employer records), AD-025 library desk (no external integration), AD-026 laboratory staff (no separate role).

Observed at 888e84d, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 163/163 PostgreSQL and unit tests, 64/64 Chromium, 1/1 tutor.

**Matrix work, continued (11590e1, `db/075`):**
- **Student records (AD-005):** the office finds students by name, email or USN and corrects USN, semester or phone with a reason. Every change keeps its old and new value. A student reads their own record on My profile, and nobody else's. Names stay with the sign-in account, which is shared across colleges.
- **Classroom scheduling (OP-001):** a new timetable test shows two sections cannot hold a class in one room at the same time; the clashing class stays a draft. It also covers part of DH-008 timetable planning (no HOD planning view).

Observed at 11590e1, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 165/165 PostgreSQL and unit tests, 65/65 Chromium, 1/1 tutor.

**Matrix work, continued (d1835ad, no migration):**
- **Department heads (DH-018, DH-019, DH-021):** an HOD now sees room-use totals and equipment status (available, on loan or overdue; due date; last return condition) on Facilities, without who booked or borrows what. Students, faculty, the principal and other colleges see nothing. A sports test confirms the HOD sees their department's teams.

Observed at d1835ad, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 166/166 PostgreSQL and unit tests, 65/65 Chromium, 1/1 tutor.
- Matrix: 133 tested, 79 partial, 247 missing, 8 unverified, 13 blocked. The three new rows are Tested with a scope note, so they count as partial.

**Club events (f749015–a14014e, `db/076`):**
- **Waitlist (CL-044):** when an event is full, an eligible student joins a waitlist and sees their place. A registered student can give up their seat before the event starts, which goes to the earliest person waiting who still has an active student membership (and club membership for members-only events). Verified attendance can't be withdrawn.
- **Feedback (CL-046):** after an event is completed, each registered student can give one rating (1–5) and an optional comment. Officers see the count, the average and the comments, without names. Students see no summary. No published outcome report yet.
- At f749015 the new browser test closed the app's shared connection pool, so a later release test in the same worker failed with "Called end on pool more than once" (243 passed, 1 failed). Fixed in a14014e.

Observed at a14014e, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 167/167 PostgreSQL and unit tests, 66/66 Chromium, 1/1 tutor.
- Matrix: 134 tested, 80 partial, 245 missing, 8 unverified, 13 blocked.

**Club notices and upcoming events (6439930–7ff1950, `db/077`):**
- **Club notices (CL-028):** a current club lead or officer posts a notice to club members or to everyone eligible for the club. Each notice has an expiry date from today up to 180 days ahead, and can be withdrawn. Other members, admins, other faculty and other colleges can't post. Withdrawn and expired notices disappear.
- **Upcoming events (SL-003, partial):** the CLUBVERSE home lists the ten soonest club events the person may see. The same query now backs search. There are no separate cultural-production records.

Observed at 7ff1950, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 168/168 PostgreSQL and unit tests, 66/66 Chromium, 1/1 tutor.
- Matrix: 135 tested, 81 partial, 243 missing, 8 unverified, 13 blocked.

**Room availability and staff dock (aac7477–adf3550, no migration):**
- **Room availability (SP-012, partial):** on Facilities, any current member can check a room and date and see when it's taken by classes or approved bookings. They see times only, never who booked it, why, or which class. Other colleges see nothing. Requested and cancelled bookings don't count as taken.
- **Staff dock:** Dot's handoff (dot/transport `docs/TRANSPORT_LOCAL_HANDOFF.md`) noted that Transport displaced Evaluation queue in the faculty mobile dock. Transport now leads only the student dock; staff find it under More. This can only be checked once `app/transport/page.tsx` is merged, so it's on the 18:00 review checklist.

Observed at adf3550, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 168/168 PostgreSQL and unit tests, 66/66 Chromium, 1/1 tutor.
- Matrix: 135 tested, 82 partial, 242 missing, 8 unverified, 13 blocked.

**Operational notices (9db820f, `db/078`):**
- **OP-010 (partial):** a notice can be marked "Maintenance or closure" and given an end date (today or later). After that date readers no longer see it, though its author still does. It uses the existing college, department and class audiences; there's no building-level audience.

Observed at 9db820f, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 169/169 PostgreSQL and unit tests, 66/66 Chromium, 1/1 tutor.
- Matrix: 135 tested, 83 partial, 241 missing, 8 unverified, 13 blocked.

**Club tasks and lab access (39e34ea, `db/079`):**
- **Club meeting decisions (CL-047, partial):** a club lead or officer records a decision from a meeting as a task, with an owner who is an active member and a due date that isn't before the meeting. Only the owner marks it done, once. Active members see open tasks, overdue ones flagged, plus those done in the last 30 days. Clubs don't have meeting scheduling or minutes.
- **Lab access (CR-020, partial):** linked to the existing supervised student booking: a current teacher must supervise, and the office decides. There's no safety-induction record.
- `addClubTask` first threw its date check synchronously, before returning a promise, so the test caught it outside `assert.rejects`. Made the function async; callers now always get a rejected promise.

Observed at 39e34ea, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 170/170 PostgreSQL and unit tests, 66/66 Chromium, 1/1 tutor.
- Matrix: 135 tested, 85 partial, 239 missing, 8 unverified, 13 blocked.

**Safety incidents (a051ce8, `db/080`):**
- **OP-011 (partial):** "Safety incidents" is a new case kind. Any member except the principal reports one, and the office owns the response. The principal can read them; notes stay with staff. An open report nobody has been assigned within 24 hours is flagged as escalated, and assigning it clears the flag. The reporter is notified when it closes. The page tells people to call for help first in an emergency. There's no configurable response policy or paging.

Observed at a051ce8, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 171/171 PostgreSQL and unit tests, 66/66 Chromium, 1/1 tutor.
- Matrix: 135 tested, 86 partial, 238 missing, 8 unverified, 13 blocked.

**Department clubs (63b20b4–f0989b7, `db/081`):**
- **Safety close notice:** a test now confirms the reporter gets "Your safety report has been resolved" when the office closes a safety case (the case-closed job runs for every kind).
- **DH-020 (partial):** the office links a recognized club to one department, or removes the link, from the club page. That department's current HOD sees it on their board with state, active members and upcoming published events. Faculty, the principal, students, other HODs and other colleges can't link it, and only that HOD sees it. Moving a club to another department removes it from the first HOD's board. HODs have no actions on the club.

Observed at f0989b7, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 172/172 PostgreSQL and unit tests, 66/66 Chromium, 1/1 tutor.
- Matrix: 135 tested, 87 partial, 237 missing, 8 unverified, 13 blocked.

**Merge dry run with dot/transport (5885a54–babbbaa):**
- I merged audit/nexus-engineering-audit + cc/pilot-access + dot/transport@32b630f into a local branch that was never pushed and ran CI on a fresh database.
  - Only the ledger conflicted (append-only).
  - 192/192 PostgreSQL tests passed.
  - First run: 66/67 Chromium. pilot-access e2e still expected "Pick your bus stop (coming soon)", but with the transport page present home shows "Pick my route and stop". Fixed in 5885a54: the test checks for `app/transport/page.tsx`, as the shell does.
  - Second run, with `NEXUS_TRANSPORT_LOCAL_TEST=1` so Dot's boarding e2e runs: 67/68 Chromium. The boarding test failed with "Called end on pool more than once"; it and `release.e2e.ts` both close the shared app pool in one Playwright worker.
  - Fixed the release side in babbbaa. Asked Dot, through the coordinator, to drop `db.end()` from `tests/transport-boarding.e2e.ts`.

Observed at babbbaa, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 172/172 PostgreSQL and unit tests, 66/66 Chromium, 1/1 tutor.

**Coordination (2026-11-28, 10:30 UTC):**
- Request to Dot: in `tests/transport-boarding.e2e.ts` line 65, drop `await db.end();` (keep `owner.end()`). Every e2e file shares one Playwright worker and one `lib/db` pool, so a second `end()` fails with "Called end on pool more than once". This was the only failure in the dry-run merge. The test only runs with `NEXUS_TRANSPORT_LOCAL_TEST=1`, which the review run will set.
- Request to Dot: please expose a read function for routes and stops the caller may see (for example `lib/transport` `searchableRoutes(scope)`), so universal search (ID-014) can include Transport. Until then, search covers transport by intent shortcut only.
- Standing test rule from the founder, added to AGENTS.md: 390 px and 1366×768 (1920 for office and HOD dashboards), no overflow, cards on phones and tables on laptops, visible keyboard focus, 44 px targets, and screenshots at both sizes.
- Claimed by cc: ID-014
- Claimed by cc: ID-015
- Claimed by cc: ID-016
- Claimed by cc: FC-030 (bus-delay attendance context; built on a local branch, lands after the transport merge)

**Universal search (1661202, `db/082`), ID-014:**
- **Header bar:** a search bar sits in every workspace header, and "/" focuses it when you aren't typing. Ctrl/Cmd+K stays with the existing page palette, which already used it, so it isn't taken over. On phones the bar is a full-width row; on laptops it shares one header row and the workspace label truncates.
- **Sources:** each kind of result is still read through its own access-checked reader. Search now also covers courses, assignments, people and cases. People follow rosters: a teacher sees their current students, a student their current teachers, the office every member. Transport routes and stops wait for a read function from Dot (Request to Dot, above).
- **Matching:** every typed word, or a related word, must start a word in the text. Words of five letters or more also match close typos through pg_trgm `strict_word_similarity` ≥ 0.4, so "circulr" finds "circular" and "atendence" finds attendance.
  - Related words: a built-in list of English and common Kannada transliterations, plus the office's own groups (admin-only, audited).
  - Short words don't fuzzy-match: "bus" scored 0.75 against "Business".
- **Decision:** the pg_trgm extension is added, but no GIN indexes. Search scores only rows the reader already allowed (a few hundred per kind, in one `unnest` query) and never scans a table unscoped, so an index wouldn't be used.
- **Results:** intent shortcuts go to pages the role can open; "Go to" results rank first. Results are grouped by type, best first. On a miss, "Did you mean" suggests the closest word (`similarity` ≥ 0.25, because transposed letters score low) from what the person may see. The last eight searches are kept per person and workspace.
- **Evidence:** screenshots at 390 px and 1366×768 in `docs/evidence/search-2026-11-28/`.

Observed at 1661202, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 174/174 PostgreSQL and unit tests, 66/66 Chromium, 1/1 tutor.
- Matrix: 135 tested, 89 partial, 238 missing (483 rows with ID-014 to ID-016), 8 unverified, 13 blocked.

**App install (21df2bc), ID-016:**
- **Assetlinks:** `/.well-known/assetlinks.json` is built from `NEXUS_ANDROID_PACKAGE` and `NEXUS_ANDROID_SHA256`. Fingerprints are validated, and the route returns 404 unless both are set. The APK build steps (PWABuilder or Bubblewrap, free) are in DEPLOYMENT.md.
- **Get the app:** `/get-app` is public and orders Android, iPhone and laptop steps by user agent. The APK download appears once `NEXUS_ANDROID_APK_URL` (HTTPS) is set.
- **Install banner:** in a browser tab every page shows an in-page install banner, not a fixed overlay, so it never covers controls. "Not now" hides it for the visit (sessionStorage). It never shows when the app runs standalone (display-mode or `navigator.standalone`).
- **Not done:** no APK has been built; that needs the final domain and a signing key the college keeps.
- **Blocker:** `playwright.webkit.config.ts` is ready but not run, because the sandbox has only Chromium and installing browsers here isn't allowed. Run it on a machine with Playwright's WebKit.
- **Evidence:** `docs/evidence/install-2026-11-28/` has Android and iPhone at 390 px and laptop at 1366.

Observed at 21df2bc, fresh local PostgreSQL in CI order:
- migrate ×2 + seed, lint, typecheck and build passed.
- 175/175 PostgreSQL and unit tests, 68/68 Chromium (the banner breaks no existing flow), 1/1 tutor.
- Matrix: 135 tested, 90 partial, 237 missing, 8 unverified, 13 blocked.
### Request to integration: Transport handoff (dot/transport)

Request to integration: For 5b bus delay, expose an integration-owned, transactional attendance service accepting tenant, transport incident, exact trip ID, Asia/Kolkata service date, and a deduplicated list of confirmed affected rider account IDs. Resolve each rider's first scheduled academic period for that day using the current institution/section/enrollment and timetable, then record a reversible `bus_delay` excuse for a late mark only. Keep the original attendance observation and audit reason, never convert absent or unrecorded to present, never override a teacher's manual decision, and make repeated submissions idempotent by incident/trip/day/student/period. Notify the assigned class teacher and that rider's current mentor with the minimum necessary fields, no accident or location details. Re-check tenant, scope, role and verified impact at execution. Provide a test seam so transport can supply fixture evidence without touching attendance or staff notification code.

Request to integration: With the existing migration 036 navigation condition, the addition of app/transport/page.tsx inserts Transport in the visible faculty mobile dock and displaces Evaluation queue (observed in tests/faculty.e2e.ts:29 suite during the initial transport catalog run). Please restrict the existing link to student/transport/driver and keep the standard student dock order. dot/transport is not editing app/chrome.tsx.

Request to integration: After teacher approval, cc/pilot-access should open the approved student's `/transport?institution=<tenant-id>&role=student` workspace. The no-choice Transport view handles the bus and pickup stop itself; sign-up should not duplicate these fields.

Request to integration: Schedule the implemented one-shot transport worker (`node --import tsx scripts/transport-maintenance.ts`, migration 068) once per minute on the approved pilot target. It deletes positions past 168 hours and records one warning per missed notice revision even with the office closed. Use the validated worker database role, monitor failures, and verify schedule uptime and deletion timing in staging. The transport branch does not modify shared worker or deployment configuration.

Transport local verification (dot/transport; not yet pushed): at 2e1b0e1 fresh migration count 53, repeat no-op, baseline seed/lint/typecheck/build passed, PostgreSQL and Node 174 passed, standard Chromium 56 passed/11 skipped/3 failed, tutor fixture 1 passed. With explicit simulated device mode both targeted Chromium cases passed at 390 px. At 932c7ec the transport-only suite passed 20 tests and the parked-driver endpoint passed its loopback denial/acceptance rehearsal. Actual SIT tracking, approval and camera hardware are not verified. See docs/evidence/transport-2026-11-28/README.md.

Request to integration: The NEXUS Driver app uses transport migration 069. The existing one-shot transport worker now also queues 15-minute duty notices and 7/30-day document reminders; keep the same approved recurring transport invocation, and verify physical Android notification delivery with NEXUS Driver closed before making that pilot promise. Configure a separate server-only PIN secret and the institution's callback number; rehearse the app's own manifest, motion lock, speech voices, slow data, and emergency procedure on the approved phone. Keep student post-approval routing, the shared mobile dock, and 5b attendance effects with their existing owners.

### 2026-11-28 — Integration: cc/pilot-access@92b50f2 + dot/transport@00191bf → audit/nexus-engineering-audit
- **Review of dot/transport:**
  - Migrations 055–069 are inside Dot's range.
  - Outside lib/transport, app/transport, app/api/transport, app/actions/transport.ts, tests/transport* and docs/TRANSPORT_*, it adds the driver app (`app/driver/*`, `public/driver-assets/*`), which is transport scope, and ledger entries. No dependency changes.
  - The earlier request (shared pool) was fixed in 51bb807.
- **Conflicts:** only this ledger (append-only; both sides kept).
- **Transport test settings:** these browser tests need `NEXUS_TRANSPORT_LOCAL_TEST=1`, `NEXUS_TRANSPORT_SIMULATION_ENABLED=true` and a fictional `NEXUS_TRANSPORT_BOARDING_SECRET` on the test server, as documented in TRANSPORT_LOCAL_HANDOFF.md. Without them the boarding and driver tests fail; with them they pass. Never set them in the pilot.
- **Matrix:** the transport rows remain at the status Dot recorded in the registry; integration doesn't promote them.

Observed at 8f1b761 (the merge), fresh local PostgreSQL in CI order, with those settings:
- migrate ×2 + seed, lint, typecheck and build passed.
- 196/196 PostgreSQL and unit tests, 71/71 Chromium, 1/1 tutor.
- Matrix: 135 tested, 90 partial, 237 missing, 8 unverified, 13 blocked.

**Bus-delay attendance context (9c83fe9–bd85542), FC-030 (Dot's 5b contract):**
- A teacher's class view shows "Bus delayed this morning" for a student only when all of these hold:
  - the student's boarding is recorded on an inbound college trip that ran that day;
  - a disruption was raised on that trip before the class ended;
  - this is the student's first published or conducted class that day.
- It's computed on read: no table, no write and no mark change; the teacher's mark stands. It shows only the reported time, never the incident kind, location, injuries or other riders.
- Route membership alone doesn't count. Other teachers, students and other colleges see nothing.
- There's no "late" status in attendance (only present and absent), so this is context only, and there's no mentor view yet.

Observed at bd85542, fresh local PostgreSQL in CI order, with the transport test settings:
- migrate ×2 + seed, lint, typecheck and build passed.
- 197/197 PostgreSQL and unit tests, 72/72 Chromium, 1/1 tutor.
- Matrix: 135 tested, 91 partial, 237 missing (484 rows), 8 unverified, 13 blocked.

**Phone and laptop sweep (5014253), ID-015:**
- `tests/layout-sweep.e2e.ts` signs in as student, faculty, HOD and admin. Each of their main pages must answer 200 and must not scroll sideways at 390 px and 1366×768; the HOD and office pages are also checked at 1920.
  - Student pages include home, timetable, transport, CLUBVERSE, notices, cases, search and settings.
  - Faculty pages include home, timetable, grading, student approvals and facilities.
  - Office pages include pilot health, students, facilities and cases.
- No overflow was found. On laptop, pages have side navigation and the full-width header with search.
- Not done: two-column queue and detail layouts on laptop.
- Screenshots: `docs/evidence/layout-2026-11-28/`.

Observed at 5014253, fresh local PostgreSQL in CI order, with the transport test settings:
- migrate ×2 + seed, lint, typecheck and build passed.
- 197/197 PostgreSQL and unit tests, 76/76 Chromium, 1/1 tutor.
- Matrix: 135 tested, 91 partial, 237 missing, 8 unverified, 13 blocked.

**Dec 2 demo, transport first:**
- DEMO_DEC2.md opens with the bus. The transport office (Rohan Roy) starts the simulated Cedar line trip and publishes one fictional position. Asha's "My bus" then shows "Simulated · Fictional trip, not real bus tracking", the distance to Fern Square, "about 5 minutes away" and the time at each stop.
- Setup now loads Dot's transport demo seed (`NEXUS_TRANSPORT_DEMO_SEED=1`) and starts the app with `NEXUS_TRANSPORT_SIMULATION_ENABLED=true`, for the demo only.
- `tests/demo/dec2.rehearsal.ts` has step 0 for this. The full rehearsal passed on a fresh demo database at about 11:17 UTC (1/1).
