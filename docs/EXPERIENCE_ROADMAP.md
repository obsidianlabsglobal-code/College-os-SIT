# Experience and transport roadmap

1. Audit Release 1 and retain its verified workflows. Keep the December 1 candidate isolated from the experience branch.
2. Implement the shared light token system and role-aware shell. Verify baseline workflows, scope and responsive navigation.
3. Refine dashboard hierarchy and migrate repeated states, metrics and forms with real scoped data. Add search and notifications only with useful working sources.
4. Build transport schedules, routes, vehicles, scoped role grants and assignment, then student schedule-only and transport administration views. Add an independently labeled fictional replay.
5. With authorization, integrate a device source, accept position observations, calculate ETA centrally, add aggregate occupancy and alerts, and verify retention and safety behavior in hosted testing.
6. Measure task completion and time-to-destination in the interface, ETA error, tracking freshness, alert delivery, occupancy coverage and access failures. Treat plan targets as hypotheses until measured.

Key risk ordering: release regression, unauthorized location disclosure, stale or misleading predictions, operator safety, then routing costs and fanout. Dependencies for live use are operator approval, vetted devices or API access, route and stop inventory, verified capacities, designated operational staff, and approved location access and retention.

## November 22 branch verification

Local migration and seed against isolated fictional PostgreSQL, lint, type check, production build, four integration tests and five Chromium tests passed. The Chromium suite included workspace preference validation and fallback on revocation, keyboard collapse, and reduced motion. Screenshots covered five roles at 390, 800 and 1440 px with no page-level horizontal overflow. Contrast ratios for body, metadata, accent links and primary buttons were 13.91, 6.62, 7.09 and 7.60 respectively. The input border measured 3.96 against white. This was targeted browser inspection and contrast sampling. Cross-browser, screen-reader, and institutional usability evaluation remain planned.
