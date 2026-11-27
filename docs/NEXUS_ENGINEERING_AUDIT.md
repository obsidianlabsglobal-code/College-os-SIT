# NEXUS engineering audit — 27 November 2026

Auditor: Claude Code (also an author of parts of the audited code; see "Independence" below).
Baseline: `main` at `c0902ae` (merge of PR #16). Audit branch: `audit/nexus-engineering-audit`.
Data: fictional seed only. No production system, real SIT record, credential or paid provider was touched.

## 1. Sources reconciled

| Source | Read | Notes |
| --- | --- | --- |
| NEXUS 3.0 Master Product & Engineering Handoff (PDF, 33 pp.) | Sections 01–27, Appendix A–C, R01–R05 | R06–R10 viewed only as gallery thumbnails in the Design Bible |
| Engineering Reference Pack ZIP | `NEXUS_MASTER_SPEC.md` (same text as PDF), B01–B05 boards | B00 master board not opened at full resolution |
| NEXUS UI/UX Design Bible (PDF, 58 pp.) | Full text extracted | Tokens, components, motion, chart contracts, domain atlas, automation, stack, 30 boards |
| "Latest NEXUS logo" | **Not supplied as a file** | Repo has an N/orbit mark in `app/experience/brand.tsx`; Bible asks founder to approve a simplified vector mark |
| `docs/NEXUS_MASTER_FEATURE_REGISTRY.md` | Parsed all 480 rows | Generated [traceability matrix](NEXUS_TRACEABILITY_MATRIX.md) |

## 2. Repository state (verified, not taken from summaries)

- `main` `c0902ae`; 64 commits; PRs #1–#16 all merged (none open). Authors on main: Krishna 38, obsidianlabsglobal-code 20, Claude 6.
- Unmerged remote branches (Codex/Dot work, not reviewed in depth, not on main): `design/nexus-faculty-timetable` (1), `design/nexus-sites-direction` (4), `design/nexus-ux-quality` (3), `feature/nexus-attendance-workbench` (5), `feature/nexus-campus-change-brief` (2), `feature/nexus-fee-approval` (5), `feature/nexus-fee-batch-review` (4), `feature/nexus-fee-reconciliation` (3), `feature/nexus-fees-preview` (2), `feature/nexus-prepared-messages` (6). All carry `[skip ci]` on their tips, so CI has not verified them.
- Stack: Next.js 16 app router + server actions, React 19, TypeScript 6, PostgreSQL (`pg`), Better Auth, Zod 4, Tailwind 4 + CSS tokens, Anthropic SDK 1.6.0, Playwright 1.65, `node:test` via tsx. Code size: app 3.2k lines, lib 3.1k, db 0.6k, tests 2.9k.
- Database: 17 migrations, 41 tables (identity, academics, assignments/grades/attachments, audit, notices, service requests, CLUBVERSE, AURA, resource booking, class sessions/attendance, opportunities, admissions). Two files share the `011_` prefix (`011_academic_sessions`, `011_aura_runtime`); ordering is lexical and they are independent, but the prefix convention is broken.
- Routes (all dynamic): `/`, `/admin`, `/assignments/[id]`, `/aura`, `/clubverse`, `/clubverse/[id]`, `/clubverse/booking`, `/courses/[id]`, `/files/[id]`, `/grading`, `/join/[kind]`, `/login`, `/notices`, `/opportunities`, `/requests`, `/timetable`, `/api/health`, `/api/auth/*`.
- CI (`.github/workflows/ci.yml`): audit, double migrate, seed, lint, typecheck, build, PostgreSQL tests, Chromium e2e, tutor browser suite. Release and hosted-acceptance workflows exist; **no hosted acceptance run is recorded** and the GitHub deployments/environments API is not reachable from this environment.
- Hosting: `render.yaml` and `docs/SIT_USABILITY_PILOT.md` describe a Render Free + Neon Free fictional pilot. No deployed URL was observed. Status: **not hosted (unverified)**.

## 3. Tests executed in this audit (exact results)

Environment: fresh embedded PostgreSQL 18 data directory, `npm ci`, all 17 migrations from empty, fictional seed. Node 24.22 for PostgreSQL tests (container default is Node 22; CI uses 24).

| Check | Result |
| --- | --- |
| `npm ci` / `npm audit --omit=dev` | 0 vulnerabilities |
| Fresh migration 000→015 | 17 applied in 0.75 s |
| `npm run lint` / `npm run typecheck` | pass / pass |
| `npm run build` | pass, 19 routes |
| PostgreSQL integration (`tests/*.test.ts`) | **47 / 47 pass** (18.7 s) |
| Chromium e2e (`playwright test`) | **24 / 24 pass** (1.2 min) |
| Tutor browser suite (`playwright.tutor.config.ts`, fixture provider) | 1 / 1 pass |
| Crawl, 8 personas, 1440 px (`crawl-results-1440.json`) | 319 page loads, 0 non-200, 0 console errors, 0 horizontal overflow, 0 axe WCAG 2.1 A/AA violations |
| Crawl, 390 px (`crawl-results-390.json`) | 102 page loads, same zero results |
| Permission probes (`permission-probes.json`) | 520 requests: each persona gets 200 only for its own role+tenant (38); 482 cross-role/cross-tenant/forged → 404; unauthenticated → `/login` |
| Local timing (loopback, not representative) | page load p50 646 ms, p90 676 ms; LCP 260–636 ms, CLS 0 on 6 pages (`vitals-throttled-390.txt`; CDP network throttle did not take effect, so treat as an upper bound on server speed only) |

Evidence: `docs/evidence/engineering-audit-2026-11-27/` (56 screenshots on a clean seed + JSON results).

### Defects found

1. **Invisible active navigation label on `/admin` (desktop).** The active "Academic setup and roles" link renders text `rgb(237,245,236)` on background `rgb(237,245,236)`. axe did not report it, which shows the limits of the automated scan.
2. **`scripts/seed-walkthrough.sql` fails on current main**: it requires exactly 16 applied migrations; main has 17 (`Unexpected database contents; walkthrough seed cancelled`). The documented pilot walkthrough cannot be prepared.
3. **Base seed is nearly empty**: a fresh student sees no assignments, classes, attendance, notices or opportunities. First-run screens are all empty states, so the visual comparison below is against empty data.
4. **Test runs pollute the demo database**: e2e suites write UUID-named assignments, notices and rooms into the same local database the demo uses (seen before reseeding).
5. **Two model-calling paths**: `lib/aura/provider.ts` (SDK, `aura_model_call` ledger, budget caps) and `lib/aura/tutor.ts` (raw `fetch`, separate `aura_tutor_usage` ledger, enabled only when `AURA_MODEL_ENABLED !== "true"`). Two ledgers mean the spend cap is not global.
6. **Attendance "classes needed" is missing**: `app/timetable/forecast.tsx` evaluates a user-entered scenario with exact integer maths, but the Bible/handoff contract ("130/150 needs 50 consecutive classes for 90%") is not computed or shown.
7. **CSP is partial**: `frame-ancestors`, `object-src`, `base-uri` only; no `default-src`/`script-src`. No `Permissions-Policy`. HSTS is left to the host.

## 4. Verified functionality (what genuinely works locally)

Every item below was exercised by the passing suites above on a fresh database.
- Identity: Better Auth sign-in/out, PostgreSQL-backed login throttling, multi-role workspace selection, server-side tenant/role checks, transactional audit with rollback.
- Academics: admin catalog (departments, schemes, terms, courses, sections, offerings, rosters, role grants); roster-scoped course workspaces; assignment create/publish/submit (text or private file)/grade draft/publish/correction; faculty mission control and evaluation queue; weekly timetable publication with overlap/adjacency/DST checks, cancellation and moves; bulk attendance with roster snapshot and revision history; versioned advisory attendance targets; what-if scenario check.
- Communication and services: scoped notices (institution/department/course), service requests with admin transitions, leadership aggregate counts, staff-verified opportunity directory, fictional student admission preview.
- CLUBVERSE: proposal → review → recognition, membership, officer grants and revocation, leadership transfer, event approval, final-seat concurrency, attendance evidence, conflict-safe venue booking with custodian approval.
- AURA: deterministic direct reads (assignments, pending work, next class, timetable, attendance, results, evaluation queue, notices, requests, clubs) with zero model calls; consent-gated model interpretation with budget reservation, ledger and validation (tested only with a test double); event-draft proposal → preview → owner confirmation → persisted draft; budgeted tutor (fixture provider only).

**No real Anthropic inference has ever been recorded** in this repository's evidence. All model paths are tested against doubles or fixtures.

## 5. Coverage of the 480-capability registry

From the [traceability matrix](NEXUS_TRACEABILITY_MATRIX.md): 63 functionally tested (local), 8 implemented but unverified, 6 partially implemented, 13 blocked by an actual dependency (hosted staging access, guardian consent policy), **390 missing (81%)**, 0 hosted and verified, 0 user-validated. Entire domains with zero implementation: personal learning, sports, student mobility, transport operations, all 78 specialist agents, all 15 invention systems. Guardian is blocked on consent policy.

## 6. UI/UX against the Design Bible and boards

| Dimension | Bible / boards | Running app (main) |
| --- | --- | --- |
| Palette | Porcelain #F9F7F3, ink #25232E, violet #6E54B7, lavender/mint/sky/apricot/rose tints; dark #171720 | Forest green rail #204537, sage accents ("Living Atmosphere", PR #14). **Direct conflict** with the newer Bible |
| Typography | Inter/system sans; optional editorial serif for AURA/hero; tabular numerals | Inter body + Instrument Serif display headings everywhere (closer to an editorial site than an OS) |
| Navigation | Student dock Today/Learn/AURA/Campus/Profile; staff sidebar + command palette + action inbox | Desktop: full-height green sidebar. Phone: bottom bar Overview/Timetable/Notices/CLUBVERSE/More; AURA not in the dock; no command palette, global search or inbox |
| Home | Next-class hero, quick-action grid, due list with priority chips, attendance ring with exact counts | Text-first "next best move" card, four count tiles, list of assignments; no rings, charts or schedule rail |
| Timetable | Day/Week/Month segmented control, date strip, timeline with Now marker | Link row (Previous/Today/Day view/Next), ISO dates (`2026-11-27`), collapsed week calendar |
| Visual intelligence | Rings, bars, trends, heatmaps, graphs with data contracts | **No charts exist anywhere** |
| Motion | Spring tokens, card→detail continuity, adaptive dock, action capsule | CSS colour transitions only; focus mode toggle |
| AURA | Warm reading surface, structured cards, citations, action capsule | Request cards with path/state badges and evidence; no streaming, no capsule state animation |
| Accessibility | WCAG 2.2 AA | 0 automated violations; one real invisible-text defect; 44–48 px targets mostly met |

Conclusion: the current UI is clean, accessible and honest about data, but it is a different visual identity from the Bible and has no visual intelligence layer. Closing this gap is mostly a front-end foundation task (tokens, components, chart kit, dock, motion) applied across existing data — not a backend rewrite.

## 7. AURA architecture (actual)

`app/actions/aura.ts` → `lib/aura/assistant.ts` (request row with state machine created→interpreting/executing→prepared→awaiting_confirmation→succeeded|failed|cancelled, nonce idempotency, hourly rate limits) → `lib/aura/router.ts` (deterministic intents) → `lib/aura/capabilities.ts` + `academic-tools.ts` (typed wrappers over domain services) → optional `provider.ts` (Anthropic SDK structured output, gated by enable flag, key, institution allowlist, per-model price, per-call/daily/total caps, user consent) → `tasks.ts` (event preview/confirm using CLUBVERSE `saveEventDraft`). Separate `tutor.ts` path. No durable worker, scheduler, outbox, notifications, retrieval/citations, multi-step orchestration or agent registry beyond one event planner. The 78 agents are registry rows only.

## 8. Weaknesses

- Security: partial CSP; files stored as `bytea` in PostgreSQL (fine for the pilot, not for scale); no notification/outbox so cross-module coordination is synchronous only.
- Architecture: no shared component library (pages hand-compose CSS classes); no chart primitives; duplicated model paths and ledgers; no background execution, so "automation" cannot exist yet; seed/fixture tooling is brittle.
- Process: ten unmerged `[skip ci]` branches from other agents risk divergence; registry statuses are hand-maintained, so they can drift from the code; regenerate the matrix after each merge.

## 9. Recommended engineering path

1. **Keep** the modular monolith, PostgreSQL schema, domain services, permission model, AURA governance and test harness. They are sound and verified.
2. **Design foundation first (W2):** replace tokens with the Bible palette (light + dark), add typed primitives (Button, Card/Bento, Ring, Bar, Sparkline, Segmented, Sheet, Dock, ActionCapsule, Empty/Stale states), SVG chart kit with data contracts (no chart library needed initially), Motion only where layout continuity needs it.
3. **First vertical slice:** Student Today + timetable + attendance (exact counts, classes-needed maths, ring) + AURA action capsule, exactly as the Bible prescribes, with screenshot baselines.
4. **Automation foundation (W4):** transactional outbox table + a Render (or cron) worker for reminders, deadline sync, attendance recalculation and request routing; measure baseline minutes before claiming any percentage.
5. **Unify AURA providers** into `provider.ts` with one ledger; add retrieval with citations over permitted records; then build agent families as configurations of the same runtime.
6. Infrastructure: keep the current Postgres provider choice open; one authoritative database (Neon or Supabase, not both); Vercel or Render for the web app; Render worker only when the outbox exists. No provider changes without founder approval.

## 10. Independence

Claude Code wrote parts of FC-001/FC-011 and the AURA runtime. Those areas were re-tested here but not independently reviewed. Dot/Codex branches listed in §2 were inventoried, not reviewed. Screenshots are from a clean seed with mostly empty data.

## 11. Open questions for review (ChatGPT / founder)

1. The Bible's violet/porcelain identity conflicts with the merged forest-green "Living Atmosphere". Confirm the Bible supersedes it (this audit assumes yes).
2. Which logo file is canonical? None was supplied.
3. Which unmerged Codex/Dot branches (fees, attendance workbench, prepared messages, campus change brief) are approved to integrate?
4. Database provider for the pilot: Neon (already documented) or Supabase (Bible candidate)?
5. Approve a real Anthropic smoke-test budget (e.g. ≤ $1) and a key in secret storage, or keep model paths fixture-only.
6. Definition of "current term" and attendance policy source for eligibility (SA-007).
