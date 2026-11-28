CREATE TABLE transport_backup_consent (
  institution_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  student_id text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  PRIMARY KEY (institution_id,trip_id,student_id),
  FOREIGN KEY (institution_id,trip_id,student_id) REFERENCES transport_boarding
);
-- Keep the latest isolated sample per consenting rider, never a history.
CREATE TABLE transport_backup_fix (
  institution_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  student_id text NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  sampled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,trip_id,student_id),
  FOREIGN KEY (institution_id,trip_id,student_id) REFERENCES transport_backup_consent ON DELETE CASCADE
);
GRANT SELECT,INSERT ON transport_backup_consent,transport_backup_fix TO nexus_app;
GRANT UPDATE (granted_at,revoked_at) ON transport_backup_consent TO nexus_app;
GRANT UPDATE (latitude,longitude,sampled_at) ON transport_backup_fix TO nexus_app;
GRANT DELETE ON transport_backup_fix TO nexus_app;
