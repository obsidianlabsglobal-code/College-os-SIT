import styles from "./progress-ring.module.css";

// Bounded ratio ring (Design Bible: progress ring shows exact counts and target; never a value without its denominator).
export function ProgressRing({ value, total, target, label, size = 112 }: {
  value: number; total: number; target?: number | null; label: string; size?: number;
}) {
  const r = 42, c = 2 * Math.PI * r;
  const ratio = total > 0 ? Math.min(1, value / total) : 0;
  const percent = total > 0 ? (100 * value / total).toFixed(1) : null;
  const met = percent !== null && target != null && 100 * value >= target * total;
  return <figure className={styles.ring} style={{ width: size }} data-met={met || undefined}>
    <svg viewBox="0 0 100 100" role="img" aria-label={percent === null ? `${label}: no records yet` : `${label}: ${value} of ${total}, ${percent}%${target != null ? `, target ${target}%` : ""}`}>
      <circle className={styles.track} cx="50" cy="50" r={r} />
      {total > 0 && <circle className={styles.value} cx="50" cy="50" r={r} strokeDasharray={`${ratio * c} ${c}`} transform="rotate(-90 50 50)" />}
      {target != null && <line className={styles.target} x1="50" y1="2" x2="50" y2="14" transform={`rotate(${target * 3.6} 50 50)`} />}
    </svg>
    <figcaption aria-hidden="true"><strong>{percent === null ? "—" : `${percent}%`}</strong><span>{total > 0 ? `${value}/${total}` : "No records"}</span></figcaption>
  </figure>;
}
