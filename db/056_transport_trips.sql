-- A trip and its rider preferences are independent from later catalog changes.
CREATE TABLE transport_trip (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL,
  route_id uuid NOT NULL,
  revision smallint NOT NULL,
  vehicle_id uuid NOT NULL,
  service_on date NOT NULL,
  scheduled_departure_at timestamptz NOT NULL,
  mode text NOT NULL CHECK (mode IN ('simulated','live')),
  state text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled','active','completed','cancelled')),
  driver_id text REFERENCES "user",
  created_by text NOT NULL REFERENCES "user",
  started_at timestamptz,
  ended_at timestamptz,
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,id,route_id,revision),
  UNIQUE (institution_id,schedule_id,service_on),
  FOREIGN KEY (institution_id,schedule_id,route_id,revision,vehicle_id) REFERENCES transport_schedule (institution_id,id,route_id,revision,vehicle_id),
  CHECK ((state IN ('completed','cancelled')) = (ended_at IS NOT NULL)),
  CHECK (state NOT IN ('active','completed') OR started_at IS NOT NULL),
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at>=started_at)
);
CREATE UNIQUE INDEX transport_one_active_vehicle ON transport_trip(institution_id,vehicle_id) WHERE state='active';
CREATE UNIQUE INDEX transport_one_active_route ON transport_trip(institution_id,route_id) WHERE state='active';
CREATE UNIQUE INDEX transport_one_active_driver ON transport_trip(institution_id,driver_id) WHERE state='active' AND driver_id IS NOT NULL;

CREATE TABLE transport_trip_rider (
  institution_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  route_id uuid NOT NULL,
  revision smallint NOT NULL,
  stop_id uuid NOT NULL,
  released_at timestamptz,
  PRIMARY KEY (institution_id,trip_id,student_id),
  FOREIGN KEY (institution_id,trip_id,route_id,revision) REFERENCES transport_trip(institution_id,id,route_id,revision),
  FOREIGN KEY (institution_id,route_id,revision,stop_id) REFERENCES transport_route_stop
);
CREATE UNIQUE INDEX transport_one_active_trip_per_rider ON transport_trip_rider(institution_id,student_id) WHERE released_at IS NULL;
GRANT SELECT,INSERT ON transport_trip,transport_trip_rider TO nexus_app;
GRANT UPDATE (state,started_at,ended_at) ON transport_trip TO nexus_app;
GRANT UPDATE (released_at) ON transport_trip_rider TO nexus_app;
