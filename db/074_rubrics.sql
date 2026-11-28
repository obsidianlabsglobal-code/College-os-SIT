-- FC-010: rubric criteria per assignment (points add up to its maximum marks) and per-criterion scores tied to a grade
-- revision. The criterion total becomes that revision's marks; publication stays the existing grade publication.
CREATE TABLE rubric_criterion (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 20),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  points integer NOT NULL CHECK (points BETWEEN 1 AND 1000),
  descriptor text NOT NULL DEFAULT '' CHECK (length(descriptor) <= 500),
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,assignment_id,position),
  FOREIGN KEY (institution_id,assignment_id) REFERENCES assignment
);
CREATE TABLE criterion_score (
  institution_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  revision integer NOT NULL,
  criterion_id uuid NOT NULL,
  points integer NOT NULL CHECK (points >= 0),
  comment text NOT NULL DEFAULT '' CHECK (length(comment) <= 1000),
  PRIMARY KEY (institution_id,submission_id,revision,criterion_id),
  FOREIGN KEY (institution_id,submission_id,revision) REFERENCES grade,
  FOREIGN KEY (institution_id,criterion_id) REFERENCES rubric_criterion
);
GRANT SELECT, INSERT, DELETE ON rubric_criterion TO nexus_app;
GRANT SELECT, INSERT ON criterion_score TO nexus_app;
