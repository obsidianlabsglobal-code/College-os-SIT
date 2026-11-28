CREATE TABLE transport_route_teacher (
  institution_id uuid NOT NULL,
  route_id uuid NOT NULL,
  faculty_id text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,route_id),
  FOREIGN KEY (institution_id,route_id) REFERENCES transport_route
);
CREATE TABLE transport_sos (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  student_id text NOT NULL,
  case_id uuid NOT NULL,
  stop_name text,
  position_at timestamptz,
  signalled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  latest_signal_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  repeats integer NOT NULL DEFAULT 1 CHECK (repeats>0),
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,trip_id,student_id),
  FOREIGN KEY (institution_id,trip_id,student_id) REFERENCES transport_boarding,
  FOREIGN KEY (institution_id,case_id) REFERENCES case_record
);
GRANT SELECT,INSERT ON transport_route_teacher,transport_sos TO nexus_app;
GRANT UPDATE (faculty_id) ON transport_route_teacher TO nexus_app;
GRANT UPDATE (latest_signal_at,repeats,stop_name,position_at) ON transport_sos TO nexus_app;
