-- SA-021: a student challenges their own latest attendance mark; the class's teacher records a reasoned decision.
-- Acceptance writes a new attendance revision in the same transaction, so the record and the decision cannot diverge.
CREATE TABLE attendance_correction (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  challenged_revision integer NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','declined')),
  decided_by text REFERENCES "user",
  decided_at timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,session_id,challenged_revision) REFERENCES class_attendance_revision,
  CHECK ((status='submitted') = (decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL))
);
CREATE UNIQUE INDEX attendance_correction_open ON attendance_correction (institution_id,session_id,student_id) WHERE status='submitted';
CREATE INDEX attendance_correction_student ON attendance_correction (institution_id,student_id,created_at DESC);
GRANT SELECT, INSERT ON attendance_correction TO nexus_app;
GRANT UPDATE (status,decided_by,decided_at,decision_reason) ON attendance_correction TO nexus_app;
GRANT SELECT ON attendance_correction TO nexus_worker;

INSERT INTO automation_rule (key,event_type,title,authority,workflow) VALUES
  ('attendance-correction-route','attendance_correction.requested','Tell the teacher a student has asked for an attendance correction','L3','attendance'),
  ('attendance-correction-decided','attendance_correction.decided','Tell the student the decision on their attendance correction','L3','attendance');
