const paths = {
  home: "M3 10 12 3l9 7v10h-6v-6H9v6H3z",
  book: "M12 6C9 4 6 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14",
  notice: "M4 9h5l10-5v15L9 14H4zm2 5 2 6h3l-2-6",
  people: "M14 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM3 20v-2a6 6 0 0 1 12 0v2m2-15a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5",
  service: "M3 7h6l2 2h10v11H3z",
  spark: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z",
  check: "M8 5H5v16h14V5h-3M9 3h6v4H9zm-1 11 3 3 5-6",
  chevron: "m9 5 7 7-7 7",
  calendar: "M3 6h18v15H3zm4-3v6m10-6v6M3 11h18",
} as const;

export function Icon({name}: {name:keyof typeof paths}) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
