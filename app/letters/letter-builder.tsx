"use client";

import { useState } from "react";
import { PreparedMessage } from "../experience/prepared-message";
import { requestLetter } from "../../lib/prepared-message";

export function LetterBuilder({institution,person,affiliation}:{institution:string;person:string;affiliation:string}) {
  const [type,setType]=useState<"leave"|"permission">("leave");
  const [draft,setDraft]=useState<string|null>(null);
  const [error,setError]=useState("");
  return <div className="grid">
    <section className="panel" aria-labelledby="letter-setup">
      <h2 id="letter-setup">Prepare a request</h2>
      <p className="meta">Drafted as {person} · {affiliation}. The form does not store your reason. Share only what is necessary.</p>
      <form className="form" style={{marginTop:"var(--space-3)"}} onChange={()=>{setDraft(null);setError("");}} onSubmit={event=>{
        event.preventDefault();
        const values=new FormData(event.currentTarget);
        const get=(name:string)=>String(values.get(name)??"");
        const result=requestLetter({type,institution,person,affiliation,recipient:get("recipient"),
          firstDate:get("from"),lastDate:get("through"),reason:get("reason")});
        if(!result){setError("Check the recipient, purpose and dates. The end date cannot be earlier than the start date.");return;}
        setDraft(result);setError("");
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
    {draft ? <PreparedMessage title="Your letter draft" buttonLabel="Copy letter" messageLabel="Letter text" previewOpen
      message={draft} description="Review the recipient and dates before sharing. Nothing has been submitted or approved."/> :
      <section className="panel"><h2>Preview</h2><p className="meta">Your copy-ready letter will appear here after you generate a draft.</p></section>}
  </div>;
}
