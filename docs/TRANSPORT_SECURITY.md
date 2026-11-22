# Campus Transport security proposal

Use existing session and tenant checks plus explicit transport grants for administration and operation. Students receive current trip views only for eligible routes. Operators act only on assigned active trips and never receive passenger lists. On every write, recheck tenant, grant, trip state and binding. Keep privileged operator identity off student reads and apply equivalent scope to map and text data.

Ingestion is server-to-server over TLS using individually revocable device or connector credentials held outside browser code. Verify binding and event identity before accepting writes. Bound input sizes, timestamps and rate. Idempotently handle duplicate events. Out-of-order samples cannot replace the latest observation or advance route progress. Reject invalid coordinates and quarantine implausible jumps. Close tracking at terminal state and on device revocation.

Before live operation, the institution must authorize routes, devices and operators and approve access and retention policy. Store location only during the approved trip window. Keep raw history access operationally restricted and record retention and deletion tests. Simulated and live feeds are separate trust modes. No real tracking agent, device endpoint, public history or live route access exists in this branch.
