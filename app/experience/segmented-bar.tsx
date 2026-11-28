import styles from "./segmented-bar.module.css";
import { segmentWidths, type Segment } from "../../lib/segments";

/** Parts of a bounded whole (Design Bible chart contract): exact counts in the legend, colour never the only cue. */
export function SegmentedBar({ parts, total, label, rest }: { parts: Segment[]; total: number; label: string; rest?: string }) {
  const widths = segmentWidths(parts, total);
  const remaining = total - parts.reduce((s, p) => s + p.value, 0);
  const summary = parts.map(p => `${p.value} ${p.label}`).concat(rest && remaining > 0 ? [`${remaining} ${rest}`] : []).join(", ");
  return <figure className={styles.chart}>
    <div className={styles.bar} role="img" aria-label={`${label}: ${summary} of ${total}`}>
      {parts.map((p, i) => widths[i] > 0 && <span key={p.label} data-tone={p.tone} style={{ width: `${widths[i]}%` }} title={`${p.label}: ${p.value} of ${total}`} />)}
    </div>
    <figcaption aria-hidden="true">
      {parts.filter(p => p.value > 0).map(p => <span key={p.label} data-tone={p.tone}>{p.value} {p.label}</span>)}
      {rest && remaining > 0 && <span data-tone="rest">{remaining} {rest}</span>}
    </figcaption>
  </figure>;
}
