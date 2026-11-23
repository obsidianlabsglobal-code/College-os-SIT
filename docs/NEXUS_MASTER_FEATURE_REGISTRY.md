# NEXUS master feature registry

This register preserves founder requirements across releases. Each ID identifies one capability. Keep IDs stable when names, waves or owners change. A row inherits its domain, intended users, problem, permission, data, related modules, workflow, dependencies, AURA family, wave, priority, uncertainty and source from the block above it unless the row specifies an override. The action column defines what the user must actually accomplish. The accountable engineering owner is unassigned unless explicitly recorded. Obsidian Labs owns the product vision.

Status vocabulary: Proposed, Researching, Designed, In development, Implemented, Tested, Hosted, User-validated, Production-ready, Blocked, Explicitly deprecated. “Tested” applies only to the scope described and the named revision. Hosted acceptance, institutional validation and production readiness each require separate evidence. Proposed rows have founder requirement evidence only. Designed rows have the cited specification. No SIT participation, approved policy or external integration is inferred.

Evidence keys: **R** = Release 1 at e5d507d, app/, lib/, db/000–006, tests/workflow.test.ts and the Release 1 cases in tests/release.e2e.ts. **X** = experience at f9a24f5, app/chrome.tsx, app/workspace-navigation.tsx and browser workspace tests. **C** = CLUBVERSE at cd872a5, db/007–008, lib/clubverse.ts, tests/clubverse.test.ts and Chromium club journey. **A** = deterministic AURA at 605b3c3, db/009, lib/aura/tasks.ts, tests/aura.test.ts and Chromium confirmation journey. **T** = TRANSPORT_PRODUCT_SPEC.md and companion transport designs, with no operational fleet evidence. **S** = CLUBVERSE_NEXT_SLICES.md, proposed slice designs. **L** = INNOVATION_LAB.md, hypotheses only. **P** = founder-reported prior prototype, port suitability and source availability unverified. **F** = founder directive, no implementation evidence. Experience, CLUBVERSE and deterministic AURA are cumulative on integration. **W2** = separate feature/academic-course-workspaces commit 584c31c, app/courses/[id]/page.tsx, lib/assignments.ts, roster-revocation and Chromium course tests. **FQ** = separate feature/faculty-command-center branch, lib/faculty.ts, app/faculty/, app/grading/page.tsx, tests/faculty.test.ts and tests/faculty.e2e.ts, verified with fictional and labelled synthetic records only. A status on a feature branch does not imply inclusion on integration or main.

Priority notation: P0 hosted acceptance, P1 connected daily workflows, P2 specializations and experiments. Wave numbers refer to [delivery dependencies](NEXUS_IMPLEMENTATION_DEPENDENCIES.md). Default decision for all proposed work: validate the institutional owner, data provenance and success criteria before deployment. AI is optional for ordinary workflows. Human authority governs grades, credentials, spending and access changes.

### Acceptance and measurement

Each row’s action specifies its expected outcome. Verify positive completion and relevant denial, stale state, rollback, retry and mobile behavior using the domain workflow and data in its block. Compare task completion, elapsed time, error/rework and authorization failures with the current workflow where measurable. Pilot baselines remain unmeasured unless the linked evidence says otherwise. Proposed capabilities have acceptance criteria awaiting refinement with the domain owner. Locally tested, CI verified, hosted verified, user-validated and production-approved are distinct evidence levels.

**B** = feature/campus-resource-booking, db/010_resource_booking.sql, lib/resource-booking.ts, tests/resource-booking.test.ts and tests/resource-booking.e2e.ts. See [booking behavior and verification measures](RESOURCE_BOOKING.md). No booking is represented as deployed.

## Identity, delivery and trust

Domain: shared foundation. Users: all institutional participants and authorized operators. Problem: fragmented identities and unsafe access. Resolve account → institution → active post → scoped operation and audit. Data: session, membership, roster, institution, grant, policy, migration ledger. Depends on PostgreSQL and authorized identity provisioning. All modules consume these controls. W1/P0, founder §§1–2, 14 and release directives.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| ID-001 | Authentication and sessions | Sign in and sign out with Better Auth and restricted runtime credentials. | Tested | R |
| ID-002 | Multiple institutional roles | Select a currently held workspace; identify a person independently of post. | Tested | R/X |
| ID-003 | Persistent workspace preference | Return to a still-authorized prior selection. | Tested | X |
| ID-004 | Institutional isolation | Deny unrelated tenant and section records on server reads and writes. | Tested | R/C |
| ID-005 | Accessible navigation | Navigate by role at desktop and mobile widths with keyboard and reduced motion. | Tested | X |
| ID-006 | Transactional audit | Record consequential changes and roll back writes on audit failure. | Tested | R/C/A |
| ID-007 | Hosted staging acceptance | Exercise five roles, redeploy, verify previous work and recover from backup on authorized hosts. | Blocked | DEPLOYMENT.md; provider access missing |
| ID-008 | Scoped specialist posts | Delegate class coordinator, academic mentor, specialist office and resource custodian duties for a defined scope. | Proposed | F |
| ID-009 | Account lifecycle | Provision, suspend and offboard accounts with traceable effects on grants. | Proposed | F |
| ID-010 | Privacy and retention | Define access, deletion, backups and retention per record class and institution. | Proposed | F |
| ID-011 | Institution and campus configuration | Configure campuses, departments, branding, program, scheme, locale and academic year per tenant. | Proposed | F |
| ID-012 | Approved imports and exports | Validate source authority, preview changes and reconcile batch outcomes across systems. | Proposed | F |
| ID-013 | Institution adoption and onboarding | Assess replacement, integration and overlay options with institutional owners; train and support staff. | Proposed | F |

## Student Life · academics

Students locate authoritative course work and deadlines for their enrollment. Start at workspace → select course or record → act → inspect result. Only current tenant and roster grant reads. Personal assessments remain student-specific. Data: academic catalog, scheme, term, section, roster, assessments and teaching materials. Related faculty and exam services. W2/P1 except Release 1 evidence (W1/P0). Student learning assistant optional. Founder §3 and assignment milestone.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| SA-001 | Student dashboard | Open current assignments and authorized service links. | Tested | R/X |
| SA-002 | Course directory | Browse institution-published catalog entries with visibility rules. | Proposed | F |
| SA-003 | Enrolled course workspaces | Open a roster-scoped offering and its assigned coursework. | Tested | W2 |
| SA-004 | Academic schemes and terms | Read the offering’s current scheme and term. Cohort-specific eligibility policy remains a separate requirement. | Tested | W2 |
| SA-005 | Attendance records | See verified session attendance and request corrections. | Proposed | F |
| SA-006 | Attendance percentage | Calculate from recorded sessions and approved denominator rules. | Proposed | F |
| SA-007 | Attendance eligibility | Explain eligibility with verified scheme and policy version. | Proposed | F |
| SA-008 | Attendance what-if planning | Model hypothetical future attendance with explicit assumptions. | Proposed | F |
| SA-009 | Timetable | View published class and lab slots for the active section. | Proposed | F |
| SA-010 | Academic calendar | Filter institution and course dates and deadlines. | Proposed | F |
| SA-011 | Assignments | Open a published assignment from an enrolled offering. | Tested | R |
| SA-012 | Submissions | Submit on time once, with an allowed private attachment or text. | Tested | R |
| SA-013 | Grades | Read own published score and authorized corrections. | Tested | R |
| SA-014 | Feedback | Read own published feedback while draft grades remain private. | Tested | R |
| SA-015 | Internal examinations | Find CIE dates, components, eligibility and approved information. | Proposed | F |
| SA-016 | External examinations | Find authorized SEE schedule, registration and official sources. | Proposed | F |
| SA-017 | Assessment history | Inspect a chronological cross-course assessment record. | Proposed | F |
| SA-018 | Course resources | Retrieve current authorized course material and versions. | Proposed | F |
| SA-019 | Learning progress | Inspect concept-level evidence and its limitations. | Proposed | F |
| SA-020 | Academic announcements | Read published notices in the eligible audience. | Tested | R |
| SA-021 | Attendance correction workflow | Challenge a record and receive a traceable authorized decision. | Proposed | F |
| SA-022 | Academic reports and exports | Download an authorized, scheme-aware record with source references. | Proposed | F |
| SA-023 | Academic integrity appeals | Student opens a confidential case tied to a published policy and record. An authorized human reviews and records a reason. Measure review time and verify that outsiders cannot read the case. | Proposed | Master plan §10 |

## Student Life · personal learning

Students control private study activity. Choose a goal or concept → work with authorized materials → review and revise. Data: preferences, goals, approved course resources, opt-in learning history. Depends on course context, resource permissions and grounded AURA for generated content. W2/P1 personal tools, W5/P2 AI, W6/P2 research. Founder §3 and prior prototype disclosure.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| PL-001 | AURA learning assistant | Ask a learning question against permissioned course material. | Proposed | F |
| PL-002 | Course-aware explanations | Receive a concept explanation with approved sources. | Proposed | F |
| PL-003 | Socratic tutoring | Respond to guiding questions and inspect reasoning gaps. | Proposed | F |
| PL-004 | Study planning | Create a learner-controlled study schedule. | Proposed | F |
| PL-005 | Focus Planner and Focus Mode timer | Start, pause and review a timed study session; evaluate prototype portability. | Proposed | P |
| PL-006 | Personalized revision plans | Schedule revision against goals and evidence. | Proposed | F |
| PL-007 | Flashcards | Create, review and revise a personal deck. | Proposed | F |
| PL-008 | Quizzes | Attempt practice questions and review explanations. | Proposed | F |
| PL-009 | Concept maps | Link concepts to source materials and learning goals. | Proposed | F |
| PL-010 | Knowledge hub | Organize learner-accessible references; evaluate prior prototype. | Proposed | P |
| PL-011 | Saved learning materials | Bookmark and retrieve sources subject to current permissions. | Proposed | F |
| PL-012 | Learning recommendations | Inspect reasons for suggested resources and correct inputs. | Proposed | F |
| PL-013 | Learning recovery | Select a concept gap, practice and reassess with new evidence; see INV-003. | Proposed | F |
| PL-014 | Progress reflection | Keep private reflections and optionally share selected entries. | Proposed | F |
| PL-015 | Academic goals | Set and review personal learning goals. | Proposed | F |
| PL-016 | AI Agent Studio | Evaluate the prior prototype for reusable, governed agent configuration; no arbitrary execution. | Proposed | P |

## Student Life · campus and growth

Students need a single route from discovery to action. From a student workspace choose an eligible service → inspect terms → apply or follow up. Data: opportunities, user preferences, community records, eligibility, notices and outcomes. Related career, sports, transport and CLUBVERSE records are defined in their blocks. Personal grants and opt-in sharing apply. W3–4/P1. Founder §3.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| SL-001 | CLUBVERSE discovery | Discover recognized communities and review joining policy. | Tested | C |
| SL-002 | Sports participation | Find eligible teams and trials; see sports specialization. | Proposed | F |
| SL-003 | Cultural events | Find productions, rehearsals and participation opportunities. | Proposed | F |
| SL-004 | Academic societies | Discover recognized subject communities and join. | Proposed | F |
| SL-005 | Volunteering | Discover service activities and track verified contributions. | Proposed | F |
| SL-006 | Campus transport | Find eligible bus, stop and service status. | Designed | T |
| SL-007 | College services | Find available offices, requirements and service channels. | Proposed | F |
| SL-008 | Administrative requests | Submit an enrollment-letter request and inspect recorded outcome. | Tested | R |
| SL-009 | Student profile | Manage authorized profile fields and visibility. | Proposed | F |
| SL-010 | Preferences | Control interests, accessibility, locale and discovery settings. | Proposed | F |
| SL-011 | Notifications | Inspect relevant delivery history and manage subscriptions. | Proposed | F |
| SL-012 | Personal AURA activity history | Review owned event-planning tasks, state and output references. | Tested | A |
| SL-013 | Student development portfolio | Curate verified achievements, skills and projects with sharing controls. | Proposed | F |
| SL-014 | Mentor and study groups | Request mentorship or join opt-in study groups. | Proposed | F |
| SL-015 | Support service discovery | Find approved accessibility and support services. | Proposed | F |
| SL-016 | Student representation | Raise and track representative issues under institution policy. | Proposed | F |
| SL-017 | Community discussions | Participate in scoped and moderated discussions. | Proposed | F |

## Faculty Intelligence OS

Faculty need to organize teaching and evaluation by assigned offering. Select assignment, learner support, teaching or research task → prepare work → inspect evidence → publish or share with permission. Data: teaching allocations, course, section, student submissions, curriculum, rubric and faculty materials. Academic authority stays with current faculty. W2/P1, W4 research and W5 assistants. Founder §4.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| FC-001 | Faculty mission control | Find assigned courses, deadlines, evaluation queue and unpublished feedback. | Tested | FQ; no faculty user validation |
| FC-002 | Assigned courses | Choose an authorized offering for assignment creation. | Tested | R |
| FC-003 | Class management | Organize classes, sections and session activity. | Proposed | F |
| FC-004 | Faculty timetable | See assigned classes and propose changes against constraints. | Proposed | F |
| FC-005 | Attendance recording | Record and correct verified attendance per session. | Proposed | F |
| FC-006 | Teaching records | Log class delivery and coverage against the curriculum. | Proposed | F |
| FC-007 | Assignment drafting and publication | Create private draft, attach instructions and publish to assigned offering. | Tested | R |
| FC-008 | Assessment creation | Prepare assessment instruments against approved concepts. | Proposed | F |
| FC-009 | Question bank | Version reusable questions with controlled visibility. | Proposed | F |
| FC-010 | Rubrics | Define criteria, score dimensions and feedback; existing free-text rubric is narrower. | Proposed | F |
| FC-011 | Evaluation queues | Find ungraded work across assigned courses and prioritize review. | Tested | FQ; ordering by age or deadline only, no priority model |
| FC-012 | Grade publication and corrections | Save draft, explicitly publish, then revise with reason and history. | Tested | R |
| FC-013 | Feedback drafting | Prepare and save human-authored feedback before publication. | Tested | R |
| FC-014 | Classroom concept analysis | Identify concepts needing support using appropriate assessment evidence. | Proposed | F |
| FC-015 | Academic intervention | Coordinate support with authorized staff and measure resolution. | Proposed | F |
| FC-016 | Student mentorship | Agree mentoring goals and record appropriate follow-ups. | Proposed | F |
| FC-017 | Project supervision | Review assigned milestones and evidence. | Proposed | F |
| FC-018 | Student team management | Form and oversee authorized project teams. | Proposed | F |
| FC-019 | Faculty workload | Inspect teaching, assessment and mentoring commitments. | Proposed | F |
| FC-020 | Teaching resources | Organize authorized learning materials and versions. | Proposed | F |
| FC-021 | Research support | Track research activity and relevant opportunities. | Proposed | F |
| FC-022 | Literature search | Find and cite accessible publications with provenance. | Proposed | F |
| FC-023 | Faculty collaboration | Share selected work with approved collaborators. | Proposed | F |
| FC-024 | Faculty communities | Collaborate in restricted groups and review draft releases. | Designed | S |
| FC-025 | Professional development | Plan and record authorized development activities. | Proposed | F |
| FC-026 | Faculty notices | Publish notices to assigned academic audiences. | Tested | R |
| FC-027 | Meetings | Coordinate participants, schedules and follow-up actions. | Proposed | F |
| FC-028 | Faculty reports | Produce scoped teaching and workload reports from records. | Proposed | F |
| FC-029 | Faculty AURA assistants | Use approved preparation, communication and reporting tools; see agent catalog. | Proposed | F |

## Department OS

HODs and explicitly delegated coordinators need department-scoped oversight. Select department → inspect source records and metric definitions → coordinate authorized action. Data: department assignments, course delivery, rosters, outcomes, workload and operational evidence. Depends on current department grant and source modules. W2/P1 academics, W3–4 operations, W5–6 intelligence. Founder §5.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| DH-001 | Department dashboard | View department-scoped academic activity and average turnaround. | Tested | R |
| DH-002 | Department faculty | Find current faculty and responsibilities. | Proposed | F |
| DH-003 | Students and sections | Inspect authorized rosters by section. | Proposed | F |
| DH-004 | Department academic schemes | Review applicable scheme and cohort mappings. | Proposed | F |
| DH-005 | Course delivery | Compare delivered sessions against approved course plan. | Proposed | F |
| DH-006 | Teaching workload | Review teaching and evaluation allocations. | Proposed | F |
| DH-007 | Faculty allocation | Propose or approve department teaching assignments. | Proposed | F |
| DH-008 | Timetable planning | Resolve scheduling constraints before publication. | Proposed | F |
| DH-009 | Attendance reporting | Aggregate verified attendance with scheme definitions. | Proposed | F |
| DH-010 | Assessment and results reporting | Count published assignments, submissions and published results from records. | Tested | R |
| DH-011 | Curriculum progress | Review course coverage with source evidence. | Proposed | F |
| DH-012 | CO/PO/PSO evidence | Map assessments to applicable approved outcome definitions. | Proposed | F |
| DH-013 | Outcome-based education workflows | Review mappings, attainment measures and corrective actions. | Proposed | F |
| DH-014 | Student support coordination | Assign and follow up appropriate academic support. | Proposed | F |
| DH-015 | Department notices | Publish and retrieve notices within department scope. | Tested | R |
| DH-016 | Faculty development | Coordinate training and evidence. | Proposed | F |
| DH-017 | Research projects | Track approved departmental projects and milestones. | Proposed | F |
| DH-018 | Laboratory resources | Review availability and request allocation. | Proposed | F |
| DH-019 | Equipment status | See authorized inventory and maintenance state. | Proposed | F |
| DH-020 | Department clubs | Coordinate recognized departmental associations. | Proposed | F |
| DH-021 | Sports and activity oversight | Review assigned activities within delegated scope. | Proposed | F |
| DH-022 | Department approvals | Review and record a department decision with reason. | Proposed | F |
| DH-023 | Department service requests | Route requests to accountable staff and track resolution. | Proposed | F |
| DH-024 | Accreditation evidence | Trace approved evidence back to records. | Proposed | F |
| DH-025 | Improvement tracking | Assign, measure and close department improvement actions. | Proposed | F |
| DH-026 | Institutional Dependency Graph | Inspect verified dependencies affecting the department; see INV-009. | Proposed | F |
| DH-027 | HOD AURA assistant | Request a source-linked department briefing. | Proposed | F |

## Institutional Leadership OS

Principal and authorized leaders need defensible institution-level decisions. Review a scoped indicator → inspect definition and underlying evidence → authorize follow-up. Data: published departmental indicators, approved operational, financial and quality records. Domain-specific access applies independently of general leadership role. W1/P0 counted reports, W3–6/P2 expansion. Founder §6.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| LE-001 | Institution dashboard | See stored counts of published assignments, submissions, published results and open requests. | Tested | R |
| LE-002 | Department information | Review department profiles and defined comparisons. | Proposed | F |
| LE-003 | Academic progress | Track approved academic indicators by cohort. | Proposed | F |
| LE-004 | Quality indicators | Inspect defined quality measures and limitations. | Proposed | F |
| LE-005 | Resource planning | Compare available resources to documented demand. | Proposed | F |
| LE-006 | Financial oversight | Inspect explicitly authorized budget and expenditure reports. | Proposed | F |
| LE-007 | Institutional notices | Read published authorized notices. | Tested | R |
| LE-008 | Examination operations | Review approved schedules and unresolved operational issues. | Proposed | F |
| LE-009 | Departmental requests | Review authorized escalations and decisions. | Proposed | F |
| LE-010 | Strategic priorities | Assign owners and milestones to institutional priorities. | Proposed | F |
| LE-011 | Institutional improvement planning | Measure progress and actions against approved plans. | Proposed | F |
| LE-012 | Research and innovation overview | Review disclosure-approved activity and outcomes. | Proposed | F |
| LE-013 | Industry partnerships | Track approved agreements and responsibilities. | Proposed | F |
| LE-014 | Placement performance | Review verified and appropriately aggregated outcomes. | Proposed | F |
| LE-015 | Campus operations | Inspect critical issues and verified resolutions. | Proposed | F |
| LE-016 | Transport oversight | Review authorized aggregate service health. | Proposed | F |
| LE-017 | Accreditation evidence | Review approved evidence and provenance for applicable criteria. | Proposed | F |
| LE-018 | Decision simulation | Compare proposed changes under explicit assumptions. | Proposed | F |
| LE-019 | Executive reports | Trace summary claims to approved records and time windows. | Proposed | F |
| LE-020 | Leadership AURA | Prepare authorized briefings and decision-support drafts. | Proposed | F |

## Guardian experience

Verified guardians and authorizing students need narrowly scoped communications. Establish relationship → grant purpose, scope and expiry → check current authorization on every read → revoke. Data: verified relationship, lawful authority, consent history. Depends on approved institutional and legal policy, separate identity and revocation. W3/P2, timing contingent on authorization. Founder §7.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| GU-001 | Guardian identity | Verify claimant identity with an approved process. | Blocked | F; relationship and access policy pending |
| GU-002 | Relationship verification | Establish evidence linking guardian and student. | Blocked | F; relationship and access policy pending |
| GU-003 | Explicit grants | Select permitted record types, purpose and duration. | Blocked | F; relationship and access policy pending |
| GU-004 | Revocable consent | Revoke a grant and immediately stop future disclosures. | Blocked | F; relationship and access policy pending |
| GU-005 | Academic progress | View only the explicitly permitted progress summary. | Blocked | F; relationship and access policy pending |
| GU-006 | Attendance updates | Receive only authorized attendance records. | Blocked | F; relationship and access policy pending |
| GU-007 | Official notices | Read guardian-audience notices. | Blocked | F; relationship and access policy pending |
| GU-008 | Parent–faculty communication | Contact authorized faculty through approved channels. | Blocked | F; relationship and access policy pending |
| GU-009 | Service requests | Initiate only delegated guardian service requests. | Blocked | F; relationship and access policy pending |
| GU-010 | Transport information | Access only explicitly authorized transport information. | Blocked | F; relationship and access policy pending |
| GU-011 | Meeting coordination | Coordinate approved meetings and attendance. | Blocked | F; relationship and access policy pending |
| GU-012 | School safeguarding model | An authorized safeguarding owner defines age-appropriate access and review rules before any school pilot. Verify revocation and restricted record access. | Blocked | Master plan §21 and legal review |

## Administration and specialist staff

Institution administrators, academic office and designated specialists manage accountable changes. Select scope → verify authority → transact and audit → return status or evidence. Data: membership, catalog, roster, workflow state, approvals and audit. Institution role never grants unrelated specialist duties. W1/P0 existing foundation, W2–3/P1 connected offices. Founder §8.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| AD-001 | Institutional setup | Set up core departments, schemes and terms for an existing institution. | Tested | R |
| AD-002 | Account onboarding | Invite, verify, provision and recover accounts through authorized office. | Proposed | F |
| AD-003 | Role grants | Grant and end permitted institutional roles to existing people. | Tested | R |
| AD-004 | Membership lifecycle | Activate and end memberships; retain history and revoke live access. | Tested | R |
| AD-005 | Student records | Govern student identity details, corrections and authorized record access. | Proposed | F |
| AD-006 | Academic catalog | Create schemes, terms, courses, sections and offerings. | Tested | R |
| AD-007 | Enrollments | Enroll or end student and faculty roster assignments. | Tested | R |
| AD-008 | Course and section management | Maintain existing offerings, corrections, retirement and history beyond creation. | Proposed | F |
| AD-009 | Examination management | Schedule examinations, invigilation and authorized publication. | Proposed | F |
| AD-010 | Document requests | Process enrollment-letter request from submission to recorded outcome. | Tested | R |
| AD-011 | Certificate preparation | Draft official documents from validated records. | Proposed | F |
| AD-012 | Credential issuance | Authorized human issues and verifies an official credential. | Proposed | F |
| AD-013 | Fee workflows | Reconcile approved fee-system transactions and student visibility. | Proposed | F |
| AD-014 | Scholarship administration | Check eligibility and route applications for authorized decisions. | Proposed | F |
| AD-015 | Procurement | Request goods, compare proposals and record human authorization. | Proposed | F |
| AD-016 | Administrative approvals | Route delegated decisions and record reasons. | Proposed | F |
| AD-017 | Complaints and grievances | Confidential intake, assignment, escalation and resolution. | Proposed | F |
| AD-018 | Staff work queues | Show actionable records only for the assigned office. | Proposed | F |
| AD-019 | Delegated responsibilities | Assign bounded responsibilities with expiry and revocation. | Proposed | F |
| AD-020 | Reusable workflow engine | Extract proven shared transitions, ownership and audit rules. | Proposed | F |
| AD-021 | Institutional knowledge base | Publish approved, versioned, permission-scoped policies. | Proposed | F |
| AD-022 | Audit viewer | Search authorized event metadata without exposing private payloads. | Proposed | F |
| AD-023 | Staff notifications | Deliver scoped work updates with retry and acknowledgement. | Proposed | F |
| AD-024 | Operational reporting | Measure queue age, service resolution, rework and reopenings. | Proposed | F |
| AD-025 | Library desk | Authorize circulation, search and external library integration. | Proposed | F |
| AD-026 | Laboratory staff | Manage inventory, access, maintenance and equipment issues. | Proposed | F |
| AD-027 | Research administration | Track grants, approved disclosures and project milestones. | Proposed | F |
| AD-028 | Placement office | Manage drives, employers, eligibility and graduate outcomes. | Proposed | F |
| AD-029 | Examination cell | Allocate rooms and authorized invigilators. | Proposed | F |
| AD-030 | Finance office | Review authorized invoices, approvals and reconciliation. | Proposed | F |
| AD-031 | Facilities office | Assign and verify estate service requests. | Proposed | F |
| AD-032 | Maintenance staff | Record repair evidence and reopen unresolved work. | Proposed | F |
| AD-033 | Sports coordination | Coordinate trials, venues, teams and travel approvals. | Proposed | F |
| AD-034 | Transport administration | Assign routes, operators and service responsibilities. | Designed | T |
| AD-035 | Controlled announcements | Draft and publish notices scoped to the allowed institutional audience. | Tested | R |

## CLUBVERSE · organizations and governance

Founders, eligible members, officers, faculty advisors and independent institutional reviewers need governed community access. Propose → recognize → join → operate → transfer or archive. Data: categories, templates, club proposal, member and term grants. Requires active institutional membership and separate club authority. W3/P1. Founder §9 plus CLUBVERSE master §5. Categories are configurable design targets, not evidence any organization exists at SIT.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| CL-001 | Student clubs | Create and recognize a campus or student-audience organization. | Tested | C |
| CL-002 | Technical societies | Classify a technical community and use a technical-society template. | Implemented | C |
| CL-003 | Faculty clubs | Limit organization eligibility to faculty. | Implemented | C |
| CL-004 | Academic communities | Classify a subject society as academic and research. | Implemented | C |
| CL-005 | Research circles | Use restricted groups with confidential manuscript review. | Designed | S |
| CL-006 | Entrepreneurship cells | Support enterprise and incubation communities. | Proposed | F |
| CL-007 | Professional chapters | Represent approved professional affiliations. | Proposed | F |
| CL-008 | Sports clubs | Represent a sports category or team template. | Implemented | C |
| CL-009 | Cultural societies | Represent cultural organizations and performance activity. | Proposed | F |
| CL-010 | Creative clubs | Support creative collaboration and productions. | Proposed | F |
| CL-011 | Volunteering organizations | Manage verified service activities and members. | Proposed | F |
| CL-012 | Leadership organizations | Support governance and student representation. | Proposed | F |
| CL-013 | Department associations | Associate recognized communities with department scope. | Proposed | F |
| CL-014 | Staff communities | Support staff eligibility independently of faculty. | Proposed | F |
| CL-015 | Alumni communities | Verify alumni affiliation and authorize access. | Proposed | F |
| CL-016 | Temporary project and event teams | Assign time-limited teams and archive responsibilities. | Proposed | F |
| CL-017 | Club discovery | Search and filter recognized eligible clubs. | Tested | C |
| CL-018 | Club proposals | Draft, submit and revise a recognition request. | Tested | C |
| CL-019 | Institutional recognition | Independent reviewer approves, rejects or requests changes. | Tested | C |
| CL-020 | Community templates | Select seeded category-compatible templates during proposal creation. | Implemented | C |
| CL-021 | Member applications | Request, invite or approve joining under club policy. | Tested | C |
| CL-022 | Membership management | Maintain current membership and restrict member-only activities. | Tested | C |
| CL-023 | Officer assignments | Grant and revoke club-scoped authority. | Tested | C |
| CL-024 | Faculty advisorship | Bind a faculty advisor to a specific club. | Implemented | C |
| CL-025 | Officer terms | Schedule access start and expiry with a succession policy. | Designed | S |
| CL-026 | Club elections | Conduct elections only under an approved governance policy. | Proposed | F |
| CL-027 | Governance records | Retain recognition decisions, effective rules and accountable officers. | Proposed | F |
| CL-028 | Club notices | Publish to defined club audiences and expire notices. | Proposed | F |
| CL-029 | Club event lifecycle | Draft, submit, approve, publish, open/close, start and complete or cancel. | Tested | C |
| CL-030 | Registrations | Enforce eligibility, duplicate prevention and final-seat capacity. | Tested | C |
| CL-031 | Attendance verification | Authorized organizer independently verifies participation and evidence. | Tested | C |
| CL-032 | Club projects | Form scoped teams and review milestones. | Designed | S |
| CL-033 | Club budgets | Prepare budgets and route financial authorization. | Proposed | F |
| CL-034 | Sponsorship proposals | Draft sponsor proposals with approval before external communication. | Proposed | F |
| CL-035 | Venue booking | An active club officer requests a room for an event. A scoped custodian decides and the organizer reads the recorded status. | Tested | B |
| CL-036 | Equipment requests | Request, assign, return and reconcile equipment. | Proposed | F |
| CL-037 | Club collaboration | Agree shared duties without sharing unrelated club records. | Designed | S |
| CL-038 | Participation evidence | Record written evidence on verified attendance. | Tested | C |
| CL-039 | Verified achievements | Verify claims against participation or project evidence. | Designed | S |
| CL-040 | Club analytics | Inspect defined event and community outcomes beyond registration counts. | Proposed | F |
| CL-041 | Leadership handover | Approve lead transfer atomically and retain handover notes. | Tested | C |
| CL-042 | Community archives | Retain approved decisions, documents, custody and institutional memory. | Proposed | F |
| CL-043 | AURA club agents | Prepare and confirm one private event draft deterministically. | Tested | A |
| CL-044 | Event waitlist | Promote eligible participants in order as capacity opens. | Proposed | F |
| CL-045 | Event volunteers | Assign shifts and duties without publishing unnecessary personal data. | Proposed | F |
| CL-046 | Event feedback and outcomes | Collect feedback and publish an evidence-backed outcome report. | Proposed | F |
| CL-047 | Club meetings and tasks | Coordinate meeting decisions, owners and due dates. | Proposed | F |
| CL-048 | Configurable recognition rules | Authorized staff version local recognition requirements. | Proposed | F |
| CL-049 | Founding members | Record multiple founders and policy-compliant initial officer grants. | Proposed | F |
| CL-050 | Approved expenditures | Link authorized spending evidence to budget decisions. | Proposed | F |
| CL-051 | Event schedules and marketing | Maintain a published running order and approved promotional materials. | Designed | S |

## Sports specialization

Players, coaches, officials, sports coordinators and venue custodians need reliable competition records. Build team → schedule fixture → verify outcome → publish standings. Data: season roster, venue bookings, fixtures, results and revisions. Scope by institution, team and official assignment; private medical records excluded. Depends on club grants and venue authority. W3/P1, agent W5. Founder §10 and sports pack.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| SP-001 | Sports discovery | Find sports and currently eligible teams. | Proposed | F |
| SP-002 | Player profiles | Share approved sporting information under player controls. | Proposed | F |
| SP-003 | Teams | Form season rosters from verified members. | Proposed | F |
| SP-004 | Selection and trials | Request a tryout, record an authorized selection and notify the player. | Proposed | F |
| SP-005 | Coaches | Assign a coach for a team and term. | Proposed | F |
| SP-006 | Training schedules | Publish confirmed training sessions to eligible members. | Proposed | F |
| SP-007 | Fixtures | Assign opponents, time and venue per match. | Proposed | F |
| SP-008 | Tournaments | Define competition format, entrants and progression. | Proposed | F |
| SP-009 | Match scheduling | Check academic, venue and team conflicts. | Proposed | F |
| SP-010 | Match results | Assigned official records and revises verified scores. | Proposed | F |
| SP-011 | Standings | Derive standings from verified results and applicable rules. | Proposed | F |
| SP-012 | Venue availability | Query bookable slots without disclosing private reservations. | Proposed | F |
| SP-013 | Equipment | Reserve and return team equipment. | Proposed | F |
| SP-014 | Travel coordination | Request authorized transport for competitions. | Proposed | F |
| SP-015 | Competition eligibility | Evaluate approved rules and show correctable evidence. | Proposed | F |
| SP-016 | Participation verification | Verify who competed separately from roster membership. | Proposed | F |
| SP-017 | Sporting achievements | Attach verified results to consented portfolios. | Proposed | F |
| SP-018 | Sports calendars | Publish authorized season dates. | Proposed | F |
| SP-019 | Team announcements | Deliver relevant updates to team members. | Proposed | F |
| SP-020 | Interdepartmental competitions | Schedule department teams under approved rules. | Proposed | F |
| SP-021 | Intercollege competitions | Validate external opponents and cross-institution sharing. | Proposed | F |
| SP-022 | Sports planning agents | Draft fixtures and plans for human review. | Proposed | F |
| SP-023 | Match officials | Assign officials and restrict result changes to authorized roles. | Proposed | F |
| SP-024 | Tournament brackets | Advance teams according to event-specific verified outcomes. | Proposed | F |

## Smart Campus · student mobility

Eligible riders need trustworthy journey information. Open assigned trip → select boarding stop → inspect schedule or recent observations → act on verified alert. Data: eligibility, route, stops, direction, schedule, trip, vehicle, aggregate observations. Requires transport office and scoped feeds. W3/P1 scheduled service, live systems after authorization. Founder §11 and transport E1–16. AURA status reads only scoped data.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| TR-001 | Assigned route | Resolve eligible route and direction. | Designed | T |
| TR-002 | Bus identifier | Identify the vehicle assigned to the current trip. | Designed | T |
| TR-003 | Boarding stop | Select a stop on the eligible route. | Designed | T |
| TR-004 | Bus pass | Issue and present a scoped boarding entitlement. | Proposed | F |
| TR-005 | Pass validity | Check current dates, status and revocation. | Proposed | F |
| TR-006 | QR boarding | Verify a short-lived boarding credential with replay protection. | Proposed | F |
| TR-007 | Trip schedule | Show scheduled stop and campus arrival with service date. | Designed | T |
| TR-008 | Live GPS | Show only authorized active-trip telemetry with freshness. | Designed | T |
| TR-009 | Route map | Display geometry, ordered stops and an accessible text equivalent. | Designed | T |
| TR-010 | Current bus position | Distinguish recent, stale and unavailable position. | Designed | T |
| TR-011 | Pickup ETA | Estimate time to the selected upcoming stop. | Designed | T |
| TR-012 | College ETA | Estimate arrival at campus with uncertainty. | Designed | T |
| TR-013 | Stop arrival predictions | Compute central estimates over ordered upcoming stops. | Designed | T |
| TR-014 | Actual stop events | Record authorized arrivals and departures. | Designed | T |
| TR-015 | Passed-stop status | Mark passed stops and suppress future ETA for them. | Designed | T |
| TR-016 | Bus occupancy | Show aggregate manual or approved sensor observation and source. | Designed | T |
| TR-017 | Available capacity | Distinguish permitted capacity, seat availability and unknown counts. | Designed | T |
| TR-018 | Delay alerts | Issue effective and expiring route-specific delay updates. | Designed | T |
| TR-019 | Cancellation alerts | Communicate cancellation and remove active estimates. | Designed | T |
| TR-020 | Diversion notices | Communicate confirmed route diversions. | Designed | T |
| TR-021 | Replacement vehicle notices | Identify a verified replacement and its capacity. | Designed | T |
| TR-022 | Arrival reminders | Opt in to timely, scoped notifications. | Designed | T |
| TR-023 | Alternative services | Show alternatives only when eligibility and availability are confirmed. | Proposed | F |
| TR-024 | Lost and found | Submit, privately match and resolve an item report. | Proposed | F |
| TR-025 | Transport incidents | Report an issue to an authorized responder. | Proposed | F |
| TR-026 | Emergency information | Show institution-approved emergency procedures and channels. | Proposed | F |

## Smart Campus · transport operations

Dispatchers, transport managers, assigned conductors and stationary operators coordinate service. Configure → assign → operate → record evidence → review service. Data: routes, vehicles, devices, trips, alerts and aggregate counts. Access ends when assignment or trip ends; retain location only under approved policy. Depends on the operator and source authorization. W3/P1 schedule, W5–6 predictions and optimization. Founder §11 and transport mission.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| TO-001 | Route management | Version routes, directions and geometry. | Designed | T |
| TO-002 | Stop management | Maintain ordered stops and coordinates. | Designed | T |
| TO-003 | Vehicle management | Record vehicle identity and permitted capacity. | Designed | T |
| TO-004 | Operator assignments | Assign drivers and conductors to specific trips. | Designed | T |
| TO-005 | Device integration | Authenticate trip-bound devices, reject replay, invalid coordinates and stale updates. | Designed | T |
| TO-006 | Service schedules | Create trip instances and enforce lifecycle transitions. | Designed | T |
| TO-007 | Capacity management | Differentiate seated and total permitted capacity. | Designed | T |
| TO-008 | Pass administration | Issue, revoke and audit student transport passes. | Proposed | F |
| TO-009 | QR boarding verification | Reject duplicate, expired and revoked boarding proofs. | Proposed | F |
| TO-010 | Authorized counts | Record count, source, correction and observation time. | Designed | T |
| TO-011 | Disruption management | Publish scoped alerts with effective and expiry times. | Designed | T |
| TO-012 | Incident response | Assign responders, record action and verify resolution. | Proposed | F |
| TO-013 | Vehicle maintenance | Track faults, service dates and clearance before operation. | Proposed | F |
| TO-014 | Operational analytics | Review freshness, service performance and ETA errors. | Designed | T |
| TO-015 | Route optimization | Evaluate alternatives under cost, demand and privacy constraints. | Proposed | F |
| TO-016 | Transport command center | Monitor authorized active trips, disruptions and stale trackers. | Designed | T |
| TO-017 | Fictional simulation | Isolate labeled demo routes and telemetry from live operation. | Designed | T |
| TO-018 | Realtime delivery | Poll or subscribe securely with reconnect and stale-state handling. | Designed | T |
| TO-019 | Trip progression | Track scheduled, preparing, active, delayed, paused, completed and cancelled. | Designed | T |
| TO-020 | Operator safety | Provide safe stationary or conductor reporting and explicit tracking state. | Designed | T |

## Careers, research and opportunities

Students, placement and research offices, opted-in mentors, approved alumni and industry partners need verified pathways. Discover → explain eligibility → prepare → apply or join → track verified outcome. Data: source/expiry, skill evidence, requirements, consent and outcome. Depends on legitimate providers and accountable reviewers; no undisclosed profiling. W4/P1, recommendations W5. Founder §§3 and 12.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| CR-001 | Internship search | Discover active verified internships. | Proposed | F |
| CR-002 | Jobs and placement opportunities | Search roles and approved placement drives. | Proposed | F |
| CR-003 | Course discovery | Compare relevant courses with prerequisites and source links. | Proposed | F |
| CR-004 | NPTEL and SWAYAM discovery | Discover verified listings through permitted interfaces. | Proposed | F |
| CR-005 | Scholarships | Find applicable funding and application deadlines. | Proposed | F |
| CR-006 | Competitions | Compare verified competition requirements. | Proposed | F |
| CR-007 | Hackathons | Find challenges, deadlines and team eligibility. | Proposed | F |
| CR-008 | Research opportunities | Find approved programs and openings. | Proposed | F |
| CR-009 | Fellowships | Compare eligibility and funding terms. | Proposed | F |
| CR-010 | Eligibility matching | Explain requirements met, missing evidence and correction paths. | Proposed | F |
| CR-011 | Skills and skill gaps | Compare evidenced skills with a selected goal. | Proposed | F |
| CR-012 | Career pathways | Map user-selected goals to courses, projects and opportunities. | Proposed | F |
| CR-013 | Résumé preparation | Draft and review a résumé using authorized portfolio data. | Proposed | F |
| CR-014 | Portfolios | Select and share evidence with revocable visibility. | Proposed | F |
| CR-015 | Application drafts | Prepare required materials for applicant review. | Proposed | F |
| CR-016 | Application tracking | Track submission, status, deadlines and verified outcome. | Proposed | F |
| CR-017 | Mentor discovery | Find available mentors by approved expertise and request contact. | Proposed | F |
| CR-018 | Faculty research projects | Publish approved projects and scoped openings. | Proposed | F |
| CR-019 | Student research teams | Form opt-in teams and manage role-specific access. | Proposed | F |
| CR-020 | Laboratory access requests | Request facility access under safety and supervision rules. | Proposed | F |
| CR-021 | Industry challenges | Receive approved problem briefs and propose solutions. | Proposed | F |
| CR-022 | Startup ideas | Capture ideas and validate ownership and disclosure choices. | Proposed | F |
| CR-023 | Incubation | Track applications, reviews and milestones. | Proposed | F |
| CR-024 | Research milestones | Review authorized project and experiment outputs. | Proposed | F |
| CR-025 | Credential verification | Check authorized evidence and issuer provenance. | Proposed | F |
| CR-026 | Alumni collaboration | Coordinate approved alumni mentoring and projects. | Proposed | F |
| CR-027 | Industry collaboration | Manage approved participation without disclosing protected records. | Proposed | F |
| CR-028 | Certifications | Track learning credentials and verification status. | Proposed | F |
| CR-029 | Project discovery | Find eligible projects, mentors and resources. | Proposed | F |
| CR-030 | Team formation | Invite opted-in collaborators and track membership. | Proposed | F |
| CR-031 | Opportunity tracking | Save relevant opportunities and track decisions. | Proposed | F |
| CR-032 | Placement drives | Register eligible students and track authorized outcomes. | Proposed | F |
| CR-033 | Graduate outcomes | Aggregate verified outcomes with appropriate definitions. | Proposed | F |
| CR-034 | Grant applications | Track calls, budgets, approvals and decisions. | Proposed | F |
| CR-035 | Intellectual property disclosure | Route private disclosure to authorized reviewers. | Proposed | F |
| CR-036 | Experiment documentation | Record scoped experimental methods, evidence and revisions. | Proposed | F |
| CR-037 | Verified individual project contributions | A project participant submits an artifact with consent to share. A named reviewer verifies the contribution before it appears in a portfolio. Track reviewed artifacts and test withdrawal. | Proposed | Master plan §20 |

## Campus operations

Resource custodians, library/lab staff, facilities teams, requesters and approvers need verified availability and resolution. Request → validate → assign → record outcome → confirm or reopen. Data: resource, interval, custodian grant, service history and evidence. Depends on shared tenant identity, approval/audit and scheduling constraints. W3/P1. Founder §13.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| OP-001 | Classroom scheduling | Assign sections to rooms without overlapping confirmed use. | Proposed | F |
| OP-002 | Laboratory booking | Select authorized lab slots and obtain clearance. | Proposed | F |
| OP-003 | Equipment reservations | Request equipment, confirm custody, return and inspect condition. | Proposed | F |
| OP-004 | Library services | Search approved holdings and request institution-permitted services. | Proposed | F |
| OP-005 | Asset tracking | Record current location, custodian and equipment lifecycle. | Proposed | F |
| OP-006 | Maintenance | Assign repairs and verify completion. | Proposed | F |
| OP-007 | Facility issue reporting | Report a fault, attach evidence and track status. | Proposed | F |
| OP-008 | Event venues | Confirm a conflict-free event reservation with a traceable responsible party and decision. | Tested | B |
| OP-009 | Resource allocation | Compare demand and assign available resources under policy. | Proposed | F |
| OP-010 | Operational notices | Publish scoped maintenance and closure notices. | Proposed | F |
| OP-011 | Incident management | Escalate incidents through approved response policies. | Proposed | F |
| OP-012 | Administrative workflows | Route campus requests to the responsible office. | Proposed | F |
| OP-013 | Staff assignment | Assign tasks to currently authorized staff. | Proposed | F |
| OP-014 | Approval management | Collect required approvals with reason and version. | Proposed | F |
| OP-015 | Verified service completion | Record resolution evidence and allow confirmation or reopening. | Proposed | F |
| OP-016 | Operational history | Inspect authorized events and decisions. | Proposed | F |
| OP-017 | Sustainability reporting | Measure resource use with documented provenance. | Proposed | F |

## AURA · shared agent platform

Authenticated user and accountable tool owners. Route task from session → scoped retrieval → bounded provider → exact proposal → human approval when needed → deterministic action → verified result. Data: agent/tool version, task, source references, approvals, usage, evidence. Depends on reliable authorized domain services. No implicit cross-role grants. W5/P1, advanced coordination W6. Founder §§14–15 and agent master §§6–10.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| AI-001 | Agent gateway | Resolve user, tenant, active role and current club grant per tool. | Tested | A |
| AI-002 | Agent registry | Declare deterministic planner version, tools, roles, timeout and authority. | Implemented | A |
| AI-003 | Typed tool contracts | Validate event planning and event draft inputs and outputs. | Tested | A |
| AI-004 | Provider interface | Invoke a deterministic provider behind a bounded interface. | Tested | A |
| AI-005 | Model-powered event suggestions | Generate grounded, editable suggestions with approved model, evaluation and spend caps. | Designed | AURA_ARCHITECTURE.md |
| AI-006 | Agent activity center | Inspect own event plan states, tools and saved draft references. | Tested | A |
| AI-007 | Explicit approvals | Confirm or cancel an expiring owned proposal and recheck grants. | Tested | A |
| AI-008 | Execution evidence | Return one private persisted draft on replay-safe confirmation. | Tested | A |
| AI-009 | Rate limits | Bound preview admission by account and institution. | Implemented | A |
| AI-010 | Cost management | Reserve and reconcile provider usage and spend per institution and feature. | Designed | AURA_ARCHITECTURE.md |
| AI-011 | Context and knowledge | Retrieve only approved versions with document-level access and citations. | Proposed | F |
| AI-012 | Agent orchestration | Bound planning and dependent tools with failure handling. | Proposed | F |
| AI-013 | Durable tasks and workers | Resume eligible long-running work with actual scheduler, cancellation and idempotent retries. | Proposed | F |
| AI-014 | Agent execution logs | Persist task/tool metadata and outcomes for the deterministic planner. | Tested | A |
| AI-015 | Agent evaluation | Evaluate groundedness, prompt injection, model cost, tool selection and failure recovery. | Proposed | F |
| AI-016 | Authority levels L0–L4 | Enforce read, draft, confirmation, pre-authorized low-risk action and human-only sensitive decisions. | Proposed | F |
| AI-017 | Institutional Knowledge Assistant | Explain enrollment-letter process from approved source and offer scoped next action. | Proposed | F |
| AI-018 | Faculty Workflow Assistant | Prepare editable course assignment draft under current faculty authority. | Proposed | F |
| AI-019 | Policy and prompt versioning | Pin tool, prompt, model and source policy versions per run. | Proposed | F |
| AI-020 | Approval activity and retry | Inspect failed and pending work, with safe cancellation and retry where supported. | Proposed | F |

## AURA catalog · student and personal

Domain: AURA / student and personal. Intended users: authorized student and personal participants in the matching domain record above. Problem: repetitive retrieval, preparation and coordination. Select task → retrieve minimum authorized domain records → preview cited answer or draft → confirm allowed writes → return recorded evidence. Data, tools and grants follow that domain; no direct database or independent high-impact decisions. Requires tested domain tools, approved data sources, cost limit and evaluation. W5/P2. Origin: founder §14 and agent catalog §§7.1–7.7. Agents are proposed configurations, except the separate deterministic AI-008 path.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| AGST-001 | Daily planner | organize current tasks and deadlines | Proposed | F |
| AGST-002 | Learning assistant | explain concepts from approved materials | Proposed | F |
| AGST-003 | Assignment preparation | clarify instructions and review drafts | Proposed | F |
| AGST-004 | Exam preparation | prepare revision plans and practice | Proposed | F |
| AGST-005 | Course discovery | compare courses against goals | Proposed | F |
| AGST-006 | Internship discovery | compare verified openings | Proposed | F |
| AGST-007 | Career pathway | map goals to evidence | Proposed | F |
| AGST-008 | Application preparation | prepare an applicant-reviewed packet | Proposed | F |
| AGST-009 | Opportunity radar | find competitions and hackathons | Proposed | F |
| AGST-010 | Scholarship assistant | check scholarship requirements | Proposed | F |
| AGST-011 | Project discovery | find opt-in teams and mentors | Proposed | F |
| AGST-012 | Student services | prepare and track service requests | Proposed | F |
| AGST-013 | Campus transport | read assigned service status | Proposed | F |
| AGST-014 | Club discovery | find recognized communities | Proposed | F |
| AGST-015 | Personal portfolio | organize verified achievements | Proposed | F |

## AURA catalog · faculty

Domain: AURA / faculty. Intended users: authorized faculty participants in the matching domain record above. Problem: repetitive retrieval, preparation and coordination. Select task → retrieve minimum authorized domain records → preview cited answer or draft → confirm allowed writes → return recorded evidence. Data, tools and grants follow that domain; no direct database or independent high-impact decisions. Requires tested domain tools, approved data sources, cost limit and evaluation. W5/P2. Origin: founder §14 and agent catalog §§7.1–7.7. Agents are proposed configurations, except the separate deterministic AI-008 path.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| AGFT-001 | Teaching preparation | draft lesson plans | Proposed | F |
| AGFT-002 | Assessment creation | prepare aligned questions | Proposed | F |
| AGFT-003 | Rubric assistant | propose rubric-based evaluation | Proposed | F |
| AGFT-004 | Feedback drafting | draft editable feedback | Proposed | F |
| AGFT-005 | Classroom understanding | analyze concept-level evidence | Proposed | F |
| AGFT-006 | Academic intervention | propose support activities | Proposed | F |
| AGFT-007 | Faculty scheduling | propose changes to commitments | Proposed | F |
| AGFT-008 | Student mentorship | coordinate follow-ups | Proposed | F |
| AGFT-009 | Project supervision | review milestones | Proposed | F |
| AGFT-010 | Faculty research | synthesize accessible literature | Proposed | F |
| AGFT-011 | Faculty reporting | prepare course reports | Proposed | F |
| AGFT-012 | Faculty communication | draft scoped notices | Proposed | F |

## AURA catalog · department

Domain: AURA / department. Intended users: authorized department participants in the matching domain record above. Problem: repetitive retrieval, preparation and coordination. Select task → retrieve minimum authorized domain records → preview cited answer or draft → confirm allowed writes → return recorded evidence. Data, tools and grants follow that domain; no direct database or independent high-impact decisions. Requires tested domain tools, approved data sources, cost limit and evaluation. W5/P2. Origin: founder §14 and agent catalog §§7.1–7.7. Agents are proposed configurations, except the separate deterministic AI-008 path.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| AGHD-001 | Department briefing | summarize department records | Proposed | F |
| AGHD-002 | Workload planning | propose teaching allocations | Proposed | F |
| AGHD-003 | Timetable optimization | compare feasible timetables | Proposed | F |
| AGHD-004 | Academic quality | organize verified evidence | Proposed | F |
| AGHD-005 | Department workflow | identify approvals and bottlenecks | Proposed | F |
| AGHD-006 | Research coordination | summarize approved projects | Proposed | F |
| AGHD-007 | Resource planning | compare lab and room demand | Proposed | F |
| AGHD-008 | Department communication | draft department updates | Proposed | F |
| AGHD-009 | Department improvement | track improvement actions | Proposed | F |

## AURA catalog · leadership

Domain: AURA / leadership. Intended users: authorized leadership participants in the matching domain record above. Problem: repetitive retrieval, preparation and coordination. Select task → retrieve minimum authorized domain records → preview cited answer or draft → confirm allowed writes → return recorded evidence. Data, tools and grants follow that domain; no direct database or independent high-impact decisions. Requires tested domain tools, approved data sources, cost limit and evaluation. W5/P2. Origin: founder §14 and agent catalog §§7.1–7.7. Agents are proposed configurations, except the separate deterministic AI-008 path.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| AGEX-001 | Executive briefing | prepare factual executive reports | Proposed | F |
| AGEX-002 | Strategic planning | compare institutional options | Proposed | F |
| AGEX-003 | Resource simulation | evaluate scenarios and assumptions | Proposed | F |
| AGEX-004 | Accreditation evidence | organize approved documents | Proposed | F |
| AGEX-005 | Institutional operations | identify unresolved issues | Proposed | F |
| AGEX-006 | Institutional opportunity | identify partnership or grant options | Proposed | F |
| AGEX-007 | Leadership follow-up | prepare reminders for approved work | Proposed | F |

## AURA catalog · administration

Domain: AURA / administration. Intended users: authorized administration participants in the matching domain record above. Problem: repetitive retrieval, preparation and coordination. Select task → retrieve minimum authorized domain records → preview cited answer or draft → confirm allowed writes → return recorded evidence. Data, tools and grants follow that domain; no direct database or independent high-impact decisions. Requires tested domain tools, approved data sources, cost limit and evaluation. W5/P2. Origin: founder §14 and agent catalog §§7.1–7.7. Agents are proposed configurations, except the separate deterministic AI-008 path.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| AGOF-001 | Document preparation | prepare editable documents | Proposed | F |
| AGOF-002 | Application verification | flag missing evidence | Proposed | F |
| AGOF-003 | Request routing | recommend responsible office | Proposed | F |
| AGOF-004 | Records assistant | locate permitted records | Proposed | F |
| AGOF-005 | Account lifecycle | prepare access-change requests | Proposed | F |
| AGOF-006 | Procurement | prepare purchase comparisons | Proposed | F |
| AGOF-007 | Examination planning | draft invigilation and room plans | Proposed | F |
| AGOF-008 | Knowledge assistant | answer from approved policies | Proposed | F |
| AGOF-009 | Workflow design | draft forms and transition policies | Proposed | F |
| AGOF-010 | Library assistant | locate permitted holdings and circulation workflows | Proposed | F |

## AURA catalog · community

Domain: AURA / community. Intended users: authorized community participants in the matching domain record above. Problem: repetitive retrieval, preparation and coordination. Select task → retrieve minimum authorized domain records → preview cited answer or draft → confirm allowed writes → return recorded evidence. Data, tools and grants follow that domain; no direct database or independent high-impact decisions. Requires tested domain tools, approved data sources, cost limit and evaluation. W5/P2. Origin: founder §14 and agent catalog §§7.1–7.7. Agents are proposed configurations, except the separate deterministic AI-008 path.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| AGCM-001 | Club creation | prepare recognition proposals | Proposed | F |
| AGCM-002 | Club administration | organize members and tasks | Proposed | F |
| AGCM-003 | Event planning | prepare model-assisted event proposals after organizer review | Proposed | F |
| AGCM-004 | Event promotion | draft event communications | Proposed | F |
| AGCM-005 | Volunteer coordination | prepare shifts | Proposed | F |
| AGCM-006 | Budget proposal | prepare budget estimates | Proposed | F |
| AGCM-007 | Sponsorship preparation | draft outreach for separate external approval | Proposed | F |
| AGCM-008 | Team formation | suggest opted-in collaborators | Proposed | F |
| AGCM-009 | Competition assistant | organize entry checklists | Proposed | F |
| AGCM-010 | Sports tournament | prepare fixtures and standings | Proposed | F |
| AGCM-011 | Sports training planner | prepare coach-reviewed sessions | Proposed | F |
| AGCM-012 | Club project | track technical milestones | Proposed | F |
| AGCM-013 | Club achievement | prepare evidence for verification | Proposed | F |
| AGCM-014 | Leadership handover | prepare transition documentation | Proposed | F |
| AGCM-015 | Cross-club collaboration | propose explicitly shared work | Proposed | F |

## AURA catalog · campus operations

Domain: AURA / campus operations. Intended users: authorized campus operations participants in the matching domain record above. Problem: repetitive retrieval, preparation and coordination. Select task → retrieve minimum authorized domain records → preview cited answer or draft → confirm allowed writes → return recorded evidence. Data, tools and grants follow that domain; no direct database or independent high-impact decisions. Requires tested domain tools, approved data sources, cost limit and evaluation. W5/P2. Origin: founder §14 and agent catalog §§7.1–7.7. Agents are proposed configurations, except the separate deterministic AI-008 path.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| AGCP-001 | Route planning | propose route and stop changes | Proposed | F |
| AGCP-002 | Transport status | summarize verified trip state | Proposed | F |
| AGCP-003 | Delay communication | draft alerts from confirmed events | Proposed | F |
| AGCP-004 | ETA analysis | measure prediction error | Proposed | F |
| AGCP-005 | Capacity monitoring | summarize aggregate occupancy | Proposed | F |
| AGCP-006 | Maintenance coordination | coordinate faults and repair evidence | Proposed | F |
| AGCP-007 | Laboratory resource | find authorized equipment and booking options | Proposed | F |
| AGCP-008 | Campus resource | identify allocation conflicts | Proposed | F |
| AGCP-009 | Facilities reporting | summarize service backlogs | Proposed | F |
| AGCP-010 | Industry collaboration | prepare scoped research and partnership coordination | Proposed | F |

## Research and invention portfolio

Researchers and authorized design partners investigate mechanisms against existing alternatives. Define problem and baseline → test opt-in prototype → measure outcomes and guardrails → retain or revise hypothesis. Requires curated, authorized evidence and appropriate pilot policy; private data access is purpose-specific. W6/P2. Founder §15 and innovation directives. No novelty or performance claims.

| ID | Capability | Functional workflow or acceptance outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| INV-001 | Institutional Outcome Graph | Test explicit relationships from learning and opportunities to verified outcomes. | Proposed | F |
| INV-002 | Institutional Knowledge Graph | Compare linked authorized institutional sources with scoped text search. | Proposed | F |
| INV-003 | Learning Recovery Engine | Compare approved targeted practice and reassessment with usual learning support. | Proposed | F |
| INV-004 | Socratic Blind-Spot Navigator | Test whether guided questioning reveals correctable concept gaps. | Proposed | F |
| INV-005 | Knowledge Compression and Learning Studio | Evaluate concise representations for comprehension and fidelity. | Proposed | F |
| INV-006 | Opportunity Equity Engine | Compare eligible reach and outcomes with existing channels. | Proposed | F |
| INV-007 | Campus Execution Engine | Prove reusable workflows across multiple verified services. | Proposed | F |
| INV-008 | Institutional Friction Map | Compare wait, rework and resolution before and after simplification. | Proposed | F |
| INV-009 | Institutional Dependency Graph | Map validated cross-unit dependencies and investigate delays. | Proposed | F |
| INV-010 | Campus Decision Simulator | Compare feasible resource or timetable alternatives with explicit assumptions. | Proposed | F |
| INV-011 | Club Collaboration Graph | Test whether opt-in links produce useful shared projects. | Proposed | F |
| INV-012 | Verified Skill and Achievement Passport | Test portable, revocable evidence under issuer and learner control. | Proposed | F |
| INV-013 | Faculty Teaching Improvement Loop | Evaluate source-linked instructional changes and learning outcomes. | Proposed | F |
| INV-014 | Student-to-Research-to-Industry Network | Test whether authorized mentoring and project links yield verified collaborations. | Proposed | F |
| INV-015 | Governed Agent Execution Network | Evaluate bounded multi-step execution with approval and verifiable outcomes. | Proposed | F |
