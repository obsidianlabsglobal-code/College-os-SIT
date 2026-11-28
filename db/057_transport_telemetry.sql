CREATE TABLE transport_device (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 100),
  credential_digest text NOT NULL UNIQUE CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  rate_window timestamptz,
  rate_count smallint NOT NULL DEFAULT 0 CHECK (rate_count BETWEEN 0 AND 16),
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,id,vehicle_id),
  FOREIGN KEY (institution_id,vehicle_id) REFERENCES transport_vehicle,
  CHECK (revoked_at IS NULL OR revoked_at>=bound_at)
);
CREATE UNIQUE INDEX transport_active_client ON transport_device(institution_id,client_id) WHERE revoked_at IS NULL;
ALTER TABLE transport_trip ADD UNIQUE (institution_id,id,vehicle_id);
CREATE TABLE transport_position (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  device_id uuid,
  source text NOT NULL CHECK (source IN ('live','simulated')),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m double precision CHECK (accuracy_m BETWEEN 0 AND 5000),
  speed_kmh double precision CHECK (speed_kmh BETWEEN 0 AND 500),
  quarantined boolean NOT NULL DEFAULT false,
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,id,trip_id),
  FOREIGN KEY (institution_id,trip_id,vehicle_id) REFERENCES transport_trip(institution_id,id,vehicle_id),
  FOREIGN KEY (institution_id,device_id,vehicle_id) REFERENCES transport_device(institution_id,id,vehicle_id),
  CHECK ((source='simulated')=(device_id IS NULL))
);
CREATE UNIQUE INDEX transport_position_fix ON transport_position(institution_id,trip_id,observed_at,source);
CREATE INDEX transport_position_retention ON transport_position(institution_id,observed_at);
CREATE INDEX transport_position_trip ON transport_position(institution_id,trip_id,observed_at DESC) WHERE NOT quarantined;
CREATE TABLE transport_latest_position (
  institution_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  position_id uuid NOT NULL,
  PRIMARY KEY (institution_id,trip_id),
  FOREIGN KEY (institution_id,position_id,trip_id) REFERENCES transport_position(institution_id,id,trip_id) ON DELETE CASCADE
);
GRANT SELECT,INSERT ON transport_device,transport_position,transport_latest_position TO nexus_app;
GRANT UPDATE (revoked_at,rate_window,rate_count) ON transport_device TO nexus_app;
GRANT UPDATE (position_id) ON transport_latest_position TO nexus_app;
GRANT DELETE ON transport_position TO nexus_app;
