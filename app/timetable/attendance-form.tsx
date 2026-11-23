"use client";

import { useState } from "react";
import { ActionForm } from "../forms";
import { timetableAction } from "./actions";
import type { Scope } from "../../lib/scope";

type Learner = {student:string;name:string;status:"present"|"absent"|null};

export function AttendanceForm({current,session,revision,learners,correction}:{
  current:Pick<Scope,"institution"|"role">; session:string; revision:number; learners:Learner[]; correction:boolean;
}) {
  const [marks,setMarks] = useState<Record<string,string>>(()=>Object.fromEntries(learners.map(l=>[l.student,l.status ?? ""])));
  const present = Object.values(marks).filter(value=>value==="present").length;
  const absent = Object.values(marks).filter(value=>value==="absent").length;
  return <ActionForm action={timetableAction} context={current} operation="attendance" label={correction ? "Save correction" : "Record attendance"}>
    <input type="hidden" name="session" value={session} />
    <input type="hidden" name="revision" value={revision} />
    <div className="row">
      <button type="button" className="button secondary"
        onClick={()=>setMarks(Object.fromEntries(learners.map(l=>[l.student,"present"])))}>Mark all present</button>
      <button type="button" className="button secondary"
        onClick={()=>setMarks(Object.fromEntries(learners.map(l=>[l.student,"absent"])))}>Mark all absent</button>
    </div>
    <p role="status" className="meta">{present} present · {absent} absent · {learners.length-present-absent} unmarked</p>
    <div className="grid">{learners.map(learner=><label key={learner.student}>{learner.name}
      <select name={`mark:${learner.student}`} required value={marks[learner.student] ?? ""}
        onChange={event=>setMarks({...marks,[learner.student]:event.target.value})}>
        <option value="">Choose a mark</option><option value="present">Present</option><option value="absent">Absent</option>
      </select>
    </label>)}</div>
    {correction && <label>Correction reason<input name="reason" maxLength={500} required /></label>}
  </ActionForm>;
}
