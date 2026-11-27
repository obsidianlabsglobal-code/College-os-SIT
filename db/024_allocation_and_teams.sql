-- DH-007: a department head proposes a teacher for an offering in their department; the office approves (which
-- adds the faculty roster row) or rejects with a reason.
CREATE TABLE allocation_proposal (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL,
  faculty_id text NOT NULL REFERENCES "user",
  proposed_by text NOT NULL REFERENCES "user",
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','approved','rejected')),
  decided_by text REFERENCES "user",
  decided_at timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,offering_id) REFERENCES offering,
  CHECK ((state = 'proposed') = (decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL))
);
CREATE UNIQUE INDEX allocation_open ON allocation_proposal (institution_id,offering_id,faculty_id) WHERE state='proposed';
GRANT SELECT, INSERT ON allocation_proposal TO nexus_app;
GRANT UPDATE (state,decided_by,decided_at,decision_reason) ON allocation_proposal TO nexus_app;

-- FC-017 / FC-018: a teacher forms project teams within an offering (one team per student per offering), sets
-- milestones, and reviews each team's latest evidence.
CREATE TABLE project_team (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  created_by text NOT NULL REFERENCES "user",
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,id,offering_id),
  UNIQUE (institution_id,offering_id,name),
  FOREIGN KEY (institution_id,offering_id) REFERENCES offering
);
CREATE TABLE team_member (
  institution_id uuid NOT NULL,
  team_id uuid NOT NULL,
  offering_id uuid NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,team_id,student_id),
  UNIQUE (institution_id,offering_id,student_id),
  FOREIGN KEY (institution_id,team_id,offering_id) REFERENCES project_team (institution_id,id,offering_id)
);
CREATE TABLE team_milestone (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  due_at timestamptz NOT NULL,
  created_by text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,id,offering_id),
  FOREIGN KEY (institution_id,offering_id) REFERENCES offering
);
CREATE TABLE milestone_evidence (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL,
  team_id uuid NOT NULL,
  offering_id uuid NOT NULL,
  submitted_by text NOT NULL REFERENCES "user",
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  review text NOT NULL DEFAULT 'pending' CHECK (review IN ('pending','accepted','changes_requested')),
  reviewed_by text REFERENCES "user",
  reviewed_at timestamptz,
  review_note text CHECK (review_note IS NULL OR length(btrim(review_note)) BETWEEN 1 AND 1000),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,milestone_id,offering_id) REFERENCES team_milestone (institution_id,id,offering_id),
  FOREIGN KEY (institution_id,team_id,offering_id) REFERENCES project_team (institution_id,id,offering_id),
  CHECK ((review = 'pending') = (reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL))
);
GRANT SELECT, INSERT ON project_team, team_member, team_milestone, milestone_evidence TO nexus_app;
GRANT DELETE ON team_member TO nexus_app;
GRANT UPDATE (review,reviewed_by,reviewed_at,review_note) ON milestone_evidence TO nexus_app;
