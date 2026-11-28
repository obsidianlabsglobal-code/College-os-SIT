-- DH-020: the office links a recognized club to a department (a departmental association); that department's HOD oversees it.
CREATE TABLE club_department (
  institution_id uuid NOT NULL,
  club_id uuid NOT NULL,
  department_id uuid NOT NULL,
  linked_by text NOT NULL REFERENCES "user",
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,club_id),
  FOREIGN KEY (institution_id,club_id) REFERENCES club,
  FOREIGN KEY (institution_id,department_id) REFERENCES department
);
GRANT SELECT, INSERT, DELETE ON club_department TO nexus_app;
