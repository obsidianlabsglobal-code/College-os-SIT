# NEXUS staff tools and dashboards

## Principle

Give each worker a short, useful list of the tasks they own, not a miniature copy of the principal's dashboard. Each card should answer: what needs me, how do I handle it, what proof remains? Start with scoped queues and direct actions. Give counts, dates, sources, and empty states before adding charts. Label provisional figures and distinguish no records from zero activity.

The role labels below are workflow interviews and design targets, not job titles verified at SIT or grants available in the app. Existing base roles are Student, Faculty, Department head, Institution admin and Principal. Confirm which posts own each process with SIT during the EEE pilot; part-time and shared staff need explicit, expiring scope where appropriate. A title alone grants no access.

| Worker or accountable post | First useful tool | Dashboard or visual | Automate preparation, retain human control |
|---|---|---|---|
| Faculty and lab instructors | Today's classes, assigned attendance, corrections, coursework and evaluation | Class records awaiting capture; current roll-sheet split, separate from student attendance rate | Open the current roster, preserve exceptions, compute counts. Faculty verifies the marks and saves. |
| Class coordinator and mentors | Assigned follow-ups and student support tasks | Age of unresolved assigned cases, not a public student ranking | Draft follow-up context and reminders. Staff confirm sensitive outreach; no blanket student history. |
| Department head | Department exceptions and source-linked review | Weekly capture completeness with counts and denominators; separate from attendance | Flag gaps and possible scheduling clashes. Review only assigned departments; no implicit edits to grades or fees. |
| Academic office, admissions and registrar | Roster comparison and document-request queue | Case age, missing evidence, duplicate/mismatch counts | Prepare imports and letters for approval; a named official verifies identities and issues records. |
| Principal and administration | Decisions and institution-level operations | Dated institutional trends with source, denominator and unresolved exceptions | Prepare summaries for review. Individual details are not available merely because of seniority. |
| Examination cell | Room, slot and invigilation planner | Conflict timetable with unresolved overlap | Suggest conflict-free options; approved staff publish. Keep exam materials isolated. |
| Office and approved finance staff | Reconcile college, transport, hostel and other fees | Exception counts by fee type or status, with date and exclusions | Prepare matches and discrepancies. Authorized maker and different reviewer confirm ledger changes. Preview only until approved. |
| Laboratory and stores | Inventory, equipment readiness and bookings | Availability and maintenance downtime | Flag shortages and suggest booking options, with custodian safety checks. |
| Library staff | Loans, returns and reservations | Circulation and overdue buckets for authorized library staff | Prepare due notices; restrict reading history by scope. |
| Facilities, housekeeping and campus help desk | Work orders, assignments and completion evidence | Open work orders by age and location | Route routine jobs to assigned crews. People verify completion and urgent escalations. |
| Security and reception | Approved visitor or incident routing | Eligible cases awaiting handoff, no open incident dashboard | Prepare necessary handoff information; sensitive incidents remain restricted. |
| Transport operations | Assigned routes, trips, issues and passenger notices | Route punctuality and feed freshness | Flag disruption and draft alternatives. No continuous person tracking. |
| Hostel operations | Occupancy, maintenance and routing | Room occupancy and unresolved requests | Suggest assignment or repairs; restrict resident welfare and incident records. |
| Placement, clubs and sports | Driving events, bookings and participation | Eligible-to-completed funnel, with denominators and consent gates | Suggest calendar options, validate duplicates, and draft communications for approval. |
| Research, accreditation and procurement | Deadline, evidence and approvals register | Missing evidence and overdue milestones | Draft evidence packets; independent reviewer confirms where required. No automatic orders. |

## Attendance workbench: implemented on the development branch

Extends the previously scoped Timetable and Faculty Mission Control workflows (see faculty and department sections of the [master registry](NEXUS_MASTER_FEATURE_REGISTRY.md)). The queue separates eligible ended classes across seven local calendar dates into **To record** and **Recorded**. It excludes cancelled and future classes, and unpublished marks for an empty roster are not an attendance task. Queue links go straight to the correct class.

The workbench starts unmarked, allows searching and showing only unmarked students, and offers large explicit Present/Absent buttons. The teacher can mark exceptions first and apply present to the rest without overwriting an existing mark. A separate bulk menu is reversible before the next manual edit. Filters do not change the scope of bulk actions or saving. The status bar uses text counts in addition to color. Review and save skips the long list and shows the totals. Nothing is written until the teacher saves. Corrections still require a reason and create a separate revision; class ownership, current grant, complete roster, and record version are checked by the server. The browser draft is not offline storage; reloading before save clears edits.

## Dashboard and rollout rules

- Use a stacked bar for a mutually exclusive status split, a horizontal bar for comparable queue buckets, and a line only for comparable time periods with known data. A pie/donut can work for a small part-to-whole split but is never the only way to read exact values. Provide text/table alternatives, and explain missing days and denominators.
- Automate retrieval, defaults, checks, routing suggestions, drafts and derived counts first. Before automation writes an official record, recheck role and scope, require explicit approval as appropriate, prevent conflicting or stale saves, and provide a receipt. No biometrics or continuous surveillance by default.
- Proposed next work: an EEE HOD queue showing classes without attendance recorded, and the academic-office enrollment-letter workflow. Ask each real staff group to demonstrate its current process before defining further capabilities. Validate attendance time and corrections with a small SIT-approved group rather than assuming a browser script measures ease of use. Staff attendance/payroll is a different, policy-sensitive workflow; it is not covered here.
- Keep SIS authority, roster source, retention and official fallback explicit. No production records, payments, broadcast notifications, proxy presence, or institution-wide grants in this staged pilot.

### Official WhatsApp group handoff

After an attendance record is saved, the assigned instructor sees a preview and an explicit **Copy WhatsApp update** button. The default text includes class/section, local date/time, faculty and counts; it never sends or opens WhatsApp. Draft edits are not included. An explicitly fictional preview mode can render the absent students' names with a do-not-post label. Do not enable group names for real records until SIT has confirmed the allowed recipients, channel and information to share. Do not post into student or mixed groups merely because the group is called official.
