CREATE TABLE transport_eta_feedback (
  institution_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  student_id text NOT NULL,
  accurate boolean NOT NULL,
  comment text CHECK (length(btrim(comment)) BETWEEN 1 AND 250),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,trip_id,student_id),
  FOREIGN KEY (institution_id,trip_id,student_id) REFERENCES transport_trip_rider
);
GRANT SELECT,INSERT ON transport_eta_feedback TO nexus_app;
