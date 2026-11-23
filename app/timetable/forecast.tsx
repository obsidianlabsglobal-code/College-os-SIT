"use client";

import { useState } from "react";
import styles from "./timetable.module.css";

export function AttendanceForecast({present,recorded}:{present:number;recorded:number}) {
  const [future,setFuture] = useState("5");
  const [expected,setExpected] = useState("5");
  const total=Number(future), attending=Number(expected);
  const valid= future!=="" && expected!=="" && Number.isInteger(total) && Number.isInteger(attending)
    && total>=0 && total<=100 && attending>=0 && attending<=total;
  return <details className={styles.forecast}>
    <summary>Try an attendance scenario</summary>
    <div className="row">
      <label>Future recorded classes<input type="number" min={0} max={100} value={future}
        onChange={event=>setFuture(event.target.value)} /></label>
      <label>Classes you would attend<input type="number" min={0} max={100} value={expected}
        onChange={event=>setExpected(event.target.value)} /></label>
    </div>
    <p className="meta" role="status">{valid
      ? `Projected ${((present+attending)*100/(recorded+total)).toFixed(1)}% · ${present+attending} of ${recorded+total} classes`
      : "Enter whole numbers. Classes attended must be between zero and the number of future classes."}</p>
  </details>;
}
