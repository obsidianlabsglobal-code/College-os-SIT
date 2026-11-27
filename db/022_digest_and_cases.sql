-- AD-024: a weekly operations digest written by the worker on schedule, for the previous full local week.
CREATE TABLE operations_digest (
  institution_id uuid REFERENCES institution NOT NULL,
  period_start date NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  metrics jsonb NOT NULL,
  PRIMARY KEY (institution_id,period_start)
);
GRANT SELECT, INSERT ON operations_digest TO nexus_app;  -- local and test runs call the worker loop as the app role
GRANT SELECT, INSERT ON operations_digest TO nexus_worker;

-- AD-020 slice: one case record with shared ownership, transitions and audit, used by two kinds.
--   support   (DH-014, FC-015): staff coordinate academic support for a student in a department.
--   grievance (AD-017): a student's confidential complaint handled by the administrative office.
CREATE TABLE case_record (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('support','grievance')),
  subject_id text NOT NULL REFERENCES "user",
  department_id uuid,
  opened_by text NOT NULL REFERENCES "user",
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','in_progress','resolved','declined')),
  assigned_to text REFERENCES "user",
  assigned_at timestamptz,
  outcome text CHECK (outcome IS NULL OR length(btrim(outcome)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,department_id) REFERENCES department,
  CHECK ((kind='support') = (department_id IS NOT NULL)),
  CHECK ((assigned_to IS NULL) = (assigned_at IS NULL)),
  CHECK ((state IN ('resolved','declined')) = (closed_at IS NOT NULL AND outcome IS NOT NULL)),
  CHECK (state='open' OR assigned_to IS NOT NULL)
);
CREATE INDEX case_record_queue ON case_record (institution_id,kind,state,created_at);
CREATE TABLE case_note (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  author_id text NOT NULL REFERENCES "user",
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,case_id) REFERENCES case_record
);
GRANT SELECT, INSERT ON case_record, case_note TO nexus_app;
GRANT UPDATE (state,assigned_to,assigned_at,outcome,closed_at,revision) ON case_record TO nexus_app;
GRANT SELECT ON case_record TO nexus_worker;

ALTER TABLE automation_rule DROP CONSTRAINT automation_rule_workflow_check,
  ADD CONSTRAINT automation_rule_workflow_check CHECK (workflow IN ('attendance','assignments','results','requests','timetable','cases'));
INSERT INTO automation_rule (key,event_type,title,authority,workflow) VALUES
  ('case-assigned-notify','case.assigned','Tell the staff member a case has been assigned to them','L3','cases'),
  ('case-closed-notify','case.closed','Tell the person who opened a case that it has been closed','L3','cases');
