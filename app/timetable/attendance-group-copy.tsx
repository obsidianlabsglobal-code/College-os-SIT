"use client";

import { useRef, useState } from "react";
import styles from "./attendance-form.module.css";

export function AttendanceGroupCopy({draft,fictionalPractice}:{draft:string;fictionalPractice:boolean}) {
  const [status,setStatus] = useState("");
  const details=useRef<HTMLDetailsElement>(null);
  const content=useRef<HTMLTextAreaElement>(null);
  async function copy(){
    try {
      await navigator.clipboard.writeText(draft);
      setStatus("Copied. Nothing has been sent.");
    } catch {
      if(details.current) details.current.open=true;
      content.current?.focus();
      content.current?.select();
      setStatus("Clipboard unavailable. Copy the selected draft manually.");
    }
  }
  return <section className={styles.groupCopy} aria-label="Official WhatsApp group draft">
    <div>
      <h3>Official WhatsApp group update</h3>
      <p className="meta">{fictionalPractice ? "Fictional named-absence preview. Do not post this example." :
        "Uses the last saved record. Includes totals only. Check the authorized group before pasting."}</p>
    </div>
    <div><button type="button" className="button secondary" onClick={copy}>Copy WhatsApp update</button></div>
    <details ref={details}><summary>Preview message</summary>
      <label>WhatsApp message<textarea readOnly ref={content} value={draft} rows={fictionalPractice ? 9 : 6}/></label>
    </details>
    <p role="status">{status}</p>
  </section>;
}
