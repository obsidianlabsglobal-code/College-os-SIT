CREATE TABLE transport_maintenance (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  opened_by text NOT NULL REFERENCES "user",
  summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 180),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  service_on date,
  cleared_by text REFERENCES "user",
  cleared_at timestamptz,
  clearance_note text CHECK (length(btrim(clearance_note)) BETWEEN 1 AND 300),
  PRIMARY KEY(institution_id,id),
  FOREIGN KEY(institution_id,vehicle_id) REFERENCES transport_vehicle,
  CHECK (num_nonnulls(service_on,cleared_by,cleared_at,clearance_note) IN (0,4))
);
CREATE INDEX transport_vehicle_maintenance ON transport_maintenance(institution_id,vehicle_id,recorded_at DESC);
GRANT SELECT,INSERT ON transport_maintenance TO nexus_app;
GRANT UPDATE (service_on,cleared_by,cleared_at,clearance_note) ON transport_maintenance TO nexus_app;
