# Academic day browser evidence

The production build ran against a local PostgreSQL database with fictional accounts. The browser journey published a future and past class, opened the student's next class by keyboard, recorded and corrected attendance as faculty, then read the saved mark and tried a scenario as the student. The screenshots show the student's timetable and attendance after correction.

[360 px](timetable-360.webp) · [390 px](timetable-390.webp) · [768 px](timetable-768.webp) · [1024 px](timetable-1024.webp) · [1440 px](timetable-1440.webp)

The browser test checks the document width at all five sizes with reduced motion enabled. Manual screen-reader testing and institutional-scale benchmarks are open. The fixture and related attendance records are removed after the browser journey. To reproduce on local fictional data, run `npx playwright test tests/academic-day.e2e.ts` with `NEXUS_ACADEMIC_SCREENSHOTS` set to a writable directory.

The workspace URL is `/timetable?institution=<institution-id>&role=<active-role>`. A session link adds the saved date and session ID. The test verifies that a student from another section and a forged faculty workspace receive 404.
