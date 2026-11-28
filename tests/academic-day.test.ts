// covers: OP-001, DH-008, ID-004, SA-005, SA-006, SA-008, SA-009, FC-004, FC-005
import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { attendancePercentage, attendanceSummary, changeClass, facultyAttendanceWork, nextClass, sessionDetail, timetable, timetableOptions } from "../lib/academic-day";
import { planningOptions, savePlanningTarget } from "../lib/attendance-planning";
import { db } from "../lib/db";
import type { Scope } from "../lib/scope";
import { demoEmail, fixtures as f } from "../scripts/fixtures";

const owner = new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
const accounts = new Map<string,string>();
const actor = (alias:string, role:Scope["role"],institution=f.institution):Scope=>({account:accounts.get(alias)!,role,institution});
const room = randomUUID();
const wall = (instant:Date,zone="Asia/Kolkata") => new Intl.DateTimeFormat("sv-SE",{
  dateStyle:"short",timeStyle:"short",timeZone:zone,
}).format(instant).replace(" ","T");
const hours = (value:number)=>new Date(Date.now()+value*3600000);
const draft = (start:string,end:string,weeks=1)=>({operation:"draft",room,offering:f.offering,faculty:accounts.get("faculty"),start,end,weeks});

before(async ()=>{
  for (const url of [process.env.DATABASE_URL,process.env.MIGRATION_DATABASE_URL]) {
    assert.ok(url && ["127.0.0.1","localhost"].includes(new URL(url).hostname));
  }
  for (const alias of ["admin","faculty","student","outsider","tenant","replacement","hod"]) {
    const {rows:[user]} = await owner.query<{id:string}>('SELECT id FROM "user" WHERE email=$1',[demoEmail(alias)]);
    accounts.set(alias,user.id);
  }
  await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,$3,'room','Test campus')",[f.institution,room,`Academic room ${room}`]);
});
after(async ()=>{
  try {
    const args = [f.institution,room];
    for (const table of ["class_attendance_mark","class_attendance_revision"]) {
      await owner.query(`DELETE FROM ${table} WHERE institution_id=$1 AND session_id IN
        (SELECT id FROM class_session WHERE institution_id=$1 AND room_id=$2)`,args);
    }
    await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND room_id=$2",args);
    await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2",args);
  } finally {
    await Promise.all([owner.end(),db.end()]);
  }
});

test("weekly publication is atomic and scoped, handles overlaps, adjacency, moves and cancellation",async ()=>{
  const admin = actor("admin","admin"), faculty = actor("faculty","faculty"), student = actor("student","student");
  const tomorrow = wall(hours(24)).slice(0,10);
  const start = tomorrow+"T09:30", end = tomorrow+"T10:00";
  assert.ok((await timetableOptions(admin)).staff.some(item=>item.offering===f.offering));
  const session = await changeClass(admin,draft(start,end,2));
  const conflict = await changeClass(admin,draft(start,end));
  assert.equal(await sessionDetail(student,session),null);
  await assert.rejects(changeClass(faculty,{operation:"publish",session,revision:0}),/unavailable/);
  await changeClass(admin,{operation:"publish",session,revision:0});
  await assert.rejects(changeClass(admin,{operation:"publish",session:conflict,revision:0}),/already has a class/);
  assert.equal((await sessionDetail(admin,conflict))?.row.state,"draft");
  const item = (await timetable(student,start.slice(0,10),1)).find(row=>row.id===session);
  assert.ok(item);
  assert.equal(wall(item.start),start);
  const recurrence = await owner.query("SELECT count(*)::int AS count FROM class_session WHERE series_id=$1 AND state='published'",[item.series_id]);
  assert.equal(recurrence.rows[0].count,2);
  for (const unrelated of [actor("outsider","student"),actor("replacement","faculty"),actor("tenant","student",f.otherInstitution)]) {
    assert.equal(await sessionDetail(unrelated,session),null);
  }
  assert.ok(await sessionDetail(actor("hod","hod"),session));
  assert.equal((await nextClass(student))?.id,session);
  const adjacent = await changeClass(admin,draft(end,tomorrow+"T10:30"));
  await changeClass(admin,{operation:"publish",session:adjacent,revision:0});
  await assert.rejects(changeClass(admin,{operation:"move",session,revision:1,start:end,end:tomorrow+"T10:30",reason:"Conflict"}),/already has a class/);
  await changeClass(admin,{operation:"move",session,revision:1,start:tomorrow+"T12:00",end:tomorrow+"T12:30",reason:"Special timetable"});
  await assert.rejects(changeClass(admin,{operation:"cancel",session,revision:1,reason:"Holiday"}),/changed/);
  await changeClass(admin,{operation:"cancel",session,revision:2,reason:"Holiday"});
  assert.equal((await sessionDetail(student,session))?.row.change_reason,"Holiday");
  await assert.rejects(changeClass(faculty,{operation:"attendance",session,revision:3,reason:"",marks:[{student:student.account,status:"present"}]}),/unavailable/);
});

test("bulk attendance snapshots the current roster and revisions preserve the original marks",async ()=>{
  const admin = actor("admin","admin"), faculty = actor("faculty","faculty"), student = actor("student","student");
  const yesterday = wall(hours(-24)).slice(0,10), today = wall(hours(0)).slice(0,10);
  const session = await changeClass(admin,draft(yesterday+"T10:00",yesterday+"T11:00"));
  await changeClass(admin,{operation:"publish",session,revision:0});
  const detail = await sessionDetail(faculty,session);
  assert.ok(detail);
  assert.equal((await facultyAttendanceWork(faculty,today)).find(row=>row.id===session)?.state,"published");
  assert.equal((await facultyAttendanceWork(actor("replacement","faculty"),today)).some(row=>row.id===session),false);
  assert.deepEqual(await facultyAttendanceWork(actor("hod","hod"),today),[]);
  assert.ok(detail?.learners.some(learner=>learner.student===student.account));
  const marks = detail.learners.map(learner=>({student:learner.student,status:"absent"}));
  const action = {operation:"attendance",session,revision:1,reason:"",marks};
  await assert.rejects(changeClass(actor("replacement","faculty"),action),/unavailable/);
  await assert.rejects(changeClass(faculty,{...action,marks:[...marks,...marks]}),/every learner once/);
  const attempts = await Promise.allSettled([changeClass(faculty,action),changeClass(faculty,action)]);
  assert.equal(attempts.filter(attempt=>attempt.status==="fulfilled").length,1);
  assert.equal(attempts.filter(attempt=>attempt.status==="rejected" && /changed/.test(String(attempt.reason))).length,1);
  assert.equal((await facultyAttendanceWork(faculty,today)).find(row=>row.id===session)?.state,"conducted");
  const afterEntry = (await attendanceSummary(student)).find(item=>item.offering_id===f.offering);
  assert.deepEqual([afterEntry?.present,afterEntry?.recorded],[0,1]);
  const correction = {...action,revision:2,marks:marks.map(mark=>({...mark,status:"present"}))};
  await assert.rejects(changeClass(faculty,correction),/correction reason/);
  await changeClass(faculty,{...correction,reason:"Verified sign-in register"});
  assert.equal((await sessionDetail(student,session))?.row.attendance,"present");
  const summary = (await attendanceSummary(student)).find(item=>item.offering_id===f.offering);
  assert.deepEqual([summary?.present,summary?.recorded],[1,1]);
  assert.equal(attendancePercentage(2,3),"66.7");
  assert.equal(attendancePercentage(0,0),null);
  const {rows} = await owner.query("SELECT revision,status FROM class_attendance_mark WHERE session_id=$1 AND student_id=$2 ORDER BY revision",[session,student.account]);
  assert.deepEqual(rows,[{revision:1,status:"absent"},{revision:2,status:"present"}]);
  const events = await owner.query("SELECT action FROM audit_event WHERE entity_id=$1 ORDER BY id",[session]);
  assert.deepEqual(events.rows.map(item=>item.action),["class.drafted","class.published","attendance.recorded","attendance.corrected"]);
  await owner.query("UPDATE roster SET ended_at=now() WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3",[f.institution,f.offering,student.account]);
  try {
    assert.equal(await sessionDetail(student,session),null);
    assert.deepEqual(await attendanceSummary(student),[]);
  } finally {
    await owner.query("UPDATE roster SET ended_at=NULL WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3",[f.institution,f.offering,student.account]);
  }
});

test("ambiguous and skipped DST wall times are rejected without moving a class",async ()=>{
  const admin = actor("admin","admin");
  await owner.query("UPDATE institution SET timezone='America/New_York' WHERE id=$1",[f.institution]);
  try {
    for (const [start,end] of [["2027-03-14T02:15","2027-03-14T03:30"],["2027-11-07T01:15","2027-11-07T02:30"]]) {
      await assert.rejects(changeClass(admin,draft(start,end)),/Repeated or skipped/);
    }
    const session = await changeClass(admin,draft("2027-03-07T09:00","2027-03-07T10:00",2));
    const detail = await sessionDetail(admin,session);
    assert.equal(detail?.row.start.toISOString(),"2027-03-07T14:00:00.000Z");
    const {rows}=await owner.query<{start:Date}>("SELECT lower(slot) AS start FROM class_session WHERE series_id=$1 ORDER BY 1",[detail?.row.series_id]);
    assert.equal(rows[1].start.toISOString(),"2027-03-14T13:00:00.000Z");
  } finally {
    await owner.query("UPDATE institution SET timezone='Asia/Kolkata' WHERE id=$1",[f.institution]);
  }
});

test("planning targets are versioned, tenant-scoped and withdrawable", async () => {
  const admin = actor("admin","admin");
  const original = (await planningOptions(admin)).find(row=>row.id===f.offering)!;
  const input = {offering:f.offering,revision:original.revision,percent:78,source:"Fictional planning policy"};
  for (const denied of [actor("student","student"),actor("tenant","admin"),actor("admin","admin",f.otherInstitution)]) {
    await assert.rejects(savePlanningTarget(denied,input),/unavailable/);
  }
  await assert.rejects(savePlanningTarget(admin,{...input,percent:101}));
  const attempts = await Promise.allSettled([savePlanningTarget(admin,input),savePlanningTarget(admin,input)]);
  assert.equal(attempts.filter(r=>r.status==="fulfilled").length,1);
  assert.match(String(attempts.find(r=>r.status==="rejected")?.reason),/changed/);
  const saved = (await planningOptions(admin)).find(row=>row.id===f.offering)!;
  assert.equal(saved.percent,78);
  await savePlanningTarget(admin,{...input,revision:saved.revision,percent:null,source:"Withdrawn for review"});
  assert.equal((await planningOptions(admin)).find(row=>row.id===f.offering)?.percent,null);
});

test("OP-001: two sections cannot share a room at the same time; the clash is found before publication completes",async ()=>{
  const admin = actor("admin","admin");
  // A second teacher for Section B, only for this check.
  await owner.query("INSERT INTO roster (institution_id,offering_id,account_id,role) VALUES ($1,$2,$3,'faculty') ON CONFLICT DO NOTHING",[f.institution,f.otherOffering,accounts.get("replacement")]);
  try {
    const day = wall(hours(24*5)).slice(0,10);
    const first = await changeClass(admin,{...draft(day+"T14:00",day+"T15:00")});
    const second = await changeClass(admin,{operation:"draft",room,offering:f.otherOffering,faculty:accounts.get("replacement"),start:day+"T14:30",end:day+"T15:30",weeks:1});
    await changeClass(admin,{operation:"publish",session:first,revision:0});
    await assert.rejects(changeClass(admin,{operation:"publish",session:second,revision:0}),/This room already has a class/);
    assert.equal((await sessionDetail(admin,second))?.row.state,"draft","the clashing class stays a draft to be re-planned");
  } finally {
    await owner.query("DELETE FROM roster WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role='faculty'",[f.institution,f.otherOffering,accounts.get("replacement")]);
  }
});
