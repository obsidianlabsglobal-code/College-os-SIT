// Fictional demo data for the 2 December walkthrough (docs/DEMO_DEC2.md). Run after `npm run db:seed` on a local database
// that is only for the demo: the integration tests expect the plain seed, so never run this before `npm test`.
// Times are relative to when this runs; run it shortly before the demo. Idempotent: fixed ids, ON CONFLICT DO NOTHING.
import "./environment";
import { Client } from "pg";
import { databaseConnection } from "../lib/database-target";
import { fixtures as f, demoEmail } from "./fixtures";

const id = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (process.env.NEXUS_DEMO_SEED !== "1" || !url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
    throw new Error("Set NEXUS_DEMO_SEED=1 and use a local database dedicated to the demo.");
  }
  const client = new Client({ connectionString: databaseConnection("migration") });
  await client.connect();
  const people = Object.fromEntries((await client.query<{ email: string; id: string }>('SELECT email,id FROM "user" WHERE email LIKE $1', ["%@nexus.example.invalid"]))
    .rows.map(r => [r.email.split("@")[0], r.id]));
  if (!people.admin) throw new Error("Run `npm run db:seed` first.");
  const [i, offering] = [f.institution, f.offering];
  const q = (sql: string, params: unknown[] = []) => client.query(sql, params);
  try {
    await q("BEGIN");
    // Rooms, a lab, a ground and equipment.
    await q(`INSERT INTO campus_resource (institution_id,id,name,kind,location,capacity) VALUES
      ($1,$2,'Room 101','room','Academic block A',60),($1,$3,'ECE Lab 2','room','ECE building, first floor',30),
      ($1,$4,'Main ground','room','Sports complex',null),($1,$5,'Oscilloscope OSC-07','equipment','ECE Lab 2',null) ON CONFLICT DO NOTHING`,
    [i, id(1), id(2), id(3), id(4)]);

    // Classes: one held three hours ago (Asha marked absent, so she can ask for a correction), one later today, one tomorrow.
    const sessions: [number, string, string][] = [[10, "now()-interval '3 hours'", "conducted"], [11, "now()+interval '2 hours'", "published"], [12, "now()+interval '26 hours'", "published"]];
    for (const [n, start, state] of sessions) await q(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,created_by,published_at)
      SELECT $1,$2,gen_random_uuid(),$3,o.section_id,$4,$5,tstzrange(${start},${start}+interval '1 hour'),$6,$4,now()-interval '7 days'
      FROM offering o WHERE o.institution_id=$1 AND o.id=$3 ON CONFLICT DO NOTHING`, [i, id(n), offering, people.faculty, id(1), state]);
    await q("INSERT INTO class_attendance_revision (institution_id,session_id,revision,actor_id) VALUES ($1,$2,1,$3) ON CONFLICT DO NOTHING", [i, id(10), people.faculty]);
    await q("INSERT INTO class_attendance_mark VALUES ($1,$2,1,$3,'absent') ON CONFLICT DO NOTHING", [i, id(10), people.student]);

    // Assignments: one open (the student submits live), one awaiting marks (the teacher grades live), one with a published result.
    const assignments: [number, string, string][] = [
      [20, "Lab 3 · Signals and sampling", "now()+interval '2 days'"], [21, "Lab 2 · Sorting algorithms", "now()-interval '1 day'"], [22, "Lab 1 · Hello, embedded C", "now()-interval '8 days'"]];
    for (const [n, title, deadline] of assignments) await q(`INSERT INTO assignment (institution_id,id,offering_id,title,description,deadline,max_marks,rubric,published_at)
      VALUES ($1,$2,$3,$4,'Fictional lab task for the demo.',${deadline},20,'Correctness 10 · Explanation 6 · Style 4',now()-interval '10 days') ON CONFLICT DO NOTHING`,
    [i, id(n), offering, title]);
    for (const [n, a, ago] of [[30, 21, "2 days"], [31, 22, "9 days"]] as const) await q(`INSERT INTO submission (institution_id,id,assignment_id,student_id,body,submitted_at,request_id)
      VALUES ($1,$2,$3,$4,'Fictional submission text.',now()-$5::interval,gen_random_uuid()) ON CONFLICT DO NOTHING`, [i, id(n), id(a), people.student, ago]);
    await q(`INSERT INTO grade (institution_id,submission_id,revision,marks,feedback,published_at) VALUES ($1,$2,1,16,'Clear explanation; tidy code.',now()-interval '5 days')
      ON CONFLICT DO NOTHING`, [i, id(31)]);

    // Outcomes: programme outcomes, one approved course outcome tagged on Lab 1, one proposal waiting for the HOD.
    await q(`INSERT INTO programme_outcome (institution_id,id,code,statement,created_by) VALUES
      ($1,$2,'PO1','Apply engineering knowledge to solve problems',$4),($1,$3,'PO2','Communicate technical work clearly',$4) ON CONFLICT DO NOTHING`, [i, id(40), id(41), people.admin]);
    await q(`INSERT INTO course_outcome (institution_id,id,course_id,code,statement,state,proposed_by,decided_by,reason) VALUES
      ($1,$2,$3,'CO1','Write and test small embedded C programs','approved',$5,$6,'Measurable and mapped'),
      ($1,$4,$3,'CO2','Explain sampling and aliasing with examples','proposed',$5,null,null) ON CONFLICT DO NOTHING`, [i, id(42), f.course, id(43), people.faculty, people.hod]);
    await q(`INSERT INTO outcome_mapping VALUES ($1,$2,$4,3),($1,$2,$5,1),($1,$3,$4,2) ON CONFLICT DO NOTHING`, [i, id(42), id(43), id(40), id(41)]);
    await q("INSERT INTO assessment_outcome (institution_id,assignment_id,course_outcome_id,tagged_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [i, id(22), id(42), people.faculty]);

    // Careers: a placement drive for ECE students and a scholarship.
    await q(`INSERT INTO opportunity_listing (institution_id,id,kind,title,sponsor,eligibility,source_url,deadline,verified_by,department_id) VALUES
      ($1,$2,'placement','Graduate engineer · campus drive','Fictional Systems Pvt Ltd','Final-year ECE students; no active backlogs.','https://example.org/fictional-drive',current_date+10,$4,$5),
      ($1,$3,'scholarship','Merit scholarship 2026','Fictional Foundation','Students with a strong academic record; family income criteria apply.','https://example.org/fictional-scholarship',current_date+20,$4,null)
      ON CONFLICT DO NOTHING`, [i, id(50), id(51), people.admin, f.department]);

    // Sports: an interdepartmental league with two teams, trials open on the ECE team, one played match and one upcoming.
    await q(`INSERT INTO sport_tournament (institution_id,id,name,sport,level,starts_on,ends_on,created_by)
      VALUES ($1,$2,'Inter-department Football 2026','Football','interdepartmental',current_date-14,current_date+30,$3) ON CONFLICT DO NOTHING`, [i, id(60), people.admin]);
    await q(`INSERT INTO sport_team (institution_id,id,sport,name,department_id,coach_id,trials_open,created_by) VALUES
      ($1,$2,'Football','ECE XI',$4,$5,true,$6),($1,$3,'Football','Mechanical XI',$7,null,false,$6) ON CONFLICT DO NOTHING`,
    [i, id(61), id(62), f.department, people.faculty, people.admin, f.otherDepartment]);
    await q("INSERT INTO tournament_entry VALUES ($1,$2,$3),($1,$2,$4) ON CONFLICT DO NOTHING", [i, id(60), id(61), id(62)]);
    await q(`INSERT INTO sport_fixture (institution_id,id,tournament_id,home_team_id,away_team_id,venue_id,official_id,slot,state,home_score,away_score,result_by,result_at,created_by) VALUES
      ($1,$2,$4,$5,$6,$7,$8,tstzrange(now()-interval '4 days',now()-interval '4 days'+interval '90 minutes'),'completed',2,1,$8,now()-interval '4 days',$9),
      ($1,$3,$4,$6,$5,$7,$8,tstzrange(now()+interval '3 days',now()+interval '3 days'+interval '90 minutes'),'scheduled',null,null,null,null,$9) ON CONFLICT DO NOTHING`,
    [i, id(63), id(64), id(60), id(61), id(62), id(3), people.faculty, people.admin]);

    // Office services, library holdings and the institution calendar.
    await q(`INSERT INTO support_service (institution_id,id,category,name,description,contact,hours,created_by) VALUES
      ($1,$2,'counselling','Student counselling centre','Confidential one-to-one sessions with a counsellor.','Health centre, room 12','Mon–Sat, 10:00–17:00',$4),
      ($1,$3,'accessibility','Assistive technology desk','Screen readers, exam scribes and accessible materials.','Library, ground floor','Mon–Fri, 09:30–16:30',$4) ON CONFLICT DO NOTHING`,
    [i, id(70), id(71), people.admin]);
    await q(`INSERT INTO library_item (institution_id,id,title,author,copies,created_by) VALUES
      ($1,$2,'Signals and Systems (fictional edition)','A. Fictional',3,$4),($1,$3,'Embedded C for Beginners (fictional)','B. Example',2,$4) ON CONFLICT DO NOTHING`,
    [i, id(72), id(73), people.admin]);
    await q(`INSERT INTO calendar_entry (institution_id,id,title,kind,starts_on,ends_on,created_by) VALUES
      ($1,$2,'Internal assessment week','event',current_date+7,current_date+11,$4),($1,$3,'Founders'' day holiday','holiday',current_date+14,current_date+14,$4) ON CONFLICT DO NOTHING`,
    [i, id(74), id(75), people.admin]);
    await q("COMMIT");
    console.log(`Demo data ready for ${demoEmail("<alias>")} accounts.`);
  } catch (error) {
    await q("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
