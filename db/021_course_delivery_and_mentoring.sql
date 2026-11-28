-- SA-018 / FC-020: versioned course materials. Each upload is a new immutable version; students read the latest.
CREATE TABLE course_resource (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  created_by text NOT NULL REFERENCES "user",
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  withdrawn_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,offering_id) REFERENCES offering
);
CREATE TABLE course_resource_version (
  institution_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  filename text NOT NULL,
  mime text NOT NULL CHECK (mime IN ('text/plain','application/pdf')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 5242880),
  note text CHECK (note IS NULL OR length(note) <= 500),
  uploaded_by text NOT NULL REFERENCES "user",
  uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,resource_id,version),
  FOREIGN KEY (institution_id,resource_id) REFERENCES course_resource
);
CREATE INDEX course_resource_offering ON course_resource (institution_id,offering_id);

-- FC-006 / DH-005 / DH-011 / DH-022: a teacher drafts the course plan, the department head approves or returns it
-- with a reason, and each recorded class logs which plan topic it delivered.
CREATE TABLE course_plan (
  institution_id uuid NOT NULL,
  offering_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','approved','returned')),
  submitted_by text REFERENCES "user",
  decided_by text REFERENCES "user",
  decided_at timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 1 AND 500),
  PRIMARY KEY (institution_id,offering_id),
  FOREIGN KEY (institution_id,offering_id) REFERENCES offering,
  CHECK ((state IN ('approved','returned')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL))
);
CREATE TABLE course_plan_item (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 500),
  topic text NOT NULL CHECK (length(btrim(topic)) BETWEEN 1 AND 200),
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,offering_id,sequence),
  FOREIGN KEY (institution_id,offering_id) REFERENCES course_plan
);
CREATE TABLE class_delivery (
  institution_id uuid NOT NULL,
  session_id uuid NOT NULL,
  plan_item_id uuid,
  summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 1000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  recorded_by text NOT NULL REFERENCES "user",
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,session_id),
  FOREIGN KEY (institution_id,session_id) REFERENCES class_session,
  FOREIGN KEY (institution_id,plan_item_id) REFERENCES course_plan_item
);

-- FC-016: an administrator assigns a faculty mentor; the mentor records goals and follow-ups the student can read and agree to.
CREATE TABLE mentor_assignment (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  mentor_id text NOT NULL REFERENCES "user",
  student_id text NOT NULL REFERENCES "user",
  assigned_by text NOT NULL REFERENCES "user",
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  PRIMARY KEY (institution_id,id),
  CHECK (mentor_id <> student_id)
);
CREATE UNIQUE INDEX mentor_assignment_active ON mentor_assignment (institution_id,student_id) WHERE ended_at IS NULL;
CREATE TABLE mentoring_record (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('goal','followup')),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  created_by text NOT NULL REFERENCES "user",
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  agreed_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,assignment_id) REFERENCES mentor_assignment,
  CHECK (kind = 'goal' OR agreed_at IS NULL)
);

GRANT SELECT, INSERT ON course_resource, course_resource_version, course_plan, course_plan_item, class_delivery,
  mentor_assignment, mentoring_record TO nexus_app;
GRANT UPDATE (withdrawn_at) ON course_resource TO nexus_app;
GRANT UPDATE (revision,state,submitted_by,decided_by,decided_at,decision_reason) ON course_plan TO nexus_app;
GRANT DELETE ON course_plan_item TO nexus_app;
GRANT UPDATE (plan_item_id,summary,revision,recorded_by,recorded_at) ON class_delivery TO nexus_app;
GRANT UPDATE (ended_at) ON mentor_assignment TO nexus_app;
GRANT UPDATE (agreed_at) ON mentoring_record TO nexus_app;
