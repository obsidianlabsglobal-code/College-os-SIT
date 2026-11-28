CREATE TABLE transport_rider_preference (
  institution_id uuid NOT NULL REFERENCES institution,
  student_id text NOT NULL REFERENCES "user",
  phone_alerts boolean NOT NULL DEFAULT false,
  notice_language text NOT NULL DEFAULT 'en' CHECK (notice_language IN ('en','kn')),
  PRIMARY KEY (institution_id,student_id)
);
CREATE TABLE transport_pickup_alert (
  institution_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  student_id text NOT NULL,
  alerted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,trip_id,student_id),
  FOREIGN KEY (institution_id,trip_id,student_id) REFERENCES transport_trip_rider
);
GRANT SELECT,INSERT ON transport_rider_preference,transport_pickup_alert TO nexus_app;
GRANT UPDATE (phone_alerts,notice_language) ON transport_rider_preference TO nexus_app;
