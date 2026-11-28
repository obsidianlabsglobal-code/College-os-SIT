-- DH-012 / DH-013: programme outcomes defined by the office; course outcomes proposed by a course's teacher with their programme
-- outcome mapping, and approved or returned by the department head. Approved outcomes are fixed; a change is a new outcome.
CREATE TABLE programme_outcome (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^PS?O[0-9]{1,2}$'),
  statement text NOT NULL CHECK (length(btrim(statement)) BETWEEN 1 AND 500),
  created_by text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,code)
);
CREATE TABLE course_outcome (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^CO[0-9]{1,2}$'),
  statement text NOT NULL CHECK (length(btrim(statement)) BETWEEN 1 AND 500),
  state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','approved','returned')),
  proposed_by text NOT NULL REFERENCES "user",
  decided_by text REFERENCES "user",
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 500),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,course_id) REFERENCES course,
  CHECK ((state = 'proposed') = (decided_by IS NULL AND reason IS NULL))
);
CREATE UNIQUE INDEX course_outcome_live_code ON course_outcome (institution_id,course_id,code) WHERE state <> 'returned';
CREATE TABLE outcome_mapping (
  institution_id uuid NOT NULL,
  course_outcome_id uuid NOT NULL,
  programme_outcome_id uuid NOT NULL,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  PRIMARY KEY (institution_id,course_outcome_id,programme_outcome_id),
  FOREIGN KEY (institution_id,course_outcome_id) REFERENCES course_outcome,
  FOREIGN KEY (institution_id,programme_outcome_id) REFERENCES programme_outcome
);
-- FC-014 / SA-019: a teacher of the offering tags an assessment with the approved course outcomes it measures.
CREATE TABLE assessment_outcome (
  institution_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  course_outcome_id uuid NOT NULL,
  tagged_by text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,assignment_id,course_outcome_id),
  FOREIGN KEY (institution_id,assignment_id) REFERENCES assignment,
  FOREIGN KEY (institution_id,course_outcome_id) REFERENCES course_outcome
);
GRANT SELECT, INSERT ON programme_outcome, course_outcome, outcome_mapping, assessment_outcome TO nexus_app;
GRANT UPDATE (state,decided_by,reason) ON course_outcome TO nexus_app;
GRANT DELETE ON assessment_outcome TO nexus_app;
