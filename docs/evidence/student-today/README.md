# Student Today integration review

The comparison uses fictional staging accounts. The earlier captures are from PR #5. The new captures use the production Next.js build and records persisted through the academic workflows. The supplied concept image informed the priority card, semantic surfaces, typography and mobile navigation.

| Before | Integrated |
| --- | --- |
| [Desktop](before-desktop.webp) | [Desktop](desktop.webp) |
| [Mobile](before-mobile.webp) | [Mobile](mobile.webp) |
| | [Mobile dark](dark.webp) · [Empty workspace](empty.webp) |

Review of PR #5 desktop, mobile and empty screens identified five issues. The large navy introduction occupied the first task’s space. Its main action jumped to a list. Counts used three equally prominent cards. Mobile navigation wrapped across rows. The empty dashboard gave the same introductory call to action as a busy workspace.

An actively enrolled student now opens the earliest pending assignment in one action. When none is open, the priority card links to a published result or focuses the course list. Eligibility and status come from the existing PostgreSQL summary query. The service and community shortcuts retain institution and role. Timetable, weather, opportunities and AI-generated weekly plans have no data source in this slice.

The integration retains both PR histories. The home route renders Faculty Mission Control for faculty and the student component for students. PR #4 brings migration 010, a per-resource confirmation lock and a GiST exclusion constraint. The integration applies no additional schema change. The acceptance runner follows the assignment it just published when returning as faculty because Mission Control can link the same assignment from multiple sections.

## Pilot evidence still needed

| Current campus task | Local evidence | Institutional comparison needed |
| --- | --- | --- |
| Find and submit coursework | Student Today to scoped assignment and persisted submission | Approved MyCampus walkthrough, baseline time, missed deadlines, submission accuracy |
| Review and publish a result | Faculty queue, draft and released grade revision | Faculty task time, workload and correction policy |
| Obtain an enrollment letter | Student request, administrative decision and requester receipt | Office handling time, actual issuance, migration, training and support owners |
| Reserve an event venue | Officer request, custodian decision and conflicting confirmations test | Current room-allocation authority, operational volume and conflict records |

Institutional interviews, comparative timings, screen-reader user testing and replacement acceptance remain outstanding.

## Local verification

Node 24, eleven migration files applied and checked on rerun, fictional seed, lint, typecheck, production build and 17 PostgreSQL integration tests. Chromium exercised grading, membership revocation, audience filtering, service requests, booking, AURA and Student Today. Five roles exercised the release script, then verified the same records after a production application restart. Repeated sign-ins triggered the configured throttle during an immediate repeat. Verification passed after the rate window elapsed.

The browser suite checks widths of 360, 390, 768, 1024 and 1440 pixels and keyboard focus after anchor navigation. The 390-pixel capture exposed a wrapped club label, corrected with a compact visible label. The desktop axe-core 4.10.3 scan for WCAG 2 A/AA and 2.1 AA reported zero violations. At 360 pixels, a separate 200% root-text-size check with a long mixed-script heading retained a document width of 360 pixels. Font availability and Kannada language quality need device and speaker review. One local warm Chromium navigation from the primary action to visible assignment details took 93 ms. This sample establishes neither a hosted latency target nor institutional usability.
