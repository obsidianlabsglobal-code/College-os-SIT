# NEXUS Experience 2.0 reference and implementation

## Evidence and comparison

The founder supplied the original prototype URL and described its Apple-inspired light/dark palette, welcoming dashboard, “Your next best moves”, AURA and academic tools. Both direct HTTP and Chromium requests on 22 November 2026 returned 401 with “Sign in required”. The attachment was the master plan PDF. No source captures of the prototype interface were supplied. Its exact typography, spacing, responsive behavior and motion could not be assessed.

The comparison below uses the founder’s description and the observed NEXUS baseline on f62828f. It does not assign measured qualities to the inaccessible prototype. The local baseline screenshot used the fictional Northfield institution.

| Dimension | NEXUS baseline | Experience 2.0 |
| --- | --- | --- |
| Information architecture | Student Home opens with a role heading, course list and assignment list. Notices and AURA live in their own destinations. | A campus overview starts with open assignments, active enrollments and published results. Open work is ordered by deadline. Published notices and AURA have direct destinations. |
| Visual identity | Shared warm canvas, forest accents, system type, white cards. | Student Home uses a graphite-blue hero, restrained orbit illustration and lower-density panels. Light and dark follow system preferences on Student Home. The existing type stack and role navigation carry through. |
| Interactions | Direct list navigation and role switching. | Native keyboard shortcuts jump to relevant work. Notice links open their exact published records; AURA opens existing event-plan activity. No new writes from the dashboard. |
| Components | Standard cards, lists, headings and tags. | Document landmarks, summary links and text status tags. Compact workspace heading used on Faculty, HOD, CLUBVERSE detail, and AURA. AURA uses amber for confirmation and green for saved drafts, alongside text. |
| Motion and layout | Responsive sidebar, mobile navigation, and background transitions. | Retains the authorized navigation. The hero uses a single entrance transition gated by reduced motion, with no looping animation. Mobile layouts stack in task order. |

The dashboard inherits active member and roster checks and reads only the student’s own submission/result indicators. Notices reuse publication and audience filtering. Empty panels describe the actual state. A Suspense fallback covers dashboard loading and the existing workspace error boundary handles failures. Approval, submission, publication and completion remain governed by their existing services and forms. The rebuild has no migrations.

Timetable, Focus & Planner, Knowledge Hub and Agent Studio remain in the product registry. This slice uses only available workflows. Club event planning requires organizer authority and still uses the current deterministic AURA workflow.

## Integration

This branch is based on main f62828f. Faculty PR #3 also changes the shared overview entry point in `app/page.tsx`. If it lands first, retain its MissionControl rendering and replace only its student fallback with the new student branch. Booking PR #4 has its own route and data. Preserve its event booking controls when integrating. The student-specific styles live in a CSS module and leave the faculty queue CSS to PR #3. No active feature branch is a dependency of this PR.

Follow the displayed course, assignment, notice and AURA links before extending the surface. Treat live institutional design validation, keyboard coverage with assistive technology, and comparison with a verified prototype capture as separate evidence.
