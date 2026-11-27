-- FC-027: staff meetings with participants, minutes and owned follow-up actions.
CREATE TABLE meeting (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organizer_id text NOT NULL REFERENCES "user",
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  starts_at timestamptz NOT NULL,
  agenda text NOT NULL CHECK (length(btrim(agenda)) BETWEEN 1 AND 4000),
  minutes text CHECK (minutes IS NULL OR length(btrim(minutes)) BETWEEN 1 AND 8000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id)
);
CREATE TABLE meeting_participant (
  institution_id uuid NOT NULL,
  meeting_id uuid NOT NULL,
  account_id text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,meeting_id,account_id),
  FOREIGN KEY (institution_id,meeting_id) REFERENCES meeting
);
CREATE TABLE meeting_action (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL,
  owner_id text NOT NULL REFERENCES "user",
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  due_on date NOT NULL,
  done_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,meeting_id) REFERENCES meeting
);
GRANT SELECT, INSERT ON meeting, meeting_participant, meeting_action TO nexus_app;
GRANT UPDATE (minutes) ON meeting TO nexus_app;
GRANT UPDATE (done_at) ON meeting_action TO nexus_app;

-- SL-013: a student curates verified records into a portfolio; sharing follows their profile visibility (SL-009).
CREATE TABLE portfolio_item (
  institution_id uuid REFERENCES institution NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  source text NOT NULL CHECK (source IN ('certificate','milestone','result')),
  source_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,student_id,source,source_id)
);
GRANT SELECT, INSERT, DELETE ON portfolio_item TO nexus_app;

-- SL-016: student representation issues on the shared case engine; current students may add support once.
ALTER TABLE case_record DROP CONSTRAINT case_record_kind_check,
  ADD CONSTRAINT case_record_kind_check CHECK (kind IN ('support','grievance','facility','integrity','department','representation'));
CREATE TABLE case_support (
  institution_id uuid NOT NULL,
  case_id uuid NOT NULL,
  account_id text NOT NULL REFERENCES "user",
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,case_id,account_id),
  FOREIGN KEY (institution_id,case_id) REFERENCES case_record
);
GRANT SELECT, INSERT ON case_support TO nexus_app;
