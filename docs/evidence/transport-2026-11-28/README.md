# Transport verification, 28 November 2026

Base `a7316dd34e150c44b5ff5d39f49e8d71ab621442`. All testing used local PostgreSQL and fictional data, not real GPS or institution records.

## Full run and targeted evidence

| Evidence | Observed result |
| --- | --- |
| Fresh migrations on full-run code `2e1b0e1`, twice | 53 applied; second run no-op (includes 055–067) |
| Seed, lint, typecheck, production build on `2e1b0e1` | Passed |
| Node/PostgreSQL full suite on `2e1b0e1` | 174 passed |
| Default browser suite on `2e1b0e1` | 56 passed, 11 skipped, 3 failed |
| Synthetic transport browser suite, at 390 px on `2e1b0e1` | 2 passed, no horizontal overflow. Explicit simulation flag enabled for the otherwise skipped boarding case |
| Tutor fixture on `2e1b0e1` | 1 passed |
| Direct stock-form endpoint in the `2e1b0e1` production build | Loopback receipt and persistence, no active-trip writes, duplicate ACK, default knots conversion, missing/revoked binding denial |
| Current targeted transport suite on `932c7ec` | 20 passed; migrations twice and baseline seed passed |
| Direct parked-driver endpoint in the `932c7ec` production build | Loopback: denies inactive, unbound, missing or moving readings; permits two fresh stopped readings; coalesces repeat |
| Separate fictional loader `de22e14` | 2 successful runs; verified 4 routes, 20 stops, 4 vehicles, 3 drivers, 10 choices, 4 simulated trips |

The default browser failures were the known narrow timetable overflow (323 px at a 320 px viewport), an assignment message returning unread on reload (also observed on an earlier audit head), and the shared `app/chrome.tsx` insertion displacing Evaluation queue on the faculty mobile dock when Transport exists. The owner's correction forbids editing Chrome. The latter behavior and the required integration remedy are documented in the ledger. Do not describe this as a green repository run.

The QR browser test confirms the **display** and the signed payload submitted by paste. A real camera scan on Android, HTTPS deployment, actual device tracking, removal schedules, phone delivery and institutional approval were not tested.

## Actual 390 px browser captures

- [First-run picker](transport-first-run-picker-390.png)
- [Saved bus and stop after reload](transport-choice-390.png)
- [Fictional device screen](transport-boarding-screen-390.png)
- [Fictional rider boarding and estimated seat count](transport-rider-boarded-390.png)

[Local transport handoff and outstanding integration requirements](../../TRANSPORT_LOCAL_HANDOFF.md).


## Scheduled maintenance follow-up (migration 068)

On a fresh loopback PostgreSQL database with fictional records: 54 migrations applied, repeat applied none, and the seed completed. The real one-shot CLI connected with the restricted worker login and reported zero work on a clean database. The focused transport suite passed **20/20**, including the real database function deleting an expired fix while preserving a recent latest fix, concurrent warning invocations creating one office message only, no early or repeat warnings, app role denied scheduler execution, and worker role denied reading raw coordinates. This is not evidence of a hosted schedule or delivery to a physical handset.
