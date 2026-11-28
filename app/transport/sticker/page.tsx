"use client";
import {useState} from "react";
import {BoardingQr} from "../board/qr";
export default function StickerPreview() {
  const [code,setCode]=useState("");
  const valid=/^b1\.[A-Za-z0-9_-]{43}$/.test(code.trim());
  return <main className="panel stack" style={{margin:"1rem auto",maxWidth:"480px"}}>
    <h1>Print a bus boarding sticker</h1><p>Paste the new opaque sticker code issued by the transport office. Old stickers stop working when a code is reissued.</p>
    <label>New sticker code<input value={code} autoComplete="off" maxLength={46} onChange={e=>setCode(e.target.value)}/></label>
    {valid&&<><BoardingQr code={code.trim()} label="Vehicle boarding sticker"/><button type="button" className="button secondary" onClick={()=>window.print()}>Print this sticker</button></>}
  </main>;
}
