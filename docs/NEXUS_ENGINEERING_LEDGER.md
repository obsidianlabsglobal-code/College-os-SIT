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
