CREATE TABLE transport_disruption (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  route_id uuid NOT NULL,
  revision smallint NOT NULL,
  stop_id uuid NOT NULL,
  case_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('puncture','breakdown','road_block','accident_no_injuries','accident_injury',
    'heavy_traffic','weather_flooding','fuel','driver_delayed','route_diverted','trip_cancelled')),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved','cancelled')),
  latest_sequence integer NOT NULL DEFAULT 0 CHECK (latest_sequence >= 0),
  update_by timestamptz,
  resolution_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,trip_id,route_id,revision) REFERENCES transport_trip(institution_id,id,route_id,revision),
  FOREIGN KEY (institution_id,route_id,revision,stop_id) REFERENCES transport_route_stop,
  FOREIGN KEY (institution_id,case_id) REFERENCES case_record,
  CHECK ((state='open')=(resolution_at IS NULL))
);
CREATE TABLE transport_disruption_notice (
  institution_id uuid NOT NULL,
  disruption_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence>0),
  stage text NOT NULL CHECK (stage IN ('initial','update','all_clear','cancelled')),
  body_en text NOT NULL CHECK (length(body_en) BETWEEN 1 AND 1200),
  body_kn text NOT NULL CHECK (length(body_kn) BETWEEN 1 AND 1200),
  aboard_en text NOT NULL CHECK (length(aboard_en) BETWEEN 1 AND 1200),
  aboard_kn text NOT NULL CHECK (length(aboard_kn) BETWEEN 1 AND 1200),
  published_by text NOT NULL REFERENCES "user",
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  update_by timestamptz,
  PRIMARY KEY (institution_id,disruption_id,sequence),
  FOREIGN KEY (institution_id,disruption_id) REFERENCES transport_disruption
);
CREATE TABLE transport_disruption_receipt (
  institution_id uuid NOT NULL,
  disruption_id uuid NOT NULL,
  notice_sequence integer NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  locale text NOT NULL CHECK (locale IN ('en','kn')),
  audience text NOT NULL CHECK (audience IN ('waiting','aboard')),
  read_at timestamptz,
  PRIMARY KEY (institution_id,disruption_id,notice_sequence,student_id),
  FOREIGN KEY (institution_id,disruption_id,notice_sequence) REFERENCES transport_disruption_notice
);
CREATE INDEX transport_disruption_student_feed ON transport_disruption_receipt(institution_id,student_id,disruption_id,notice_sequence);
GRANT SELECT,INSERT ON transport_disruption,transport_disruption_notice,transport_disruption_receipt TO nexus_app;
GRANT UPDATE (state,latest_sequence,update_by,resolution_at) ON transport_disruption TO nexus_app;
GRANT UPDATE (read_at) ON transport_disruption_receipt TO nexus_app;
