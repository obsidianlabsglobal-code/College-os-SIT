"use client";

import { useId, useState, type ReactNode } from "react";
import styles from "./home.module.css";

export function StudentHomeFocus({heading, timetableHref, children}: {
  heading: ReactNode;
  timetableHref: string;
  children: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const region = useId();

  return <div className={styles.home} data-focus={focused ? "on" : "off"}>
    <header className={styles.intro}>
      <div>{heading}</div>
      <div className={styles.introActions}>
        <button type="button" className={styles.focusButton} aria-pressed={focused} aria-controls={region}
          onClick={() => setFocused(previous => !previous)}>Focus mode</button>
        <a href={timetableHref} className={styles.primary}>My timetable</a>
      </div>
      <p role="status" className={styles.announcer}>
        {focused ? "Focus mode on. Showing priority, assignments and courses." : ""}
      </p>
    </header>
    <div id={region} className={styles.dashboard}>{children}</div>
  </div>;
}
