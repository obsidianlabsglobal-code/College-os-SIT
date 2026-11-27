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

Session summary (seven batches since 30-push): fully tested 69 → 83, partial 14 → 50, missing 376 → 326. Migrations 020–026 add 30 tables. Production readiness is still 0: nothing is hosted, no real users have been measured, and the founder approvals listed in the handoff are still outstanding.
