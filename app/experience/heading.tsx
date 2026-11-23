import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./heading.module.css";

export function ExperienceHeading({title, context, parent}:{
  title:string; context?:ReactNode; parent?:{href:string;label:string};
}) {
  return <header className={styles.heading}>
    {parent && <nav aria-label="Breadcrumb"><Link href={parent.href}>{parent.label}</Link></nav>}
    <h1>{title}</h1>
    {context && <p>{context}</p>}
  </header>;
}

export function ExperienceStatus({children, tone}:{
  children:ReactNode; tone:"attention"|"complete"|"neutral";
}) {
  return <span className={`tag ${styles.status}`} data-tone={tone}>{children}</span>;
}
