ALTER TABLE transport_trip ADD COLUMN seats_at_start smallint CHECK (seats_at_start BETWEEN 1 AND 250);
GRANT UPDATE (seats_at_start) ON transport_trip TO nexus_app;
CREATE TABLE transport_boarding_device (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 100),
  digest text NOT NULL UNIQUE CHECK (digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,vehicle_id) REFERENCES transport_vehicle
);
CREATE TABLE transport_sticker (
  institution_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  digest text NOT NULL UNIQUE CHECK (digest ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,vehicle_id),
  FOREIGN KEY (institution_id,vehicle_id) REFERENCES transport_vehicle
);
CREATE TABLE transport_boarding (
  institution_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  student_id text NOT NULL,
  method text NOT NULL CHECK (method IN ('screen','sticker')),
  boarded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,trip_id,student_id),
  FOREIGN KEY (institution_id,trip_id,student_id) REFERENCES transport_trip_rider
);
GRANT SELECT,INSERT ON transport_boarding_device,transport_sticker,transport_boarding TO nexus_app;
GRANT UPDATE (revoked_at) ON transport_boarding_device TO nexus_app;
GRANT UPDATE (digest,issued_at) ON transport_sticker TO nexus_app;
