# AURA approval model

Policy is deterministic. Authority 0 reads authorized data. Authority 1 prepares previews. Authority 2 performs a validated and bound write after an authorized confirmation. Future authority 3 requires narrow, reversible delegated policy. Grades, disciplinary decisions, finance, credentials and high-impact access changes stay with human and institutional processes.

The available Event Planner prepares a timed immutable preview, awaiting task-owner confirmation in the same active workspace. Confirmation locks the task and rechecks the organizer grant, club state, schema and valid future event schedule before saving. A replay of a successful confirmation returns the existing draft reference while scope remains valid. Cancellation records a terminal decision without writing an event. A transaction failure leaves the task outcome unchanged so the user can refresh and verify.
