import type { PoolClient } from "pg";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

const id = z.uuid();
const wallTime = z.iso.datetime({ local:true, precision:-1 }).refine(value=>!value.endsWith("Z"),"Use institutional local time.");
const revision = z.number().int().min(0).max(2147483646);
const reason = z.string().trim().min(1,"Enter a reason.").max(500);
const status = z.enum(["present","absent"]);
const command = z.discriminatedUnion("operation",[
  z.object({operation:z.literal("draft"),offering:id,faculty:z.string().min(1).max(100),room:id,start:wallTime,end:wallTime,weeks:z.number().int().min(1).max(16)}),
  z.object({operation:z.literal("publish"),session:id,revision}),
  z.object({operation:z.literal("cancel"),session:id,revision,reason}),
  z.object({operation:z.literal("move"),session:id,revision,reason,start:wallTime,end:wallTime}),
  z.object({operation:z.literal("attendance"),session:id,revision,reason:z.string().trim().max(500),
    marks:z.array(z.object({student:z.string().min(1).max(100),status})).min(1).max(500)}),
]);

const membership = (alias: string) => `EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=${alias}.institution_id
  AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL)`;
const roster = `EXISTS (SELECT 1 FROM roster r WHERE (r.institution_id,r.offering_id)=(s.institution_id,s.offering_id)
  AND r.account_id=$2 AND r.role=$3 AND r.ended_at IS NULL)`;
const readable = `${membership("s")} AND ($3='admin' OR (s.state<>'draft' AND (
  ($3='hod' AND EXISTS (SELECT 1 FROM membership h WHERE h.institution_id=s.institution_id
    AND h.account_id=$2 AND h.role='hod' AND h.ended_at IS NULL AND h.department_id=c.department_id))
  OR (${roster} AND ($3='student' OR ($3='faculty' AND s.faculty_id=$2))))))`;

type Session = {
  id:string; offering_id:string; section_id:string; room_id:string; faculty_id:string;
  state:"draft"|"published"|"cancelled"|"conducted"; revision:number; series_id:string; change_reason:string|null;
  start:Date; finish:Date; course:string; section:string; room:string; teacher:string; attendance:"present"|"absent"|null;
};

const sessionSelect = `SELECT s.id,s.offering_id,s.section_id,s.room_id,s.faculty_id,s.state,s.revision,s.series_id,s.change_reason,
  lower(s.slot) AS start,upper(s.slot) AS finish,c.name AS course,sec.name AS section,room.name AS room,u.name AS teacher,
  mark.status AS attendance
  FROM class_session s JOIN offering o ON (o.institution_id,o.id)=(s.institution_id,s.offering_id)
  JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
  JOIN section sec ON (sec.institution_id,sec.id)=(s.institution_id,s.section_id)
  JOIN campus_resource room ON (room.institution_id,room.id)=(s.institution_id,s.room_id)
  JOIN "user" u ON u.id=s.faculty_id
  LEFT JOIN LATERAL (
    SELECT status FROM class_attendance_mark WHERE (institution_id,session_id)=(s.institution_id,s.id)
      AND student_id=$2 AND $3='student' ORDER BY revision DESC LIMIT 1
  ) mark ON true`;

export async function timetable(scope:Scope, day:string, days:1|7) {
  return (await db.query<Session>(`${sessionSelect}
    JOIN institution i ON i.id=s.institution_id
    WHERE s.institution_id=$1 AND ${readable}
      AND s.slot && tstzrange($4::date::timestamp AT TIME ZONE i.timezone,
        ($4::date+$5::integer)::timestamp AT TIME ZONE i.timezone,'[)')
    ORDER BY lower(s.slot),s.id`,[scope.institution,scope.account,scope.role,day,days])).rows;
}

export async function nextClass(scope:Scope) {
  return (await db.query<Session>(`${sessionSelect}
    WHERE s.institution_id=$1 AND ${readable} AND s.state='published' AND upper(s.slot)>now()
    ORDER BY lower(s.slot),s.id LIMIT 1`,[scope.institution,scope.account,scope.role])).rows[0];
}

export async function attendanceSummary(scope:Scope) {
  if (scope.role!=="student") return [];
  return (await db.query<{offering_id:string;course:string;term:string;present:number;recorded:number;target:number|null;source:string|null}>(`
    SELECT s.offering_id,c.name AS course,t.name AS term,count(*) FILTER (WHERE m.status='present')::int AS present,
      count(*)::int AS recorded,p.percent AS target,p.source
    FROM class_attendance_mark m JOIN class_session s ON (s.institution_id,s.id)=(m.institution_id,m.session_id)
    JOIN class_attendance_revision v ON (v.institution_id,v.session_id,v.revision)=(m.institution_id,m.session_id,m.revision)
    JOIN offering o ON (o.institution_id,o.id)=(s.institution_id,s.offering_id)
    JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
    JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
    LEFT JOIN LATERAL (SELECT percent,source FROM attendance_planning_target
      WHERE (institution_id,offering_id)=(s.institution_id,s.offering_id) ORDER BY revision DESC LIMIT 1) p ON true
    WHERE s.institution_id=$1 AND m.student_id=$2 AND s.state='conducted' AND ${readable}
      AND v.revision=(SELECT max(v2.revision) FROM class_attendance_revision v2
        WHERE (v2.institution_id,v2.session_id)=(s.institution_id,s.id))
    GROUP BY s.offering_id,c.name,t.name,p.percent,p.source ORDER BY c.name,t.name,s.offering_id`,[scope.institution,scope.account,scope.role])).rows;
}

export function attendancePercentage(present:number, recorded:number) {
  return recorded ? (100 * present / recorded).toFixed(1) : null;
}

export async function sessionDetail(scope:Scope, session:string) {
  const {rows:[row]} = await db.query<Session>(`${sessionSelect}
    WHERE s.institution_id=$1 AND s.id=$4 AND ${readable}`,[scope.institution,scope.account,scope.role,session]);
  if (!row) return null;
  const learners = scope.role==="faculty" && row.state!=="cancelled"
    ? await roll(db,scope,row.id,row.offering_id)
    : [];
  return {row, learners};
}

type Learner = {student:string;name:string;status:"present"|"absent"|null};
async function roll(client:Pick<PoolClient,"query">,scope:Scope,session:string,offering:string,lock=false) {
  // Current grant must also hold when reading names after resolving the session.
  const faculty = `EXISTS (SELECT 1 FROM roster f JOIN membership fm USING (institution_id,account_id,role)
    WHERE f.institution_id=$1 AND f.offering_id=$4 AND f.account_id=$3 AND f.role='faculty'
      AND f.ended_at IS NULL AND fm.ended_at IS NULL)`;
  const {rows} = await client.query<Learner>(`
    SELECT u.id AS student,u.name,mark.status
    FROM roster r JOIN membership m USING (institution_id,account_id,role)
    JOIN "user" u ON u.id=r.account_id
    LEFT JOIN LATERAL (SELECT status FROM class_attendance_mark
      WHERE institution_id=$1 AND session_id=$2 AND student_id=u.id ORDER BY revision DESC LIMIT 1) mark ON true
    WHERE r.institution_id=$1 AND r.offering_id=$4 AND r.role='student' AND ${faculty}
      AND ((r.ended_at IS NULL AND m.ended_at IS NULL) OR mark.status IS NOT NULL)
      AND (mark.status IS NOT NULL OR NOT EXISTS (SELECT 1 FROM class_attendance_revision WHERE institution_id=$1 AND session_id=$2))
    ORDER BY u.name,u.id ${lock ? "FOR SHARE OF r,m" : ""}`,[scope.institution,session,scope.account,offering]);
  return rows;
}

const unavailable = () => new WorkflowError("This class action is unavailable.");

async function lockFaculty(client:PoolClient,institution:string,offering:string,faculty:string) {
  if (!(await client.query(`SELECT 1 FROM roster r JOIN membership m USING (institution_id,account_id,role)
    WHERE r.institution_id=$1 AND r.offering_id=$2 AND r.account_id=$3 AND r.role='faculty'
      AND r.ended_at IS NULL AND m.ended_at IS NULL FOR SHARE OF r,m`,[institution,offering,faculty])).rowCount) throw unavailable();
}

export async function timetableOptions(scope:Scope) {
  if (scope.role!=="admin") return {staff:[],rooms:[]};
  const args = [scope.institution,scope.account,scope.role];
  const [staff,rooms] = await Promise.all([
    db.query<{offering:string;faculty:string;label:string}>(`SELECT o.id AS offering,u.id AS faculty,
      c.name || ' · ' || sec.name || ' · ' || t.name || ' · ' || u.name AS label
      FROM offering o JOIN roster r ON (r.institution_id,r.offering_id)=(o.institution_id,o.id)
      JOIN membership fm ON (fm.institution_id,fm.account_id,fm.role)=(r.institution_id,r.account_id,r.role)
      JOIN "user" u ON u.id=r.account_id
      JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
      JOIN section sec ON (sec.institution_id,sec.id)=(o.institution_id,o.section_id)
      JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
      WHERE o.institution_id=$1 AND ${membership("o")} AND r.role='faculty'
        AND r.ended_at IS NULL AND fm.ended_at IS NULL ORDER BY 3,1,2`,args),
    db.query<{id:string;label:string}>(`SELECT room.id,room.name || ' · ' || room.location AS label
      FROM campus_resource room WHERE room.institution_id=$1 AND room.kind='room' AND ${membership("room")} ORDER BY 2,1`,args),
  ]);
  return {staff:staff.rows,rooms:rooms.rows};
}

// Each occurrence is converted from institutional wall time independently.
// Reject skipped and repeated wall times so DST transitions cannot silently move a class.
const slots = `WITH local AS (
  SELECT $2::timestamp + n * interval '7 days' AS starts,$3::timestamp + n * interval '7 days' AS ends,i.timezone
  FROM institution i CROSS JOIN generate_series(0,$4::integer-1) n WHERE i.id=$1
), converted AS (
  SELECT *, starts AT TIME ZONE timezone AS a, ends AT TIME ZONE timezone AS b FROM local
)
SELECT CASE WHEN a<b AND starts::date=ends::date AND starts=a AT TIME ZONE timezone AND ends=b AT TIME ZONE timezone
 AND NOT EXISTS (SELECT 1 FROM (VALUES(a,starts),(b,ends)) v(instant,wall)
   CROSS JOIN (VALUES(interval '-1 day'),(interval '1 day')) d(delta)
   CROSS JOIN LATERAL (SELECT (v.wall+d.delta) - (((v.wall+d.delta) AT TIME ZONE timezone) AT TIME ZONE 'UTC') AS alternate,
     v.wall - (v.instant AT TIME ZONE 'UTC') AS chosen) offsets
   WHERE alternate<>chosen AND (v.instant + chosen - alternate) AT TIME ZONE timezone = v.wall)
 THEN tstzrange(a,b,'[)') END::text AS slot FROM converted ORDER BY starts`;

async function scheduleSlots(client:PoolClient,institution:string,start:string,end:string,weeks:number) {
  const {rows} = await client.query<{slot:string|null}>(slots,[institution,start,end,weeks]);
  if (rows.some(row=>!row.slot)) throw new WorkflowError("Use a valid start and later end on the same institutional day. Repeated or skipped clock times are unavailable.");
  return rows.map(row=>row.slot!);
}

type LockedSession = Pick<Session,"id"|"series_id"|"offering_id"|"faculty_id"|"room_id"|"state"|"revision"> & {ended:boolean;future:boolean};

export async function changeClass(scope:Scope,raw:unknown) {
  const input = command.parse(raw);
  if (scope.role !== (input.operation==="attendance" ? "faculty" : "admin")) throw unavailable();
  try {
    return await transaction(async client=>{
      const institution = scope.institution;
      const actor = await client.query(`SELECT 1 FROM membership
        WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL FOR SHARE`,
        [institution,scope.account,scope.role]);
      if (!actor.rowCount) throw unavailable();
      // Serialize schedule mutations in this institution, including series publication.
      if (input.operation!=="attendance") {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`class-schedule:${institution}`]);
      }
      if (input.operation==="draft") {
        await lockFaculty(client,institution,input.offering,input.faculty);
        const ranges = await scheduleSlots(client,institution,input.start,input.end,input.weeks);
        const {rows} = await client.query<{id:string}>(`
          WITH series AS (SELECT gen_random_uuid() AS id)
          INSERT INTO class_session (institution_id,series_id,offering_id,section_id,faculty_id,room_id,slot,created_by)
          SELECT o.institution_id,series.id,o.id,o.section_id,$3,room.id,slot,$5
          FROM offering o JOIN campus_resource room ON room.institution_id=o.institution_id
          CROSS JOIN series CROSS JOIN unnest($6::tstzrange[]) AS slots(slot)
          WHERE o.institution_id=$1 AND o.id=$2 AND room.id=$4 AND room.kind='room'
          RETURNING id`,[institution,input.offering,input.faculty,input.room,scope.account,ranges]);
        if (rows.length!==input.weeks) throw unavailable();
        for (const row of rows) await audit(client,scope,row.id,"class.drafted",0);
        return rows[0].id;
      }

      const {rows:[session]} = await client.query<LockedSession>(`
        SELECT id,series_id,offering_id,faculty_id,room_id,state,revision,upper(slot)<=now() AS ended,lower(slot)>now() AS future
        FROM class_session WHERE institution_id=$1 AND id=$2 FOR UPDATE`,[institution,input.session]);
      if (!session || (scope.role==="faculty" && session.faculty_id!==scope.account)) throw unavailable();
      if (session.revision!==input.revision) throw new WorkflowError("This class changed. Refresh before saving.");

      if (input.operation==="attendance") {
        if (!session.ended || (session.state!=="published" && session.state!=="conducted")) throw unavailable();
        await lockFaculty(client,institution,session.offering_id,scope.account);
        const learners = await roll(client,scope,session.id,session.offering_id,true);
        const marks = new Map(input.marks.map(mark=>[mark.student,mark.status]));
        if (input.marks.length!==learners.length || marks.size!==learners.length || learners.some(learner=>!marks.has(learner.student))) {
          throw new WorkflowError("Mark every learner once. Refresh if the roster changed.");
        }
        if (session.state==="conducted" && !input.reason) throw new WorkflowError("Enter a correction reason.");
        const {rows:[saved]} = await client.query<{revision:number}>(`
          INSERT INTO class_attendance_revision (institution_id,session_id,revision,actor_id,reason)
          SELECT $1,$2,coalesce(max(revision),0)+1,$3,$4 FROM class_attendance_revision
          WHERE institution_id=$1 AND session_id=$2 RETURNING revision`,
          [institution,session.id,scope.account,input.reason || null]);
        await client.query(`INSERT INTO class_attendance_mark (institution_id,session_id,revision,student_id,status)
          SELECT $1,$2,$3,m.student,m.status FROM jsonb_to_recordset($4::jsonb) AS m(student text,status text)`,
          [institution,session.id,saved.revision,JSON.stringify(input.marks)]);
        await client.query("UPDATE class_session SET state='conducted',revision=revision+1 WHERE institution_id=$1 AND id=$2",[institution,session.id]);
        await audit(client,scope,session.id,saved.revision===1 ? "attendance.recorded" : "attendance.corrected",saved.revision);
        return session.id;
      }

      if (input.operation==="publish" || input.operation==="move") {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`booking:${institution}:${session.room_id}`]);
      }
      if (input.operation==="publish") {
        if (session.state!=="draft") throw unavailable();
        await lockFaculty(client,institution,session.offering_id,session.faculty_id);
        const booking = await client.query(`SELECT 1 FROM class_session s JOIN resource_booking b
          ON (b.institution_id,b.resource_id)=(s.institution_id,s.room_id) AND b.slot && s.slot
          WHERE s.institution_id=$1 AND s.series_id=$2 AND b.state='confirmed' LIMIT 1`,[institution,session.series_id]);
        if (booking.rowCount) throw new WorkflowError("A confirmed booking overlaps the proposed class time.");
        const {rows} = await client.query<{id:string}>(`UPDATE class_session SET state='published',published_at=now(),revision=revision+1
          WHERE institution_id=$1 AND series_id=$2 AND state='draft' RETURNING id`,[institution,session.series_id]);
        for (const row of rows) await audit(client,scope,row.id,"class.published",1);
        return session.id;
      }

      if (session.state!=="published" || !session.future) throw unavailable();
      if (input.operation==="move") {
        await lockFaculty(client,institution,session.offering_id,session.faculty_id);
        const [slot] = await scheduleSlots(client,institution,input.start,input.end,1);
        const booking = await client.query(`SELECT 1 FROM resource_booking WHERE institution_id=$1
          AND resource_id=$2 AND state='confirmed' AND slot && $3::tstzrange LIMIT 1`,[institution,session.room_id,slot]);
        if (booking.rowCount) throw new WorkflowError("A confirmed booking overlaps the proposed class time.");
        const moved = await client.query(`UPDATE class_session SET slot=$3,change_reason=$4,revision=revision+1
          WHERE institution_id=$1 AND id=$2 AND lower($3::tstzrange)>now()`,[institution,session.id,slot,input.reason]);
        if (!moved.rowCount) throw new WorkflowError("Choose a future class time.");
      } else {
        await client.query("UPDATE class_session SET state='cancelled',change_reason=$3,revision=revision+1 WHERE institution_id=$1 AND id=$2",
          [institution,session.id,input.reason]);
      }
      await audit(client,scope,session.id,input.operation==="move" ? "class.moved" : "class.cancelled",session.revision+1);
      return session.id;
    });
  } catch (error) {
    const conflict = error as {code?:string;constraint?:string};
    if (conflict.code==="23P01") {
      const subject = {class_room_overlap:"room",class_faculty_overlap:"faculty member",class_section_overlap:"section"}[conflict.constraint ?? ""];
      throw new WorkflowError(subject ? `This ${subject} already has a class during part of the proposed time.` : "A published class conflicts with this time.");
    }
    throw error;
  }
}
