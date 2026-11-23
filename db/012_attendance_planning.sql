CREATE TABLE attendance_planning_target (
  institution_id uuid NOT NULL,
  offering_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  percent smallint CHECK (percent BETWEEN 1 AND 100),
  source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 200),
  actor_id text NOT NULL REFERENCES "user",
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,offering_id,revision),
  FOREIGN KEY (institution_id,offering_id) REFERENCES offering
);
GRANT SELECT,INSERT ON attendance_planning_target TO nexus_app;
