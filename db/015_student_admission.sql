-- Admission approval is separate from authentication and course access.
CREATE TABLE student_admission (
  institution_id uuid NOT NULL REFERENCES institution,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  section_id uuid NOT NULL,
  term_id uuid NOT NULL,
  approved_by text NOT NULL REFERENCES "user"(id),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,section_id) REFERENCES section,
  FOREIGN KEY (institution_id,term_id) REFERENCES academic_term
);
CREATE UNIQUE INDEX one_active_student_admission_email
  ON student_admission (institution_id,email) WHERE revoked_at IS NULL;
GRANT SELECT, INSERT ON student_admission TO nexus_app;
GRANT UPDATE (revoked_at) ON student_admission TO nexus_app;
