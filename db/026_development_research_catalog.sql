-- FC-025 / DH-016: a teacher records a development activity with evidence; an HOD of a department they teach in verifies or
-- returns it with a reason.
CREATE TABLE development_record (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  faculty_id text NOT NULL REFERENCES "user",
  department_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  completed_on date NOT NULL,
  hours numeric(5,1) NOT NULL CHECK (hours > 0 AND hours <= 500),
  evidence text NOT NULL CHECK (length(btrim(evidence)) BETWEEN 1 AND 1000),
  state text NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted','verified','returned')),
  decided_by text REFERENCES "user",
  decided_at timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,department_id) REFERENCES department,
  CHECK ((state = 'submitted') = (decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL))
);
GRANT SELECT, INSERT ON development_record TO nexus_app;
GRANT UPDATE (state,decided_by,decided_at,decision_reason) ON development_record TO nexus_app;

-- DH-017 / FC-021 / LE-012: departmental research projects proposed by a teacher, approved by the HOD, with dated milestones.
CREATE TABLE research_project (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL,
  lead_id text NOT NULL REFERENCES "user",
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 2000),
  state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','approved','returned','completed')),
  disclosure text NOT NULL DEFAULT 'department' CHECK (disclosure IN ('department','institution')),
  decided_by text REFERENCES "user",
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,department_id) REFERENCES department
);
CREATE TABLE research_milestone (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  due_on date NOT NULL,
  done_at timestamptz,
  evidence text CHECK (evidence IS NULL OR length(btrim(evidence)) BETWEEN 1 AND 1000),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,project_id) REFERENCES research_project,
  CHECK ((done_at IS NULL) = (evidence IS NULL))
);
GRANT SELECT, INSERT ON research_project, research_milestone TO nexus_app;
GRANT UPDATE (state,disclosure,decided_by,decision_reason) ON research_project TO nexus_app;
GRANT UPDATE (done_at,evidence) ON research_milestone TO nexus_app;

-- AD-008 slice: course and section name corrections keep their history and reason.
CREATE TABLE catalog_name_change (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity text NOT NULL CHECK (entity IN ('course','section')),
  entity_id uuid NOT NULL,
  old_name text NOT NULL,
  new_name text NOT NULL CHECK (length(btrim(new_name)) BETWEEN 1 AND 160),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  changed_by text NOT NULL REFERENCES "user",
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id)
);
GRANT SELECT, INSERT ON catalog_name_change TO nexus_app;
GRANT UPDATE (name) ON course, section TO nexus_app;
