-- AD-021 / AD-016 slice: versioned institutional policies. An admin drafts a version; the principal approves it with
-- a reason before it is published to its audience. Attendance policies carry a structured threshold (SA-007).
CREATE TABLE policy (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('general','attendance','service','integrity')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  audience text NOT NULL CHECK (audience IN ('everyone','staff','students')),
  created_by text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,id)
);
CREATE TABLE policy_version (
  institution_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
  attendance_threshold integer CHECK (attendance_threshold BETWEEN 1 AND 100),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved','rejected')),
  drafted_by text NOT NULL REFERENCES "user",
  drafted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by text REFERENCES "user",
  decided_at timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 1 AND 500),
  PRIMARY KEY (institution_id,policy_id,version),
  FOREIGN KEY (institution_id,policy_id) REFERENCES policy,
  CHECK ((state = 'draft') = (decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL))
);
CREATE UNIQUE INDEX policy_one_draft ON policy_version (institution_id,policy_id) WHERE state='draft';
GRANT SELECT, INSERT ON policy, policy_version TO nexus_app;
GRANT UPDATE (state,decided_by,decided_at,decision_reason) ON policy_version TO nexus_app;

-- Three more kinds on the shared case engine (AD-020):
--   facility    (AD-031 / AD-032): estate repairs owned by the office; the reporter may reopen an unresolved repair.
--   integrity   (SA-023): a student's confidential appeal tied to a published policy and one of their assignments.
--   department  (DH-023): a student's request to a department, routed by its HOD to a department teacher.
ALTER TABLE case_record DROP CONSTRAINT case_record_kind_check,
  ADD CONSTRAINT case_record_kind_check CHECK (kind IN ('support','grievance','facility','integrity','department')),
  DROP CONSTRAINT case_record_check,
  ADD CONSTRAINT case_record_department_kind CHECK ((kind IN ('support','department','integrity')) = (department_id IS NOT NULL)),
  ADD COLUMN policy_id uuid, ADD COLUMN policy_version integer, ADD COLUMN assignment_id uuid,
  ADD COLUMN reopened integer NOT NULL DEFAULT 0,
  ADD FOREIGN KEY (institution_id,policy_id,policy_version) REFERENCES policy_version,
  ADD FOREIGN KEY (institution_id,assignment_id) REFERENCES assignment,
  ADD CONSTRAINT case_record_integrity_refs CHECK ((kind = 'integrity') = (policy_id IS NOT NULL AND assignment_id IS NOT NULL));
GRANT UPDATE (reopened) ON case_record TO nexus_app;

-- FC-009 / FC-008 slice: a teacher's versioned question bank, private or shared with their department.
CREATE TABLE bank_question (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id text NOT NULL REFERENCES "user",
  department_id uuid NOT NULL,
  topic text NOT NULL CHECK (length(btrim(topic)) BETWEEN 1 AND 120),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','department')),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,department_id) REFERENCES department
);
CREATE TABLE bank_question_version (
  institution_id uuid NOT NULL,
  question_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  prompt text NOT NULL CHECK (length(btrim(prompt)) BETWEEN 1 AND 4000),
  marks integer NOT NULL CHECK (marks BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,question_id,version),
  FOREIGN KEY (institution_id,question_id) REFERENCES bank_question
);
GRANT SELECT, INSERT ON bank_question, bank_question_version TO nexus_app;
GRANT UPDATE (visibility) ON bank_question TO nexus_app;
