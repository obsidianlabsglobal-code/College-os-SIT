import styles from "./status-breakdown.module.css";

export type StatusSegment = {label:string;count:number;tone:"primary"|"attention"|"neutral"};

export function StatusBreakdown({label,segments}: {label:string;segments:readonly StatusSegment[]}) {
  const total = segments.reduce((n,segment)=>n+segment.count,0);
  return <figure className={styles.figure} aria-label={label}>
    {total>0 && <div className={styles.track} aria-hidden="true">
      {segments.filter(segment=>segment.count>0).map(segment=>
        <span key={segment.label} data-tone={segment.tone} style={{flexGrow:segment.count}} />)}
    </div>}
    <figcaption className={styles.legend}>{segments.map(segment=>
      <span key={segment.label}><i aria-hidden="true" data-tone={segment.tone}/><strong>{segment.count}</strong> {segment.label}</span>)}
    </figcaption>
  </figure>;
}
