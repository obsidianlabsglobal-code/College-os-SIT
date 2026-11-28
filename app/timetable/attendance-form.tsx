"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ActionForm } from "../forms";
import { StatusBreakdown } from "../experience/status-breakdown";
import { timetableAction } from "./actions";
import type { Scope } from "../../lib/scope";
import styles from "./attendance-form.module.css";

type Mark = "present"|"absent"|"";
type Learner = {student:string;name:string;status:Exclude<Mark,"">|null};
type Edit = {marks:Record<string,Mark>;beforeBulk:Record<string,Mark>|null};

export function AttendanceForm({current,session,revision,learners,correction}:{
  current:Pick<Scope,"institution"|"role">; session:string; revision:number; learners:Learner[]; correction:boolean;
}) {
  const [edit,setEdit] = useState<Edit>(()=>({marks:Object.fromEntries(learners.map(l=>[l.student,l.status ?? ""])),beforeBulk:null}));
  const [search,setSearch] = useState("");
  const [onlyUnmarked,setOnlyUnmarked] = useState(false);
  const heading = useId();
  const review = `attendance-save-${session}`;
  const nextFocus = useRef(false);
  const roll = useRef<HTMLUListElement>(null);
  const filter = useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if (!nextFocus.current) return;
    nextFocus.current = false;
    (roll.current?.querySelector<HTMLButtonElement>("button") ?? filter.current)?.focus();
  },[edit]);
  const {marks,beforeBulk} = edit;
  const present = learners.filter(learner=>marks[learner.student]==="present").length;
  const absent = learners.filter(learner=>marks[learner.student]==="absent").length;
  const unmarked = learners.length-present-absent;
  const visible = learners.filter(learner=>
    learner.name.normalize("NFKC").toLocaleLowerCase().includes(search.normalize("NFKC").trim().toLocaleLowerCase()) &&
    (!onlyUnmarked || !marks[learner.student]));
  const setMark = (student:string,mark:Mark) => {
    if (onlyUnmarked) nextFocus.current = true;
    setEdit(previous=>({
      marks:{...previous.marks,[student]:mark},
      // A manual edit starts a new step; avoid accidentally undoing it with the prior bulk operation.
      beforeBulk:null,
    }));
  };
  const bulk = (mark:Exclude<Mark,"">,remainingOnly=false) => setEdit(previous=>({
    beforeBulk:previous.marks,
    marks:Object.fromEntries(learners.map(learner=>[learner.student,
      remainingOnly && previous.marks[learner.student] ? previous.marks[learner.student] : mark])),
  }));
  return <section className={styles.workbench} aria-labelledby={heading}>
    <div className={styles.intro}>
      <p className="app-kicker">Attendance workbench</p>
      <h3 id={heading}>{correction ? "Correct recorded attendance" : "Take class attendance"}</h3>
      <p className="meta">{correction ? "Change only the marks you need to correct, then enter a reason." :
        "Mark exceptions first, then mark the remaining students present if you’ve verified they’re here."}</p>
    </div>
    <StatusBreakdown label="Roll sheet breakdown" segments={[
      {label:"Present",count:present,tone:"primary"},{label:"Absent",count:absent,tone:"attention"},{label:"Unmarked",count:unmarked,tone:"neutral"},
    ]} />
    <p className="sr-only" role="status">{present} present, {absent} absent, {unmarked} unmarked out of {learners.length}.</p>
    <ActionForm action={timetableAction} context={current} operation="attendance"
      label={correction ? "Save correction" : "Record attendance"} submissionDisabled={unmarked>0}>
      <input type="hidden" name="session" value={session} />
      <input type="hidden" name="revision" value={revision} />
      {learners.map(learner=><input type="hidden" key={learner.student} name={`mark:${learner.student}`} value={marks[learner.student] ?? ""}/>)}
      <div className={styles.controls}>
        <label>Find a student<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search by name" /></label>
        <button type="button" className="button secondary" ref={filter} aria-pressed={onlyUnmarked} onClick={()=>setOnlyUnmarked(value=>!value)}>Unmarked only</button>
      </div>
      <div className={styles.bulk}>
        {!correction && <button type="button" className="button secondary" disabled={!unmarked} onClick={()=>bulk("present",true)}>Mark remaining present</button>}
        {!unmarked && <a className="button secondary" href={`#${review}`}>Review and save</a>}
        <details><summary>Bulk actions</summary><div className="row">
          <button type="button" className="button secondary" onClick={()=>bulk("present")}>Mark all present</button>
          <button type="button" className="button secondary" onClick={()=>bulk("absent")}>Mark all absent</button>
        </div><p className="meta">Applies to the full roster, including filtered-out students. It does not save the record.</p></details>
      </div>
      {beforeBulk && <div className={styles.undo}>
        <p>Bulk marks applied to this draft.</p>
        <button type="button" className="button secondary" onClick={()=>setEdit({marks:beforeBulk,beforeBulk:null})}>Undo bulk edit</button>
      </div>}
      <p className="meta">{visible.length} of {learners.length} students shown</p>
      {visible.length ? <ul ref={roll} className={styles.roll}>{visible.map(learner=><li key={learner.student}>
        <span className={styles.student}>{learner.name}</span>
        <div className={styles.marks} role="group" aria-label={learner.name}>
          <button type="button" aria-pressed={marks[learner.student]==="present"} data-status="present"
            onClick={()=>setMark(learner.student,"present")}>Present</button>
          <button type="button" aria-pressed={marks[learner.student]==="absent"} data-status="absent"
            onClick={()=>setMark(learner.student,"absent")}>Absent</button>
        </div>
      </li>)}</ul> : <p className="meta">{onlyUnmarked && !unmarked ? "Everyone has been marked." : "No students match this filter."}</p>}
      <div className={styles.review} id={review} tabIndex={-1}>
        <h4>Review class record</h4>
        <p className="meta">{unmarked ? "Mark every student before saving." :
          `${present} present and ${absent} absent. Nothing is recorded until you save.`}</p>
      </div>
      {correction && <label>Correction reason<input name="reason" maxLength={500} required /></label>}
    </ActionForm>
  </section>;
}
