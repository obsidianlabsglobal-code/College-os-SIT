# Living Atmosphere browser evidence

The production application was captured with fictional institutional records. The comparison baseline was main at `88609cf`. The candidate source was `57669bf`, which includes main through PR #13.

| Evidence | What it covers |
| --- | --- |
| [Desktop overview](desktop.webp) · [Mobile overview](mobile.webp) | Five authenticated workspaces, AURA, timetable, CLUBVERSE and Opportunities |
| [Student before](student-before.webp) · [Student after](student-delivery.webp) | 1440 px Student Today comparison |
| [Full viewport archive](viewports.zip) | 20 baseline captures and 72 candidate captures with the raw measurement JSON |
| [Capture script](../../../scripts/capture-atmosphere.ts) | Reproduction against a loopback production build with seeded fictional role accounts |

Light-mode captures span widths of 320, 390, 768, 1024, 1440 and 1920 px. Dark-mode captures use 390 and 1440 px. Capture runs emulate reduced motion. The capture script checks one main heading, page-level horizontal overflow, and browser exceptions. Long HOD reports scroll inside a focusable table region on narrow screens. A separate check confirmed that a long Kannada service request and an unbroken 180-character string persisted after reload and fit a 320 px page with Noto Sans Kannada supplying glyphs in Chromium.

Local automated checks cover the role and resource permissions, exact records after navigation, published-result visibility, private files, mobile More, theme persistence, Escape and focus restoration, the AURA lookup receipt, and administrator access confirmation. The tutor provider contract runs against a local test endpoint. See [test report](../../TEST_REPORT.md) for executed gates.

Lab measurements describe a local production build at the time of capture. Field Core Web Vitals, manual screen-reader and real-device testing, the four independent sign-offs, and hosted acceptance remain open. The supplied design references for Learning Studio, campus exploration and live transport did not change those capabilities' implementation status.
