# Campus Transport test plan

Status: proposed. Use fixed clocks, fictional vehicles and small known routes. Separate simulated coverage from any later authorized feed and hosted evidence.

- Verify eligible student access and another-route and tenant denials. Cover expired grants, unrelated operators, device revocation, and grants changing during a write.
- Create route, stops, schedule, trip and vehicle assignments. Exercise start, pause, delay, complete, cancel and versioned route changes. Assert audit coverage and alert effective/expiry times.
- Ingest valid, invalid, duplicate and out-of-order samples. Exercise source clock skew, impossible coordinates and jumps, disconnect, staleness, and database failure. Verify the last valid point remains stable.
- Test known route progress, passed stops, ambiguous geometry, missing data, and deadline/terminal cases for ETA. Check the same projections in text and map views.
- Test unknown counts, observed and corrected counts, capacity overflow, and staleness. Verify no student-facing passenger identities and no inferred seat counts without evidence.
- Exercise mobile layout, keyboard flow, reduced motion, empty/error states and reconnection. Record hosted latency, ETA error and availability using authorized operation only.
