-- TO-001/002/003/006, TR-001/003. Route choice here is a preference for future trip snapshots.
CREATE TABLE transport_route (
  institution_id uuid NOT NULL REFERENCES institution,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 30),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  active boolean NOT NULL DEFAULT true,
  choice_locked boolean NOT NULL DEFAULT false,
  published_revision smallint,
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,code,direction)
);

CREATE TABLE transport_route_revision (
  institution_id uuid NOT NULL,
  route_id uuid NOT NULL,
  revision smallint NOT NULL CHECK (revision > 0),
  published_at timestamptz,
  PRIMARY KEY (institution_id,route_id,revision),
  FOREIGN KEY (institution_id,route_id) REFERENCES transport_route
);
ALTER TABLE transport_route ADD FOREIGN KEY (institution_id,id,published_revision) REFERENCES transport_route_revision;

-- Stable boarding stop identifiers survive future published route revisions.
CREATE TABLE transport_stop (
  institution_id uuid NOT NULL,
  route_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  PRIMARY KEY (institution_id,route_id,id),
  FOREIGN KEY (institution_id,route_id) REFERENCES transport_route
);
CREATE TABLE transport_route_stop (
  institution_id uuid NOT NULL,
  route_id uuid NOT NULL,
  revision smallint NOT NULL,
  stop_id uuid NOT NULL,
  stop_order smallint NOT NULL CHECK (stop_order BETWEEN 1 AND 100),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  lat numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon numeric(9,6) NOT NULL CHECK (lon BETWEEN -180 AND 180),
  arrival_offset_min smallint NOT NULL CHECK (arrival_offset_min BETWEEN 0 AND 1439),
  PRIMARY KEY (institution_id,route_id,revision,stop_id),
  UNIQUE (institution_id,route_id,revision,stop_order),
  FOREIGN KEY (institution_id,route_id,revision) REFERENCES transport_route_revision,
  FOREIGN KEY (institution_id,route_id,stop_id) REFERENCES transport_stop
);

CREATE TABLE transport_vehicle (
  institution_id uuid NOT NULL REFERENCES institution,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  seat_capacity smallint NOT NULL CHECK (seat_capacity BETWEEN 1 AND 250),
  permitted_capacity smallint NOT NULL CHECK (permitted_capacity BETWEEN seat_capacity AND 300),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,label)
);
CREATE TABLE transport_schedule (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL,
  revision smallint NOT NULL,
  vehicle_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  departure time NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,id,route_id,revision,vehicle_id),
  FOREIGN KEY (institution_id,route_id,revision) REFERENCES transport_route_revision,
  FOREIGN KEY (institution_id,vehicle_id) REFERENCES transport_vehicle
);
CREATE UNIQUE INDEX transport_schedule_active_slot ON transport_schedule (institution_id,route_id,weekday,departure) WHERE active;

CREATE TABLE transport_choice (
  institution_id uuid NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  route_id uuid NOT NULL,
  stop_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,student_id),
  FOREIGN KEY (institution_id,route_id,stop_id) REFERENCES transport_stop
);
CREATE INDEX transport_route_rider_choices ON transport_choice (institution_id,route_id);

GRANT SELECT,INSERT ON transport_route,transport_route_revision,transport_stop,transport_route_stop,transport_vehicle,transport_schedule,transport_choice TO nexus_app;
GRANT UPDATE (label,active,choice_locked,published_revision) ON transport_route TO nexus_app;
GRANT UPDATE (published_at) ON transport_route_revision TO nexus_app;
GRANT UPDATE (active,seat_capacity,permitted_capacity,label) ON transport_vehicle TO nexus_app;
GRANT UPDATE (active) ON transport_schedule TO nexus_app;
GRANT UPDATE (route_id,stop_id,changed_at) ON transport_choice TO nexus_app;
