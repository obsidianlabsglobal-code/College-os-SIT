"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { academicAssistant, type AssistantReply } from "../actions/academic-assistant";
import type { Scope } from "../../lib/scope";

export function AcademicPanel({workspace,topics,request}:{workspace:Pick<Scope,"institution"|"role">;topics:Record<string,string>;request:string}) {
  const [reply,action,pending]=useActionState<AssistantReply,FormData>(academicAssistant,{});
  const [requestId,setRequestId]=useState(request);
  const context=<><input type="hidden" name="institution" value={workspace.institution}/><input type="hidden" name="role" value={workspace.role}/></>;
  return <section className="panel stack" aria-labelledby="academic-assistant-title">
    <h2 id="academic-assistant-title">Topic tutor</h2>
    {Object.keys(topics).length>0 && <details>
      <summary>Study with Claude</summary>
      <form action={async data=>{action(data);setRequestId(crypto.randomUUID());}} className="form">{context}
        <input type="hidden" name="operation" value="tutor"/><input type="hidden" name="request" value={requestId}/>
        <label>Study topic<select name="topic">{Object.entries(topics).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <p className="meta">Send the selected topic to Anthropic for an example and practice question. Check generated explanations against course materials.</p>
        <button className="button" disabled={pending}>Generate explanation</button>
      </form>
    </details>}
    <div aria-live="polite" aria-busy={pending}>
      {pending ? <p>Preparing your answer…</p> : reply.error ? <p role="alert">{reply.error}</p> : reply.heading && <>
        <h3>{reply.heading}</h3>
        {reply.lines?.length ? <ul className="items">{reply.lines.map((line,i)=><li className="prose-text" key={i}>{line}</li>)}</ul> : <p>No matching records in your workspace.</p>}
        {reply.href && <Link href={reply.href}>Open source workspace</Link>}
      </>}
    </div>
  </section>;
}
