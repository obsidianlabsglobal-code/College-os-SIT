"use client";

import { useRef, useState } from "react";
import styles from "./prepared-message.module.css";

export function PreparedMessage({ title,description,buttonLabel,message,messageLabel="Message",previewOpen=false }:{
  title:string;description:string;buttonLabel:string;message:string;messageLabel?:string;previewOpen?:boolean;
}) {
  const [status,setStatus] = useState("");
  const details=useRef<HTMLDetailsElement>(null);
  const content=useRef<HTMLTextAreaElement>(null);
  async function copy(){
    try {
      await navigator.clipboard.writeText(message);
      setStatus("Copied. Nothing has been sent.");
    } catch {
      if(details.current) details.current.open=true;
      content.current?.focus();
      content.current?.select();
      setStatus("Clipboard unavailable. Copy the selected draft manually.");
    }
  }
  return <section className={styles.card} aria-label={title}>
    <div><h3>{title}</h3><p className="meta">{description}</p></div>
    <div><button type="button" className="button secondary" onClick={copy}>{buttonLabel}</button></div>
    <details ref={details} open={previewOpen}><summary>Preview message</summary>
      <label>{messageLabel}<textarea readOnly ref={content} value={message} rows={7}/></label>
    </details>
    <p className={styles.status} role="status">{status}</p>
  </section>;
}
