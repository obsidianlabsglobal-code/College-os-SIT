"use client";

import { useState } from "react";
import { PreparedMessage } from "../experience/prepared-message";
import { requestLetter } from "../../lib/prepared-message";
import { ActionForm } from "../forms";
import { caseAction } from "../actions/cases";
import type { Scope } from "../../lib/scope";

export function LetterBuilder({institution,person,affiliation,context}:{institution:string;person:string;affiliation:string;context?:Pick<Scope,"institution"|"role">}) {
  const [type,setType]=useState<"leave"|"permission">("leave");
  const [draft,setDraft]=useState<string|null>(null);
  const [subject,setSubject]=useState("");
  const [error,setError]=useState("");
  return <div className="grid">
    <section className="panel" aria-labelledby="letter-setup">
      <h2 id="letter-setup">Prepare a request</h2>
      <p className="meta">Drafted as {person} · {affiliation}. The draft is not stored unless you submit it. Share only what is necessary.</p>
      <form className="form" style={{marginTop:"var(--space-3)"}} onChange={()=>{setDraft(null);setError("");}} onSubmit={event=>{
        event.preventDefault();
        const values=new FormData(event.currentTarget);
        const get=(name:string)=>String(values.get(name)??"");
        const result=requestLetter({type,institution,person,affiliation,recipient:get("recipient"),
          firstDate:get("from"),lastDate:get("through"),reason:get("reason")});
        if(!result){setError("Check the recipient, purpose and dates. The end date cannot be earlier than the start date.");return;}
        setDraft(result);setError("");
        setSubject(`${type==="leave"?"Leave":"Permission"} request · ${get("from")} to ${get("through")}`);
      }}>
        <label>Request type<select value={type} onChange={event=>setType(event.target.value==="permission"?"permission":"leave")}>
          <option value="leave">Leave request</option><option value="permission">Permission request</option>
        </select></label>
        <label>Addressed to<input name="recipient" maxLength={100} required placeholder="e.g. Head of Department"/></label>
        <div className="grid">
          <label>From date<input type="date" name="from" required/></label>
          <label>Through date<input type="date" name="through" required/></label>
        </div>
        <label>{type==="leave"?"Brief reason (optional)":"Purpose of request"}
          <textarea name="reason" maxLength={250} required={type==="permission"}/>
        </label>
        <div><button type="submit" className="button">Generate draft</button></div>
        {error&&<p role="alert" className="error">{error}</p>}
      </form>
    </section>
    {draft ? <div className="stack"><PreparedMessage title="Your letter draft" buttonLabel="Copy letter" messageLabel="Letter text" previewOpen
      message={draft} description="Review the recipient and dates before sharing. Nothing has been submitted or approved."/>
      {context&&<section className="panel stack" aria-labelledby="letter-submit">
        <h2 id="letter-submit">Submit to the office</h2>
        <p className="meta">The office receives this letter as a request, assigns an owner and records the outcome. Only you and the office can read it. Track it under Cases → Letters.</p>
        <ActionForm action={caseAction} context={context} operation="open" label="Submit letter">
          <input type="hidden" name="kind" value="letter"/><input type="hidden" name="title" value={subject}/><input type="hidden" name="body" value={draft}/>
        </ActionForm>
      </section>}</div> :
      <section className="panel"><h2>Preview</h2><p className="meta">Your copy-ready letter will appear here after you generate a draft.</p></section>}
  </div>;
}
