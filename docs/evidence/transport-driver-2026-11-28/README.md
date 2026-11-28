# 5c Driver and iPhone boarding evidence · 28 November 2026

Fictional, loopback PostgreSQL data; no SIT device, record, service or real emergency contact used. Runtime source tree `59ba98204666bbdf8bd5c46a7fb534cc88035b86` (the evidence-only commit changes no runtime files).

| Check | Observed outcome |
| --- | --- |
| Fresh PostgreSQL migrations, repeat, and seed | 55 migrations applied, second run applied zero; fictional seed passed |
| Lint, TypeScript, production build | Passed |
| Node/PostgreSQL | 175 passed; focused transport suite 21 passed |
| Opt-in Chromium | 3 passed: route and stop, simulated boarding, driver enrollment and offline checklist replay/controls lock/visible written speech fallback |
| Opt-in WebKit | 1 passed at 390 × 844. Native detector disabled, permission denial preserves manual entry, deterministic video frame contains the genuine generated signed QR, and the JS decoder populates it without paste. The server accepted boarding, and the camera fixture's track was stopped. |
| Default Chromium | 57 passed, 13 skipped, 2 failed: 320 px timetable measured 323 px; faculty Evaluation queue missing from the shared navigation. Both were reproduced before 5c. |
| Separate mock tutor browser suite | 1 passed |

The service suite also exercised phone/revoked access, backup identity, wrong bus/tenant/role, trip start/end with simulated live telemetry fixtures, the 90-second warning and recovery, parked report and message acknowledgement, replay receipts, reminder deduplication, driver's own records and approved swap request.

## Screenshots from the running app

- [Driver ready, Chromium at 390 px](driver-ready-390.png)
- [Driver lock while motion is unverified, Chromium at 1366 × 768](driver-locked-1366.png)
- [WebKit recognized a genuine generated QR and boarding was persisted](iphone-webkit-qr-boarding-390.png) (full-height capture at a 390 × 844 logical viewport; downsampled from device pixel scale for the repository)

No claim of physical iPhone camera, installed Android behavior, closed-app notification delivery, actual bus operation, or institutional authorization. The 5b attendance integration and item 13 merge gate are unchanged.
