import assert from "node:assert/strict";
import {test} from "node:test";
import {attendanceGroupDraft} from "../lib/attendance-group-draft";

test("official group draft defaults to counts and does not include names",()=>{
  const input={
    course:"Signals Lab",section:"Section B",date:"Wed, 25 Nov 2026",time:"10 am – 11 am",timezone:"Asia/Kolkata",faculty:"Teacher Example",
    roster:[{name:"Present Person",status:"present"},{name:"Absent Example\nSecond line",status:"absent"}] as const,
  };
  const plain=attendanceGroupDraft(input)!;
  assert.match(plain,/Roster: 2 · Present: 1 · Absent: 1/);
  assert.doesNotMatch(plain,/Person|Absent Example/);
  const practice=attendanceGroupDraft({...input,fictionalPractice:true})!;
  assert.match(practice,/^FICTIONAL PRACTICE — DO NOT POST/);
  assert.match(practice,/1\. Absent Example Second line/);
  assert.doesNotMatch(practice,/Present Person/);
  assert.equal(attendanceGroupDraft({...input,roster:[{name:"Unmarked Example",status:null}]}),null);
});
