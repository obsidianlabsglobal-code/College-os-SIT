-- CR-002 / CR-007 / CR-008 / CR-009 / CR-032: more verified listing kinds, including on-campus placement drives run by the office.
-- CR-010: a listing may be limited to students currently taking a course in one department.
ALTER TABLE opportunity_listing DROP CONSTRAINT opportunity_listing_kind_check,
  ADD CONSTRAINT opportunity_listing_kind_check CHECK (kind IN ('internship','scholarship','competition','job','placement','hackathon','fellowship','research')),
  ADD COLUMN department_id uuid,
  ADD CONSTRAINT opportunity_listing_department_fkey FOREIGN KEY (institution_id,department_id) REFERENCES department;

-- CR-015 / CR-016 / CR-031 / CR-032: a student saves a listing, drafts a statement and records submission; the office records
-- placement-drive outcomes. A student may withdraw before an outcome.
CREATE TABLE opportunity_application (
  institution_id uuid NOT NULL,
  listing_id uuid NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  state text NOT NULL DEFAULT 'saved' CHECK (state IN ('saved','submitted','shortlisted','offered','rejected','withdrawn')),
  statement text NOT NULL DEFAULT '' CHECK (length(statement) <= 3000),
  submitted_at timestamptz,
  outcome_note text CHECK (outcome_note IS NULL OR length(btrim(outcome_note)) BETWEEN 1 AND 500),
  decided_by text REFERENCES "user",
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,listing_id,student_id),
  FOREIGN KEY (institution_id,listing_id) REFERENCES opportunity_listing,
  CHECK ((state = 'saved') = (submitted_at IS NULL) OR state = 'withdrawn')
);
GRANT SELECT, INSERT ON opportunity_application TO nexus_app;
GRANT UPDATE (state,statement,submitted_at,outcome_note,decided_by,updated_at) ON opportunity_application TO nexus_app;
