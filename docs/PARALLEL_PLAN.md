# NEXUS College OS — parallel build plan to 2 December 2026

Prepared 28 Nov 2026 by the integration session (Claude) on `audit/nexus-engineering-audit`, head after commit `0a0f185` (draft PR obsidianlabsglobal-code/College-os-SIT#17).
Counts come from `docs/NEXUS_TRACEABILITY_MATRIX.md` at `0a0f185`:

| Class | Count |
| --- | --- |
| Functionally tested (local) | 126 |
| Partially implemented | 65 |
| Implemented but unverified | 8 |
| Blocked | 13 |
| Missing | 268 |
| **Total** | **480** |

The request quoted 272 missing and 61 partial. Those were the counts one batch earlier; the outcomes batch moved four rows from missing to partial.

This plan starts no sessions. The founder starts each one by pasting its brief from section 4.

Fictional data only. Nothing merges to `main` or deploys without the founder's authorization.

---

## 1. Modules

Each module owns a branch, a migration range, a set of registry IDs and the files listed in its brief. The integration session (section 6) owns everything shared.

| # | Module | Registry IDs (not yet fully tested) | Rows | Branch | Migrations |
| --- | --- | --- | --- | --- | --- |
| M1 | Campus mobility (transport) | TR-001–TR-026, TO-001–TO-020, SL-006, AD-034, LE-016 | 49 | founder decides (section 7): `experience/transport-foundation` brought up to date, or `module/transport` | 040–047 |
| M2 | CLUBVERSE completion | CL-002–CL-004, CL-005–CL-016, CL-020, CL-024–CL-028, CL-032–CL-051 (missing ones), SL-003, SL-004, SL-005, SL-017, DH-020 | 42 | `feature/clubverse-core` (AGENTS.md: CLUBVERSE work stays on its branch), rebased on the audit branch | 048–055 |
| M3 | Careers, research and innovation | CR-003–CR-004, CR-011–CR-012, CR-017–CR-030, CR-034–CR-037, AD-027, AD-028, LE-013, LE-014, FC-021 (complete), FC-022, FC-023, FC-024 | 30 | `module/careers-research` | 056–063 |
| M4 | Offices, records and money | AD-002, AD-005, AD-013, AD-014, AD-015, AD-025, AD-026, AD-030, ID-009 (complete), ID-010–ID-013, LE-006, OP-010, OP-011, OP-017 | 17 | `module/offices` | 064–071 |
| M5 | Academic quality and department | FC-003, FC-010 (rubrics), DH-008, DH-018, DH-019, DH-021, DH-024, LE-017, OP-001, SP-002, SP-012, SP-013, SP-014, SP-024, SL-002, AD-033, plus completing SP partial rows | 16 (+9 SP partial) | `module/academic-quality` | 072–079 |
| M6 | Personal learning (no model) | PL-004–PL-015 (deterministic: planners, flashcards and quizzes from the question bank, revision plans, goals, saved materials, reflection) | 12 | `module/personal-learning` | 080–085 |
| M7 | AURA agent catalog, fixture only | AGST-*, AGFT-*, AGHD-*, AGEX-*, AGOF-*, AGCM-*, AGCP-* (78), AI-011, AI-012, AI-015, AI-016, AI-017, AI-018, AI-019, AI-020, AI-002/AI-009 verification | 88 | an AURA branch (AGENTS.md); founder confirms which of `feature/aura-*` | 086–095 |
| — | Not scheduled before Dec 2 | INV-001–INV-015 (research portfolio), PL-001–PL-003 and PL-016, FC-029, DH-026, DH-027, LE-020, SP-022 (model-dependent or research-grade), GU-* (blocked) | 37 | — | — |

Every missing and unverified row is in exactly one module or the not-scheduled line. Partial rows in a module's domain are that module's to finish. The remaining partial rows (attendance, timetable, examinations, approvals, delegation, notifications and AI cost and worker rows) stay with the integration session.

### Shared code that must land first (integration session, by 29 Nov 06:00 UTC)

Most past merge conflicts came from shared files: `app/chrome.tsx`, `app/actions/planning.ts`, `lib/cases.ts`, `lib/automation.ts`, `app/styles.css` and the registry.

1. **Navigation registry.** Move destinations out of `app/chrome.tsx` into `app/navigation/<module>.ts` files. Each file exports `{ href, label, icon, roles }`. Chrome imports one index, so a module adds its page without touching `chrome.tsx`.
2. **Case-kind registry.** `lib/cases.ts` reads its kinds from `lib/case-kinds/<module>.ts`: readers SQL, coordinator role, open rules and labels. Each module that needs an approval or incident flow registers kinds in its own file, with its own migration altering the kind check. To avoid a constraint race, the integration session replaces the check constraint with a lookup table `case_kind(kind)`. Modules then insert rows instead of altering constraints.
3. **Notification-kind registry.** `notifications()` takes its visibility rules from `lib/notification-kinds/<module>.ts`.
4. **Templates T1–T4** (section 3) as shared helpers in `lib/templates/`, each with its own tests.
5. **Test helpers.** `tests/helpers.ts` provides `personas()`, `rejects()`, `local()`, `signIn()` and `at()`, so module tests stop copying them.
6. **Migration ranges reserved** as in the table. Claude's integration range stays 035–039.

---

## 2. Demo-critical for 2 December (build these first in each module)

The demo story follows one fictional SIT day across roles.

| Module | Demo-critical IDs | Why |
| --- | --- | --- |
| M1 | TO-001, TO-002, TO-003, TO-006, TR-001, TR-003, TR-004, TR-005, TR-006, TO-008, TO-009, TO-017, TR-009, TR-010, TR-011 | A bus pass, QR boarding and a **fictional simulated** bus position and ETA. No live GPS without devices (TO-005, TR-008 stay simulation). |
| M2 | CL-025, CL-026, CL-028, CL-044, CL-045, CL-046, SL-003, CL-039 | Officer terms and elections, notices, event waitlist, volunteers and feedback, verified achievements. |
| M3 | CR-017, CR-018, CR-019, CR-029, CR-030, CR-028, AD-028, LE-014 | Mentor and project discovery, research teams, certifications, placement office and leadership placement view. |
| M4 | AD-002, ID-013, AD-005, AD-014, ID-012 | Account onboarding is needed for any pilot. Records, scholarships and approved CSV import of fictional rosters. |
| M5 | FC-010, OP-001, DH-008, DH-024, LE-017 | Rubric grading, room scheduling, timetable planning, accreditation evidence pack from existing outcome data. |
| M6 | PL-004, PL-005, PL-006, PL-008, PL-015 | Study plan from real deadlines, focus timer, revision plan, quizzes from banked questions, goals. |
| M7 | AGST-001, AGFT-004, AGHD-001, AGEX-001, AGOF-003 | One fixture-backed agent per role: daily planner, feedback drafting, HOD and executive briefings, request routing. Each drafts only; a human approves. |

---

## 3. Templates for repetitive capabilities

| Template | Shape | Capabilities generated from it |
| --- | --- | --- |
| **T1 Community kind** | One config row (kind, label, who may found it, advisor rule, visibility) on the existing CLUBVERSE organization model | CL-005, CL-006, CL-007, CL-009, CL-010, CL-011, CL-012, CL-013, CL-014, CL-015, CL-016, SL-004, SL-005, DH-020 |
| **T2 Verified directory** | Office-verified listing with official HTTPS source, kind, optional department rule, search, withdraw-with-reason (generalised from `lib/opportunities.ts`) | CR-003, CR-004, CR-017, CR-029, SL-003, OP-010, TR-026, AD-025 holdings view |
| **T3 Request → authority decision** | Case-engine kind: requester, coordinator role, readers, assign, decide with reason, reopen window, audit, notification | AD-014, AD-015, CR-020, CR-035, CL-033, CL-034, CL-036, CL-050, SP-014, TR-004, TR-024, TR-025, OP-011, AD-026 |
| **T4 Proposal → review → milestones** | Generalised from `research_project`: proposer, reviewer role, approved state, dated milestones with evidence | CR-018, CR-019, CR-023, CR-024, CR-034, CR-036, CR-037, CL-032, LE-013 |
| **T5 Agent catalog entry** (M7 only) | Typed input → deterministic or fixture draft → receipt → human approval → write through an existing domain service (the pattern of the existing AURA event draft) | All 78 AG* rows |

A module that uses a template adds config and tests, not new state machines.

---

## 4. Session briefs (paste one into a new session)

Every brief includes the **common rules** below; paste them together.

> **Common rules (all modules).**
> - **Repository and branch.** Repository `obsidianlabsglobal-code/College-os-SIT`. Cut your branch from the latest `audit/nexus-engineering-audit`, after the shared foundation commit named in `docs/PARALLEL_PLAN.md` §1. Rebase daily. Never push to `main`, never force-push a shared branch, never delete branches.
> - **Stack.** Node 24 and npm, Next.js server components and server actions, `pg`, Zod 4. Follow AGENTS.md and the patterns in `lib/sports.ts` and `lib/outcomes.ts`.
> - **Write pattern.** Every write goes Zod → `transaction()` → lock the membership → lock the record → check state → write → `audit()`, metadata only. Grant columns in the migration. `FOR UPDATE`/`FOR SHARE` needs an UPDATE grant on that table.
> - **Tenancy and access.** Tenant-scoped composite keys. Every read re-checks the current membership or roster in SQL.
> - **Files.** Use only the files and migration range in your brief. Register navigation, case kinds and notification kinds in your own registry files. Do not edit `app/chrome.tsx`, `lib/cases.ts`, `lib/automation.ts`, `app/actions/planning.ts` or another module's files. If you need a shared change, write a line in `docs/NEXUS_ENGINEERING_LEDGER.md` headed "Request to integration:".
> - **Data and secrets.** Fictional data only; no real SIT records. No credentials in Git. No model or API spend: AURA stays fixture-only.
> - **Test bar.**
>   - `tests/<module>.test.ts` and `tests/<module>.e2e.ts` each start with `// covers: IDs`.
>   - Integration tests prove the main path and the denials: wrong role, other section, other tenant (check by content, not id), stale state and double decision.
>   - Browser tests cover the main path at 390 px with no horizontal overflow. Copy screenshots to `docs/evidence/<module>-<date>/`.
>   - Run a fresh-PostgreSQL CI-order pass before handback: migrate twice, seed, lint, typecheck, build, all integration tests, all Playwright tests, then the tutor config.
> - **Registry.** A row is "Tested" only when linked tests pass. Anything narrower gets a bracketed scope note, which counts as partial. Add a ledger entry with observed counts.
> - **Handback.** Push your branch. Open a **draft** PR into `audit/nexus-engineering-audit` listing the IDs, the migrations, the observed counts and any "Request to integration" lines. Do not merge it yourself. Message nothing else.

### M1 — Campus mobility

> Build NEXUS transport on the branch the founder named for transport; if none was named, stop and ask. IDs: TR-001–TR-026, TO-001–TO-020, SL-006, AD-034, LE-016. Demo-critical first: TO-001, TO-002, TO-003, TO-006, TR-001, TR-003, TR-004, TR-005, TR-006, TO-008, TO-009, TO-017, TR-009, TR-010, TR-011. Read `docs/TRANSPORT_PRODUCT_SPEC.md`, `TRANSPORT_DATA_MODEL.md`, `TRANSPORT_SECURITY.md`, `TRANSPORT_ETA_DESIGN.md` and `TRANSPORT_TEST_PLAN.md`, and follow them. Owns: `lib/transport/*`, `app/transport/*`, `app/actions/transport.ts`, `app/navigation/transport.ts`, `lib/case-kinds/transport.ts` (incidents and lost and found via T3), `tests/transport*.ts`, migrations 040–047. Live GPS and device integration (TR-008, TO-005, TO-018) are a **fictional simulation** only; label them so, never as operational. Passes and QR boarding: QR codes are signed, short-lived tokens verified by an authorized conductor role; never encode personal data.

### M2 — CLUBVERSE completion

> Finish CLUBVERSE on `feature/clubverse-core`, rebased on the audit branch. IDs: the CL-* rows that are missing or unverified (see `docs/NEXUS_TRACEABILITY_MATRIX.md`), plus SL-003, SL-004, SL-005, SL-017 and DH-020. First, verify the six "implemented but unverified" rows (CL-002, CL-003, CL-004, CL-008, CL-020, CL-024) with tests. Demo-critical next: CL-025, CL-026, CL-028, CL-044, CL-045, CL-046, SL-003, CL-039. Use template T1 for CL-005–CL-016, T3 for budgets, sponsorships, equipment and expenditures, and T4 for club projects. Community actions use scoped club grants (AGENTS.md). Owns: `lib/clubverse*.ts`, `lib/club-*.ts`, `app/clubverse/*`, `app/actions/club*.ts`, `app/navigation/clubverse.ts`, `lib/case-kinds/clubverse.ts`, `tests/clubverse*.ts`, `tests/club*.ts`, migrations 048–055. Follow `docs/CLUBVERSE_*.md`.

### M3 — Careers, research and innovation

> Build on `module/careers-research`. IDs: CR-003, CR-004, CR-011, CR-012, CR-017–CR-030, CR-034–CR-037, AD-027, AD-028, LE-013, LE-014, FC-021, FC-022, FC-023, FC-024. Demo-critical first: CR-017, CR-018, CR-019, CR-029, CR-030, CR-028, AD-028, LE-014. Use T2 for discovery rows, T3 for lab access and IP disclosure, and T4 for research projects, incubation, grants and experiments. Extend `lib/careers.ts` and `lib/opportunities.ts`; keep the verified-source rule. CR-004 (NPTEL/SWAYAM) is an office-verified listing only, with no scraping or unapproved APIs. CR-011 compares only evidenced records with a goal the student chose; no inferred scores. Owns: `lib/careers.ts`, `lib/opportunities.ts`, `lib/research.ts`, `app/careers/*`, `app/opportunities/*`, `app/research/*`, `app/actions/careers.ts`, `app/navigation/careers.ts`, `tests/careers*.ts`, `tests/research*.ts`, migrations 056–063.

### M4 — Offices, records and money

> Build on `module/offices`. IDs: AD-002, AD-005, AD-013, AD-014, AD-015, AD-025, AD-026, AD-030, ID-009, ID-010, ID-011, ID-012, ID-013, LE-006, OP-010, OP-011, OP-017. Demo-critical first: AD-002, ID-013, AD-005, AD-014, ID-012.
> - **AD-002:** start from `docs/SIT_ONBOARDING_PREVIEW.md` and `lib/onboarding-preview.ts`. Invitations are office-issued and expire. Verification and recovery stay local; no email sending unless the founder approves a provider.
> - **AD-013 and AD-030:** extend the fee review (`lib/fee-*.ts`, `app/fees`). Financial approvals stay with a named human role; no payments.
> - **ID-012:** CSV import of fictional rosters only, with a dry run and a per-row error report.
> - **ID-010:** retention rules are documented and enforced by a dry-run report; no deletion jobs without founder approval.
>
> Owns: `lib/onboarding*.ts`, `lib/fee-*.ts`, `lib/records.ts`, `lib/procurement.ts`, `lib/retention.ts`, `app/fees/*`, `app/records/*`, `app/onboarding/*`, `app/actions/offices.ts`, `app/navigation/offices.ts`, `lib/case-kinds/offices.ts`, `tests/offices*.ts`, migrations 064–071.

### M5 — Academic quality and department

> Build on `module/academic-quality`. IDs: FC-003, FC-010, DH-008, DH-018, DH-019, DH-021, DH-024, LE-017, OP-001, SP-002, SP-012, SP-013, SP-014, SP-024, SL-002, AD-033, plus the bracketed SP-* partial rows. Demo-critical first: FC-010, OP-001, DH-008, DH-024, LE-017.
> - **FC-010:** rubric criteria and levels per assignment. A criterion score sums to the grade draft; the existing publish flow stays the only publication.
> - **DH-024 and LE-017:** an accreditation evidence pack built from `lib/outcomes.ts`, attendance and results. Read-only, with each figure's source named.
> - **Sports:** extend `lib/sports.ts` with knockout brackets (SP-024), venue availability (SP-012) and equipment through `lib/operations.ts` custody (SP-013).
>
> Owns: `lib/rubrics.ts`, `lib/accreditation.ts`, `lib/sports.ts`, `lib/timetable-planning.ts`, `app/grading/rubric*`, `app/accreditation/*`, `app/sports/*`, `app/actions/sports.ts`, `app/actions/quality.ts`, `app/navigation/quality.ts`, `tests/quality*.ts`, `tests/sports*.ts`, migrations 072–079.

### M6 — Personal learning (deterministic)

> Build on `module/personal-learning`. IDs: PL-004–PL-015. No model calls: every feature is computed from the student's own records (deadlines, timetable, published results, banked questions, outcome evidence). Demo-critical first: PL-004, PL-005, PL-006, PL-008, PL-015. Quizzes use only banked question versions that a teacher marked practice-visible. Students never see exam items. Data is private to the student by default. Owns: `lib/learning/*`, `app/learn/*`, `app/actions/learning.ts`, `app/navigation/learning.ts`, `tests/learning*.ts`, migrations 080–085.

### M7 — AURA agent catalog (fixture only)

> Build on the AURA branch the founder confirms. IDs: the 78 AG* rows, plus AI-011, AI-012, AI-015, AI-016, AI-017, AI-018, AI-019 and AI-020. Also verify AI-002 and AI-009 with tests. Demo-critical first: AGST-001, AGFT-004, AGHD-001, AGEX-001, AGOF-003. Use template T5: typed input, then a deterministic or fixture draft, then a receipt, then human approval, then a write through the existing domain service. No direct SQL writes from agents. **No real model calls and no API spend.** The provider stays the fixture until the founder approves a key and a cap. Registry rows may say "Tested (fixture provider)" and never "operational". Owns: `lib/aura/*`, `app/aura/*`, `app/actions/aura*.ts`, `docs/AURA_*.md`, `tests/aura*.ts`, migrations 086–095.

---

## 5. Blocked capabilities and what unblocks each

| ID | Capability | What must be provided |
| --- | --- | --- |
| ID-007 | Hosted staging acceptance | Founder approval and spend for a Render web service and a background worker. A managed PostgreSQL URL (Supabase or Render Postgres) with backup and restore rights. A rehearsal window. Then exercise five roles, redeploy, verify prior work and restore from backup (`docs/DEPLOYMENT.md`). |
| GU-001 | Guardian identity | An approved identity-verification process for guardians, with an owner, evidence types and appeal. |
| GU-002 | Relationship verification | The institution's rule for what evidence links a guardian to a student, and who verifies it. |
| GU-003 | Explicit grants | An approved list of record types, purposes and maximum durations a student (or the institution, for minors) may grant. |
| GU-004 | Revocable consent | Consent wording reviewed by the institution's legal or privacy owner, including the revocation effect. |
| GU-005 | Academic progress | Approval of exactly which progress summary fields a guardian may see. |
| GU-006 | Attendance updates | Approval of the attendance fields and frequency, and a delivery channel (in-app only until a provider is approved). |
| GU-007 | Official notices | A defined "guardian" notice audience and who may publish to it. |
| GU-008 | Parent–faculty communication | An approved channel, hours, moderation and record-keeping rule. |
| GU-009 | Service requests | A list of request types guardians may start, and the delegating authority. |
| GU-010 | Transport information | Depends on M1, plus approval of which transport facts a guardian may see. |
| GU-011 | Meeting coordination | Meeting types and who schedules them. |
| GU-012 | School safeguarding model | A named safeguarding owner and a legal review of age-appropriate access before any school pilot (master plan §21). It is not needed for a college-only pilot. |

All GU rows also need a founder decision that guardian access is in scope for the SIT pilot. Fictional guardian data can be used for building once the policy exists.

Gates outside the blocked list that also limit the score:
- An Anthropic API key with a spending cap. This unlocks AURA live inference and the PL-001–PL-003 tutoring rows.
- Real participants for timed baseline tasks, for the 90% effort goal.
- Merge authorization for PR #17 and the module PRs.
- Institutional authorization before any real SIT data.

---

## 6. Integration session (Claude, this branch) and a realistic Dec 2 count

Role:
1. **29 Nov:** land the shared foundation (§1) in migrations 035–039. Push it and announce the commit hash in the ledger and in this file. Until then, modules can start on files that don't depend on the registries.
2. **Daily, about 12:00 UTC:** review each module's draft PR.
   - Check authorization in SQL, denial tests, migration ranges and file ownership.
   - Rebase the module onto the audit branch in a local integration branch.
   - Run the full fresh-PostgreSQL CI order and record it.
   - Merge into `audit/nexus-engineering-audit` by fast-forward or merge commit on the audit branch. Never into `main`.
   - Answer "Request to integration" lines.
3. Keep the registry, traceability matrix, ledger and dependencies doc consistent after each merge, and regenerate the matrix.
4. **1 Dec:** freeze the feature branches at 18:00 UTC. Run the full suite and the demo script on a fresh database, and record evidence.
5. **2 Dec:** demo from a local or founder-approved host. Nothing is labelled hosted or operational without ID-007.

Realistic count by 2 Dec, from this session's observed pace:
- Today's batches: about 12 fully tested and 34 newly partial rows in roughly 8 working hours, with full tests.
- About three working days, with five or six parallel sessions.

| Module | Likely to reach Tested or partial-with-tests by Dec 2 |
| --- | --- |
| M1 Transport | 20–28 (simulation-labelled) |
| M2 CLUBVERSE | 20–30 |
| M3 Careers and research | 18–24 |
| M4 Offices | 10–14 |
| M5 Academic quality | 14–20 |
| M6 Personal learning | 8–12 |
| M7 AURA catalog (fixture) | 15–30 |
| **Total** | **about 105–160** |

That would put the matrix at about **230–285 rows functionally tested or partial-with-tests out of 480**. Hosted, visually accepted and user-validated stay at 0 unless the gates in §5 open. The informal progress score would land in the **mid to high 40s**. It cannot pass the low 50s without hosting, real participants and the model key.

Risks:
- **Merge churn on shared files.** Mitigated by §1.
- **Fresh-DB test order effects.** One was found today in the course-delivery test.
- **Reviewer bandwidth for daily merges.** One integration session can verify about four module PRs a day.
- **The AURA branch's divergence from the audit branch.** M7 should start with a rebase and report conflicts before building.

---

## 7. Decisions needed from the founder before starting

1. **Transport branch:** bring `experience/transport-foundation` up to date and build there, or start `module/transport`.
2. **AURA branch for M7:** which `feature/aura-*` branch.
3. **Codex or Claude per module.** Suggested:
   - Codex for M1, M2 and M5 (large, well-specified).
   - Claude sessions for M3, M4, M6 and M7 (authority and approval heavy).
4. **Guardian scope (GU-*):** in or out of the SIT pilot.

## Summary

- **Modules.** Seven modules cover everything that can be built without new access: transport, CLUBVERSE, careers and research, offices, academic quality, personal learning, and a fixture-only AURA catalog. Each has its own branch, migration range, owned files and a paste-ready brief.
- **Shared foundation first.** The integration session lands navigation, case-kind and notification-kind registries, shared templates and test helpers on 29 Nov. After that, modules no longer need to edit the same files.
- **Templates.** Five templates generate about 50 rows from configuration.
- **Demo-critical first.** Each module builds its demo rows before the rest.
- **Blocked rows.** The 13 blocked rows need hosting approval (ID-007) or a guardian policy and legal decisions (GU-*).
- **Realistic outcome.** About 105–160 more rows tested by 2 Dec, bringing the matrix to roughly 230–285 of 480. Hosted and user-validated stay at 0 until the founder's gates open.
