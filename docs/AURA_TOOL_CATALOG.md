# AURA tool catalog

- `prepare_event_plan` validates event inputs, checks active institution and organizer scope, and records a preview with zero event writes.
- `create_event_draft` accepts the stored typed payload only after owner confirmation. It rechecks scope and calls the existing `saveEventDraft` domain operation. It returns the durable event reference. Publishing, approving, registering attendees and sending external communications are outside these tools.

Inputs and outputs use the shared event schema. The actor, institution, and role come from the session. Typed text is treated as content. Task tool records keep tool ID, sequence and elapsed time, plus zero model calls and cost for this mode. There is no provider usage or model evaluation evidence.
