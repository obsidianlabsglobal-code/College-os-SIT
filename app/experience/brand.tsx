export function Brand() {
  return <span className="brand-lockup">
    <svg aria-hidden="true" viewBox="0 0 40 40" width="36" height="36" className="brand-mark">
      <circle cx="20" cy="20" r="10" fill="none" stroke="currentColor" strokeWidth="1.5"/>
      <ellipse cx="20" cy="20" rx="16" ry="6" transform="rotate(-47 20 20)" fill="none" stroke="currentColor" strokeWidth="1.8"/>
    </svg>
    <span>NEXUS<small>College OS</small></span>
  </span>;
}
