CREATE TABLE transport_accident_response (
  institution_id uuid NOT NULL,
  disruption_id uuid NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  response text NOT NULL CHECK(response IN ('safe','need_help')),
  responded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,disruption_id,student_id),
  FOREIGN KEY (institution_id,disruption_id) REFERENCES transport_disruption
);
GRANT SELECT,INSERT ON transport_accident_response TO nexus_app;
GRANT UPDATE (response,responded_at) ON transport_accident_response TO nexus_app;

CREATE TABLE transport_replacement (
  institution_id uuid NOT NULL,
  disruption_id uuid NOT NULL,
  replacement_trip_id uuid NOT NULL,
  route_id uuid NOT NULL,
  revision smallint NOT NULL,
  stop_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,disruption_id),
  FOREIGN KEY (institution_id,disruption_id) REFERENCES transport_disruption,
  FOREIGN KEY (institution_id,replacement_trip_id,route_id,revision) REFERENCES transport_trip(institution_id,id,route_id,revision),
  FOREIGN KEY (institution_id,route_id,revision,stop_id) REFERENCES transport_route_stop
);
GRANT SELECT,INSERT ON transport_replacement TO nexus_app;
GRANT UPDATE (replacement_trip_id,route_id,revision,stop_id,changed_at) ON transport_replacement TO nexus_app;
