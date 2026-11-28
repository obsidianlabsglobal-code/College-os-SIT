# NEXUS College OS — demo script for 2 December 2026

One fictional college day across five roles, about 20 minutes. Everything runs locally on fictional data: Northfield Institute · Fictional demo. Nothing here is hosted, connected to SIT records, or validated with real users.

## Demo set (17 capabilities; transport leads)

| # | Capability | Registry | Status | Shown in step |
| --- | --- | --- | --- | --- |
| 0 | **The bus:** transport office starts a simulated trip; the student sees their bus, distance to their stop and the estimate, clearly labelled simulated | TR-001, TR-003, TR-010 (dot/transport) | Tested locally (simulated only; no live phone tracking) | 0 |
| 1 | Student Today: next class, open work, attendance | SA-001 | Tested | 1 |
| 2 | Submit an assignment | SA-012 | Tested | 2 |
| 3 | Attendance correction request and teacher decision | SA-021 | Tested | 3, 6 |
| 4 | Attendance what-if planning | SA-008 | Tested | 3 |
| 5 | Teacher mission control and evaluation queue, publish a result | FC-001, FC-011, FC-012 | Tested | 5 |
| 6 | Course outcomes: HOD approval and attainment | DH-012 | Tested | 7 |
| 7 | Enrollment letter request handled by the office | AD-010 | Tested | 4, 9 |
| 8 | Certificate issue and public verification | AD-011, AD-012 | Tested | 10 |
| 9 | Placement drive: apply, shortlist, offer | CR-002, CR-032 | Tested | 4, 11 |
| 10 | Sports: trial, selection with inbox notice, league table | SP-004, SP-007, SP-010, SP-011 | Tested | 4, 8 |
| 11 | Lab booking with supervising teacher and office approval | OP-002 | Tested | 4, 12 |
| 12 | Principal institution dashboard and quality indicators | LE-001, LE-004 | Tested | 13 |
| 13 | Decision simulation (attendance minimum) | LE-018 | **Partial**: only the attendance-minimum scenario is modelled; that is the part shown | 13 |
| 14 | Institutional isolation: another college sees nothing | ID-004 | Tested | 14 |
| 15 | Ask AURA: plain questions answered only from what that person may see, with sources (local, no AI model) | AI-011, AI-017 | Tested | 1b |
| 16 | One search bar on every page: typos, related words, shortcuts, grouped results | ID-014, ID-004 | Tested | 1c |

### Changes made today for the demo set
- **SP-004:** completed. A coach's trial decision now reaches the student's inbox through the automation outbox (`db/035`, `lib/automation.ts`). Students can mute it in Settings. Tested in `tests/sports.test.ts`.
- **DH-012, CR-002, OP-002:** bracketed notes removed after review. Each note described what was built, not a missing part of the requirement, and each requirement is met by its linked tests.
- **LE-018:** stays partial. Only attendance-minimum scenarios are modelled.
- **Other partial or missing rows:** left for later.

## Before the demo (about 5 minutes, same morning)

Times in the demo data are relative to when it is loaded. Load it no more than a few hours before presenting. Use a database that is only for the demo: the integration tests expect the plain seed.

```bash
npm ci
```

```bash
NEXUS_LOCAL_DB_DIR=$HOME/nexus-demo-db NEXUS_LOCAL_DB_PORT=55433 npm run db:local
```

In a second terminal, with `.env` pointing at port 55433 and `NEXUS_DEMO_SEED=1`:

```bash
npm run db:migrate && npm run db:seed && npm run db:seed-demo
```

Then load the fictional EEE buses, routes and stops (simulated only):

```bash
NEXUS_TRANSPORT_DEMO_SEED=1 npx tsx lib/transport/seed-demo.ts
```

Start the app with simulation on (never set this for the real pilot):

```bash
npm run build && NEXUS_TRANSPORT_SIMULATION_ENABLED=true npm run start
```

In a third terminal, start the automation worker so inbox notices arrive (result published, correction decided, team selection):

```bash
npm run worker
```

To rehearse the whole script automatically on a freshly loaded demo database (it changes the demo data, so reload afterwards):

```bash
npx playwright test -c playwright.demo.config.ts
```

Sign in at http://localhost:3000/login. Accounts use `<alias>@nexus.example.invalid` with the local-only password in `scripts/fixtures.ts`.

| Alias | Person | Role |
| --- | --- | --- |
| `student` | Asha Sen | Student, ECE, Section A; rides the Cedar line from Fern Square |
| `replacement` | Rohan Roy | Transport office (also a teacher) |
| `faculty` | Riya Rao | Teacher of Introduction to Programming, ECE XI football coach |
| `hod` | Dev Iyer | ECE department head |
| `admin` | Mira Bose | Institution office |
| `principal` | Leela Varma | Principal |
| `tenant` | Ira Mehta | Student at another fictional college |

Open a second browser profile or private window for the public verification page in step 10.

## Click-by-click

**0. The bus (transport office, then student) — open with this**
- Sign in as `replacement` and choose the **Transport office** workspace (Transport). Under dated trips, find **Fictional Cedar line · 2026-12-02 07:20 · Simulated** and press **Start trip**.
- Open **Publish fictional position** on that trip: latitude `12.25`, longitude `76.62`, speed `28`, then **Publish simulated location**. It answers "Simulation report: accepted."
- Sign in as `student` and open **Transport** (second in the bottom bar). **My bus** shows Fictional Bus 1, "Simulated · Fictional trip, not real bus tracking", the distance to Fern Square, "Your bus is estimated about 5 minutes away" and the expected time at each stop.
- Point out: the real pilot uses the driver's phone (NEXUS Driver) instead of this button; it stays off until SIT approves live tracking. If a class teacher views Asha's first class on a morning the bus was delayed and she boarded, they see a "Bus delayed this morning" note — context only, the mark is theirs.

**1. Student morning (student)**
- Sign in as `student`. Today shows the next class in Room 101, "Lab 3 · Signals and sampling", attendance and the at-a-glance counts.
- Point out: every number comes from records; attendance shows 0/1 because Asha was marked absent this morning.

**1b. Ask AURA (student)**
- Open **AURA → Ask AURA a question in plain words** and ask "What's due this week and where is my lab?".
- It lists Lab 3 with its deadline and the next classes with rooms, each with its source.
- Ask "How do I get a bonafide letter?". It quotes the approved "Letters and certificates" policy with its version and offers **Request a letter**.
- Point out: there is no AI model here. A student in another section asking the same question sees only their own section's work (shown in step 14's spirit and in the tests).

**1c. Search (student)**
- Open **Search** and type "assessment". It finds the "Internal assessment circular" and the "Internal assessment week" date in one list, each linking to its own page.

**2. Submit work (student)**
- Open **Lab 3 · Signals and sampling**, enter a short answer and submit.
- Point out: the submission is final and timestamped in Asia/Kolkata.

**3. Fix an attendance mark (student)**
- Go to **Timetable** and open this morning's Introduction to Programming class. It shows "Your attendance: absent".
- Choose **Request an attendance correction**, write "I was present and signed late", then **Send correction request**.
- Open **Attendance details and what-if** from Today to show the planning view.

**4. Campus life (student)**
- **Sports:** ECE XI has trials open. Choose **Request a trial**.
- **Opportunities:** the "Graduate engineer · campus drive" card says it is only for ECE students. Choose **Track**.
- **Careers:** under the drive, open **Mark as submitted**, write a statement and choose **Submit application**.
- **Rooms, labs and library:** request ECE Lab 2 tomorrow evening with purpose "Robot build", supervising teacher Riya Rao, then **Request booking**.
- **Service requests** (from Today, "Request an enrollment letter"): enter "Bonafide letter for a bank account" and choose **Submit request**.

**5. Teacher (faculty)**
- Sign in as `faculty`. Mission control shows "2 submissions awaiting evaluation": Lab 2 from the demo data and the Lab 3 Asha just submitted. It also shows today's classes.
- Choose **Go to evaluation queue**, open Asha's Lab 2, enter marks and feedback, save, then publish.
- Point out: students see marks only after publication; corrections need a reason.

**6. Teacher decides (faculty)**
- **Timetable → Attendance correction requests:** accept Asha's request with the reason "Register signature verified". It leaves the queue.
- **Sports:** on ECE XI, open **Decide trial: Asha Sen**, keep **Select**, reason "Quick and composed", then **Record decision**.
- **Outcomes:** CO1 is approved; CO2 waits for the HOD. Under "Tag assessments", tag Lab 2 with CO1.

**7. Department head (hod)**
- Sign in as `hod`. Open **Outcomes**. Approve CO2 with the reason "Measurable".
- Show **Attainment · Introduction to Programming · Section A**: CO1 is assessed, attained and has a level. Programme outcomes follow from the mapping. Point out the rule stated at the top.
- Optional: the department home shows faculty, sections, results and attendance by section.

**8. Student sees the results (student)**
- Sign in as `student`.
- The inbox shows "Result published: Lab 2 · Sorting algorithms", "Attendance correction accepted" and "You were selected for ECE XI". This needs the worker running.
- **Sports:** the league table shows ECE XI 2–1 against Mechanical XI.
- Open this morning's class from Today: "Your attendance: present", with the teacher's decision and reason under Attendance corrections.

**9. Office queue (admin)**
- Sign in as `admin`. **Service requests:** open the bonafide request, **Start review**, enter the outcome "Letter is ready at the academic office", then **Record outcome**.

**10. Certificates (admin, then the public)**
- **Certificates:** choose Asha Sen, **Prepare draft**, check the sources listed, **Issue certificate**, confirm **Issue**. Copy the 12-character verification code.
- In the private window, open `/verify` and enter the code. It shows the type, institution, date, status and initials only.

**11. Placement drive (admin)**
- **Careers → Placement-drive applicants:** Asha's application shows her statement. Record **Shortlisted** with the note "Interview on Monday".
- Then record **Offer recorded** with the note "Offer letter issued". The department summary counts it.

**12. Lab booking (admin)**
- **Rooms, labs and library:** approve Asha's ECE Lab 2 request with the reason "Lab assistant on duty".
- Point out: approval is refused automatically if a class or another booking holds the room.

**13. Principal (principal)**
- Sign in as `principal`. Show departments compared, academic progress by cohort, campus operations, room use and quality indicators. Each indicator states its definition and limitation.
- **Decision simulation:** try a 75% and an 85% attendance minimum. Point out that it changes nothing.

**14. Isolation (tenant)**
- Sign in as `tenant` (Westhaven College). Show that none of Northfield's students, outcomes, sports or applications appear.

## What to say about status
- The whole script, transport opening included, was rehearsed automatically on a clean demo database (`tests/demo/dec2.rehearsal.ts`, passed on 28 Nov at about 11:17 UTC).
- Transport is simulated: no phone has reported a real bus position, and live tracking, push alerts and map tiles are off until approved. Everything shown is also functionally tested on a fresh local PostgreSQL database. The latest run is recorded in `docs/NEXUS_ENGINEERING_LEDGER.md` and `docs/evidence/test-run.json`.
- It is not hosted, not connected to SIT systems, and not validated with SIT staff or students.
- AURA answers from records; no live AI model is connected until a key with a spending cap is approved.
- Notifications are in-app only.

## If something goes wrong
- **A step fails:** reload the database with the commands above. The demo data is idempotent but is not reset by a second run, so start from a clean data directory for a full rehearsal.
- **Classes show as finished or missing:** the demo data was loaded too long ago. Reload it.
