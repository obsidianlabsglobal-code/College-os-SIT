CREATE TABLE transport_fee_status (
  institution_id uuid NOT NULL,
  student_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('paid','due','exempt')),
  decided_by text NOT NULL REFERENCES "user",
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,student_id),
  FOREIGN KEY (institution_id,student_id) REFERENCES transport_choice
);
CREATE TABLE transport_speed_policy (
  institution_id uuid NOT NULL REFERENCES institution PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  limit_kmh smallint NOT NULL DEFAULT 70 CHECK (limit_kmh BETWEEN 10 AND 120)
);
CREATE TABLE transport_speed_alert (
  institution_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  time_bucket timestamptz NOT NULL,
  threshold_kmh smallint NOT NULL,
  observed_kmh smallint NOT NULL,
  PRIMARY KEY (institution_id,trip_id,time_bucket),
  FOREIGN KEY (institution_id,trip_id) REFERENCES transport_trip
);
GRANT SELECT,INSERT ON transport_fee_status,transport_speed_policy,transport_speed_alert TO nexus_app;
GRANT UPDATE (status,decided_by,decided_at) ON transport_fee_status TO nexus_app;
GRANT UPDATE (enabled,limit_kmh) ON transport_speed_policy TO nexus_app;
