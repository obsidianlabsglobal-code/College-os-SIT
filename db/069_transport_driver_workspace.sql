CREATE TABLE transport_driver_phone (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  primary_driver text NOT NULL REFERENCES "user",
  backup_driver text REFERENCES "user",
  primary_pin_hash text NOT NULL,
  backup_pin_hash text,
  enrollment_digest text UNIQUE CHECK(enrollment_digest ~ '^[a-f0-9]{64}$'),
  enroll_until timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '20 minutes'),
  phone_digest text UNIQUE CHECK(phone_digest ~ '^[a-f0-9]{64}$'),
  session_digest text UNIQUE CHECK(session_digest ~ '^[a-f0-9]{64}$'),
  session_driver text REFERENCES "user",
  session_until timestamptz,
  bad_attempts integer NOT NULL DEFAULT 0 CHECK(bad_attempts BETWEEN 0 AND 5),
  locked_until timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,vehicle_id) REFERENCES transport_vehicle,
  CHECK (backup_driver IS DISTINCT FROM primary_driver),
  CHECK ((backup_driver IS NULL) = (backup_pin_hash IS NULL)),
  CHECK (num_nonnulls(session_digest,session_driver,session_until) IN (0,3)),
  CHECK (session_driver IS NULL OR session_driver=primary_driver OR session_driver=backup_driver)
);
GRANT SELECT, INSERT ON transport_driver_phone TO nexus_app;
GRANT UPDATE (enrollment_digest,phone_digest, session_digest, session_driver, session_until, bad_attempts, locked_until, revoked_at) ON transport_driver_phone TO nexus_app;
GRANT UPDATE (driver_id) ON transport_trip TO nexus_app;

CREATE TABLE transport_driver_command (
  institution_id uuid NOT NULL,
  driver_id text NOT NULL REFERENCES "user",
  id uuid NOT NULL,
  trip_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  operation text NOT NULL CHECK(operation IN ('check','start','end','sos','report','ack')),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,driver_id,id),
  FOREIGN KEY (institution_id,trip_id) REFERENCES transport_trip
);

CREATE TABLE transport_driver_check (
  institution_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  driver_id text NOT NULL REFERENCES "user",
  results jsonb NOT NULL CHECK(jsonb_typeof(results)='object'),
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,trip_id,driver_id),
  FOREIGN KEY (institution_id,trip_id) REFERENCES transport_trip
);

CREATE TABLE transport_driver_end_note (
  institution_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  driver_id text NOT NULL REFERENCES "user",
  odometer integer CHECK(odometer BETWEEN 0 AND 9999999),
  problems text CHECK(length(problems)<=240),
  PRIMARY KEY (institution_id,trip_id),
  FOREIGN KEY (institution_id,trip_id) REFERENCES transport_trip
);

CREATE TABLE transport_driver_contact (
  institution_id uuid PRIMARY KEY REFERENCES institution,
  phone text NOT NULL CHECK(phone ~ '^\+?[0-9]{6,15}$')
);

CREATE TABLE transport_driver_sos (
  institution_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  case_id uuid NOT NULL,
  signal_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,trip_id),
  FOREIGN KEY (institution_id,trip_id) REFERENCES transport_trip,
  FOREIGN KEY (institution_id,case_id) REFERENCES case_record
);
GRANT SELECT,INSERT ON transport_driver_command,transport_driver_check,transport_driver_end_note,transport_driver_sos,transport_driver_contact TO nexus_app;
GRANT UPDATE (results,checked_at) ON transport_driver_check TO nexus_app;
GRANT UPDATE (signal_at) ON transport_driver_sos TO nexus_app;
GRANT UPDATE (phone) ON transport_driver_contact TO nexus_app;

CREATE TABLE transport_driver_message (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('replacement','diversion','stop_change')),
  body_en text NOT NULL CHECK(length(body_en) BETWEEN 1 AND 240),
  body_kn text NOT NULL CHECK(length(body_kn) BETWEEN 1 AND 240),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  issued_by text NOT NULL REFERENCES "user",
  read_by text REFERENCES "user",
  read_at timestamptz,
  PRIMARY KEY(institution_id,id),
  FOREIGN KEY (institution_id,trip_id) REFERENCES transport_trip
);
CREATE INDEX transport_driver_message_trip ON transport_driver_message(institution_id,trip_id,issued_at DESC);
GRANT SELECT,INSERT ON transport_driver_message TO nexus_app;
GRANT UPDATE (read_by,read_at) ON transport_driver_message TO nexus_app;

CREATE TABLE transport_driver_document (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  driver_id text NOT NULL REFERENCES "user",
  kind text NOT NULL CHECK(kind IN ('licence','fitness','insurance','permit','puc')),
  expiry date NOT NULL,
  PRIMARY KEY(institution_id,id),
  UNIQUE(institution_id,vehicle_id,driver_id,kind),
  FOREIGN KEY (institution_id,vehicle_id) REFERENCES transport_vehicle
);
GRANT SELECT,INSERT ON transport_driver_document TO nexus_app;
GRANT UPDATE (expiry) ON transport_driver_document TO nexus_app;

CREATE TABLE transport_driver_leave (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  driver_id text NOT NULL REFERENCES "user",
  backup_driver text REFERENCES "user",
  day date NOT NULL,
  kind text NOT NULL CHECK(kind IN ('leave','swap')),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  decided_by text REFERENCES "user",
  PRIMARY KEY(institution_id,id),
  UNIQUE (institution_id,vehicle_id,driver_id,day,kind),
  FOREIGN KEY (institution_id,vehicle_id) REFERENCES transport_vehicle,
  CHECK (kind!='swap' OR (backup_driver IS NOT NULL AND backup_driver<>driver_id))
);
GRANT SELECT,INSERT ON transport_driver_leave TO nexus_app;
GRANT UPDATE (state,decided_at,decided_by) ON transport_driver_leave TO nexus_app;

CREATE TABLE transport_driver_report_photo (
  institution_id uuid NOT NULL,
  disruption_id uuid NOT NULL,
  jpeg bytea NOT NULL CHECK(octet_length(jpeg) BETWEEN 100 AND 110000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(institution_id,disruption_id),
  FOREIGN KEY (institution_id,disruption_id) REFERENCES transport_disruption
);
GRANT SELECT,INSERT ON transport_driver_report_photo TO nexus_app;

CREATE TABLE transport_driver_reminder (
  institution_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  driver_id text NOT NULL REFERENCES "user",
  ref_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('duty','licence','fitness','insurance','permit','puc')),
  lead_minutes integer NOT NULL CHECK(lead_minutes IN (15,10080,43200)),
  due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(institution_id,driver_id,ref_id,kind,lead_minutes,due_at),
  FOREIGN KEY (institution_id,vehicle_id) REFERENCES transport_vehicle
);
GRANT SELECT ON transport_driver_reminder TO nexus_app;

CREATE FUNCTION public.transport_driver_enqueue_reminders()
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  WITH due AS (
    SELECT t.institution_id,t.vehicle_id,t.driver_id,t.id AS ref_id,'duty'::text AS kind,15 AS lead_minutes,
      t.scheduled_departure_at AS due_at
    FROM public.transport_trip t
    WHERE t.state='scheduled' AND t.driver_id IS NOT NULL AND t.scheduled_departure_at>statement_timestamp()
      AND t.scheduled_departure_at<=statement_timestamp()+interval '15 minutes'
    UNION ALL
    SELECT d.institution_id,d.vehicle_id,d.driver_id,d.id,d.kind,lead.days*1440,d.expiry::timestamp AT TIME ZONE 'Asia/Kolkata'
    FROM public.transport_driver_document d CROSS JOIN (VALUES (7),(30)) AS lead(days)
    WHERE d.expiry=(statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date+lead.days
  ), saved AS (
    INSERT INTO public.transport_driver_reminder(institution_id,vehicle_id,driver_id,ref_id,kind,lead_minutes,due_at)
    SELECT d.institution_id,d.vehicle_id,d.driver_id,d.ref_id,d.kind,d.lead_minutes,d.due_at
    FROM due d
    WHERE EXISTS (SELECT 1 FROM public.membership m WHERE m.institution_id=d.institution_id
      AND m.account_id=d.driver_id AND m.role='driver' AND m.ended_at IS NULL)
    AND EXISTS (SELECT 1 FROM public.transport_driver_phone p WHERE (p.institution_id,p.vehicle_id)=(d.institution_id,d.vehicle_id)
      AND p.phone_digest IS NOT NULL AND p.revoked_at IS NULL AND (p.primary_driver=d.driver_id OR p.backup_driver=d.driver_id))
    ON CONFLICT DO NOTHING RETURNING 1
  ) SELECT count(*) FROM saved;
$$;
REVOKE ALL ON FUNCTION public.transport_driver_enqueue_reminders() FROM PUBLIC,nexus_app;
GRANT EXECUTE ON FUNCTION public.transport_driver_enqueue_reminders() TO nexus_worker;

-- Keep the existing transport scheduler command working; its two previous result columns stay in place.
ALTER FUNCTION public.transport_scheduled_maintenance() RENAME TO transport_scheduled_maintenance_v1;
REVOKE ALL ON FUNCTION public.transport_scheduled_maintenance_v1() FROM PUBLIC,nexus_app,nexus_worker;
CREATE FUNCTION public.transport_scheduled_maintenance()
RETURNS TABLE (positions_removed bigint,office_messages bigint,driver_reminders bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT v.positions_removed,v.office_messages,public.transport_driver_enqueue_reminders()
  FROM public.transport_scheduled_maintenance_v1() v;
$$;
REVOKE ALL ON FUNCTION public.transport_scheduled_maintenance() FROM PUBLIC,nexus_app;
GRANT EXECUTE ON FUNCTION public.transport_scheduled_maintenance() TO nexus_worker;
