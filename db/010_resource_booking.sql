CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE campus_resource (
  institution_id uuid REFERENCES institution,
  id uuid DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('room','equipment')),
  location text NOT NULL,
  capacity integer CHECK (capacity > 0),
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,name,location)
);

CREATE TABLE resource_custodian (
  institution_id uuid,
  id uuid DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL,
  account_id text NOT NULL REFERENCES "user",
  starts_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ends_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,resource_id) REFERENCES campus_resource,
  CHECK (starts_at < ends_at)
);
CREATE UNIQUE INDEX custodian_unrevoked ON resource_custodian (institution_id,resource_id,account_id)
  WHERE revoked_at IS NULL;

CREATE TABLE resource_booking (
  institution_id uuid,
  id uuid DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL,
  event_id uuid NOT NULL,
  requested_by text NOT NULL REFERENCES "user",
  slot tstzrange NOT NULL CHECK (NOT isempty(slot) AND NOT lower_inf(slot) AND NOT upper_inf(slot) AND lower_inc(slot) AND NOT upper_inc(slot)),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','confirmed','declined','cancelled')),
  revision integer NOT NULL DEFAULT 0,
  reason text,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,resource_id) REFERENCES campus_resource,
  FOREIGN KEY (institution_id,event_id) REFERENCES club_event,
  CHECK (state NOT IN ('declined','cancelled') OR nullif(btrim(reason),'') IS NOT NULL),
  EXCLUDE USING gist (institution_id WITH =,resource_id WITH =,slot WITH &&) WHERE (state='confirmed')
);
CREATE UNIQUE INDEX booking_live_event_resource ON resource_booking (institution_id,event_id,resource_id)
  WHERE state IN ('requested','confirmed');
CREATE INDEX booking_event ON resource_booking (institution_id,event_id,changed_at DESC);
CREATE INDEX booking_queue ON resource_booking (institution_id,resource_id,changed_at DESC,id);
CREATE INDEX booking_confirmed_event ON resource_booking (institution_id,event_id) WHERE state='confirmed';

GRANT SELECT,INSERT ON campus_resource,resource_custodian,resource_booking TO nexus_app;
GRANT UPDATE (revoked_at) ON resource_custodian TO nexus_app;
GRANT UPDATE (state,revision,reason,changed_at) ON resource_booking TO nexus_app;
