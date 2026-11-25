# Living Atmosphere: authenticated release track

The November 24 design kit is the visual authority: its contact sheet, per-screen desktop/mobile/dark references, product blueprint and QA matrix. Its reference records, concept art, exact dates and counts are not production inputs. The public guide demo is an independent, no-login simulation and cannot satisfy these release gates.

The continuation branch starts from the tested pilot and roster-preview line that includes the earlier Living Atmosphere redesign. “Existing” below means code exists on this branch, not that its entire design or a real-user workflow has cleared acceptance. Preserve the existing server-side tenant and role checks, campus timezone, private-file access and audit behavior.

| Kit surface | Current authenticated scope | Remaining acceptance |
| --- | --- | --- |
| Design system | Shared tokens, responsive shell, theme control and scoped navigation | Review every primary route in light/dark and reduced motion; check keyboard, screen readers, Kannada and long content |
| Student Today | Scoped priority, timeline, source-backed metrics, assignment and feedback links, AURA lookup; this pass adds Focus mode and the reference hierarchy | Compare real desktop/mobile renders and run a student/guide trial |
| Faculty Mission Control | Assigned teaching and evaluation queues | Compare with faculty layout and verify draft vs publication and authentic evaluation data |
| HOD | Scoped department view | Validate metrics and reporting coverage against definitions and sample data |
| Principal | Institutional aggregate workspace | Validate metric provenance, privacy and decision workflows |
| Administration | Academic setup, role-scoped controls and isolated fictional roster preview | Finish verified Google roster identity flow and separately approve privileged onboarding |
| Timetable & Attendance | Scoped schedule and attendance | Compare day/week, phone and reduced-motion states; assess official policy and lab-subgroup gaps |
| AURA | Authorized deterministic actions and receipts; no provider calls needed for core flows | Review approval and receipt UX end to end; paid providers stay off |
| CLUBVERSE | Club and booking workflows | Review role grants, event drafts, booking conflicts and room confirmation evidence |
| Opportunities | Staff-curated records | Review provenance, expiry and withdrawn/empty states |
| Learning Studio | Future concept | Define validated pilot workflow; no invented mastery scores |
| Campus & Transport | Room booking exists separately; integrated maps, GPS and transport are future concepts | Require institution-approved campus sources and verified route/location data |
| Research and Guardian | Future concepts | Design scoped tasks, consent and visibility before enabling access |

Release check: reconcile this table with the permanent capability registry, run the kit QA matrix against the exact candidate revision, capture visual proof, and disclose any unverified checks. Host only in isolated NEXUS staging with fictional data until institutional authorization. Do not merge into main or publish a real release without the owner’s approval. Do not touch Mayur resources, records or spend.
