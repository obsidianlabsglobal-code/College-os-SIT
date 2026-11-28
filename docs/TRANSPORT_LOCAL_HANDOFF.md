# Transport local handoff (not a deployment)

## Release scope

The first-run page at `/transport?institution=<tenant>&role=student` requests route and pickup stop after approved sign-in. Sign-up need not collect either. Only an active student in a switched-on department can choose; office can lock a full route. Starting a trip snapshots its eligible riders, stops, route version and seats, so changes thereafter apply only to a future trip. All departments are supported by policy; the library fixtures are not actual SIT routes.

Transport office configures routes, stops, vehicles, service schedules, dated trips, device bindings, notices, boarding credentials, the named SOS teacher, reporting, maintenance and fee status. Student views use explicit scheduled/no-signal/simulated/active labels. This code does not authorize tracking or change actual attendance.

| Area | Scope of the implementation |
| --- | --- |
| TO-001/002/003/006, TR-001/003/007 | Office catalog and dated service, section/department consent gate and first-run choice, current-trip snapshot |
| TO-005, TR-008/010, TO-017 | Revocable separate GPS device tokens, documented OsmAnd form decoder, ordering, trip authorization, quarantine, rate limit, seven-day purge and separated synthetic feed. Unvalidated on a real phone or deployment. |
| TR-009/011/013/015, TO-018 | Timeline, stale fallback, estimated delay and text alternative; optional street tiles, no map vendor calls in the synthetic flow. ETA is a schedule-relative approximation, not field-calibrated. |
| TR-018/019/020/021/022/025, TO-012/020 | In-app language receipts, verified parked-only driver inputs, updates, named-stop replacement, overdue scan and displayed warning, accident check-in. Delivery/compatibility outside the local fixture is not verified. |
| TR-006, TO-009, TR-016/017 | Independent revocable display credential, signed trip QR, rotatable printed fallback, no rider location for boarding, own history, restricted manifest, approximation from check-ins. Walk-up phone camera hardware still needs a rehearsal. |
| TR-026 | Authorized onboard SOS to college staff and the named teacher through the in-app queue. It is not an emergency-services dispatch system. SIT emergency channel wording still requires approval. |
| TO-013 | Scoped maintenance/clearance records and aggregate incident patterns. This is not a fleet safety certification. |
| Operator-only controls | Boarding-based aggregate insights, staff-entered fee status with no payments, oversight speed signals disabled unless separately approved. |
| Deferred | Parent view is design-only. Bus pass/validity is not added pre-merge. No attendance engine changes; the 5b integration contract is in the ledger. |

## Integration and acceptance gates

- The 036 navigation currently pushes Transport into the faculty mobile dock when the page exists, displacing Evaluation queue. The transport branch leaves Chrome untouched as requested and logs the action needed. Independent first-run browser evidence is retained at 390 px. Sign-up redirect itself belongs to `cc/pilot-access`.
- Bus-delay excuses and teacher/mentor effects are not written here. An integration-owned attendance service is required, preserving teacher override, exact trip/day/period and authoritative absence semantics.
- Migration 068 and `node --import tsx scripts/transport-maintenance.ts` allow a scheduler to purge raw positions over 168 hours old and queue missed-promise warnings without opening the office page. No schedule has been hosted. Integration should run it once per minute in the approved pilot environment with `WORKER_DATABASE_URL` and its approved target, alert on nonzero exits or sustained backlog, and set the retention cadence to SIT’s accepted deletion grace window. Runs return aggregate counts only. They are bounded to 10,000 old fixes and 1,000 missed notices per invocation, retryable, and do not need app or migration credentials. Warnings are in-app; handset delivery still needs separate verification.
- Stock client adapter: [Traccar OsmAnd documentation](https://www.traccar.org/osmand/) and [SDK uploader at e56ca08](https://github.com/traccar/traccar-client-sdk/blob/e56ca0840656e785629d7d3d2b0b275a6c110489/core/src/commonMain/kotlin/org/traccar/client/HttpUploader.kt) support form POST with epoch seconds and knots. For stock mode the generated high-entropy Device identifier itself is treated as a credential only in the POST body; do not log it. SDK mode uses a separate Bearer token plus the configured ID. Cap request body and never reuse a telemetry credential for the boarding screen. Verify on the actual Android build at the approval gate. No actual SIT handset was used.
- Optional external public raster tiles must meet the [OSMF policy](https://operations.osmfoundation.org/policies/tiles/), including visible attribution and normal caches. The app selects tiles only on the visible live map explicitly opened by a rider, with origin-only referrer; simulated and unconfigured views use a schematic.
- QR renderer is vendored from [Project Nayuki](https://github.com/nayuki/QR-Code-generator/tree/9a217d443937f60cc56c1458c39a211d7f2d3af5/typescript-javascript) under the retained MIT notice. No provider receives QR payloads. Browser camera use is explicit, local, and optional when native QR detection exists. Paste is the fallback.

## Fictional EEE loader

After migrating and applying the baseline fictional seed in an isolated loopback database, run `NEXUS_TRANSPORT_DEMO_SEED=1 node --import tsx lib/transport/seed-demo.ts`. It stages four simulated service routes, twenty ordered timed stops, four vehicles, three non-login driver records and ten rider choices. The baseline fictional student can sign in and uses the first selected stop. This is not part of normal test seeding or any real SIT catalog.

## Flag boundaries

Keep live, push, tiles, rider backup and speed approval off until separately authorized. The relevant flags are `NEXUS_TRANSPORT_LIVE_ENABLED`, `NEXUS_TRANSPORT_PUSH_ENABLED`, `NEXUS_TRANSPORT_TILES_ENABLED`, `NEXUS_TRANSPORT_RIDER_BACKUP_ENABLED` and `NEXUS_TRANSPORT_OVERSPEED_APPROVED`. `NEXUS_TRANSPORT_BOARDING_SECRET` is server-only and kept out of Git. `NEXUS_TRANSPORT_LOCAL_TEST=1` is loopback-only; enable it and `NEXUS_TRANSPORT_SIMULATION_ENABLED=true` only in a fictional local test environment. Do not use the synthetic fleet or test secrets in a real pilot.

Update the college privacy notice before activating optional phone backup; it otherwise correctly says only the bus is tracked. Make no claim about active SIT buses, capacity, alert delivery, field accuracy, college sign-off or deployment from these tests.
