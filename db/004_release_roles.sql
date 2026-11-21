ALTER TABLE membership DROP CONSTRAINT membership_role_check;
ALTER TABLE membership ADD CONSTRAINT membership_role_check CHECK (role IN ('student','faculty','hod','admin','principal'));
GRANT INSERT, UPDATE (ended_at) ON membership TO nexus_app;
GRANT INSERT ON department, academic_scheme, academic_term TO nexus_app;

ALTER TABLE grade ADD COLUMN superseded_at timestamptz;
ALTER TABLE grade ADD CONSTRAINT grade_single_disposition CHECK (num_nonnulls(published_at,superseded_at) <= 1);
DROP INDEX one_grade_draft;
CREATE UNIQUE INDEX one_grade_draft ON grade (institution_id,submission_id) WHERE published_at IS NULL AND superseded_at IS NULL;
REVOKE DELETE ON grade FROM nexus_app;
GRANT UPDATE (superseded_at) ON grade TO nexus_app;
