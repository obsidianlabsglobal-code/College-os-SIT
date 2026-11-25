# Release 1 design audit

Baseline e5d507d. The November 22 browser audit captured all five roles. The shared header provided sign-out and a brand link. Workspace navigation appeared on home and context was carried in each subpage link. The role heading used a large serif scale, admin home had links with no operational detail, and navigational labels competed with page content. The narrow request page fit its 390 px viewport. The HOD table used local horizontal scrolling. The shared form already gave pending, success and failure feedback and disabled fields until hydration.

Keep role and permission behavior, native controls, semantic headings, assignment details and the keyboard skip link. Put navigation in one shared shell, make headings compact, and apply consistent semantic surface and focus tokens. Add information hierarchy through real task data in a subsequent dashboard pass.

## Living Atmosphere review of 88609cf

The production build showed five working workspaces. Student Today surfaced assignments but isolated timetable and attendance context. The shell lacked a persisted appearance selection. Mobile secondary links competed for space. Administrative access forms provided little opportunity to review the selected account. Existing production routes already supplied the required domain records.

The design branch adds a scoped timetable and assignment priority, a native mobile menu, contextual direct AURA reads, theme preferences and a confirmation step for access changes. Initial screenshots exposed narrow-screen overflow. Browser checks also exposed a focus issue on the AURA receipt. Both received corrections and repeat verification. The [capture set](evidence/living-atmosphere/README.md) records the baseline, changes and outstanding review.
