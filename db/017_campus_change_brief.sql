-- A replacement must be explicitly approved for the source room by the institution.
-- No application write grant: first configuration belongs to the institution operator.
CREATE TABLE teaching_room_alternative (
  institution_id uuid NOT NULL,
  source_room_id uuid NOT NULL,
  replacement_room_id uuid NOT NULL,
  PRIMARY KEY (institution_id,source_room_id,replacement_room_id),
  FOREIGN KEY (institution_id,source_room_id) REFERENCES campus_resource,
  FOREIGN KEY (institution_id,replacement_room_id) REFERENCES campus_resource,
  CHECK(source_room_id <> replacement_room_id)
);

CREATE TABLE class_room_change (
  institution_id uuid NOT NULL,
  session_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision>0),
  from_room_id uuid NOT NULL,
  to_room_id uuid NOT NULL,
  from_room_name text NOT NULL,
  to_room_name text NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
  actor_id text NOT NULL REFERENCES "user"(id),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,session_id,revision),
  FOREIGN KEY (institution_id,session_id) REFERENCES class_session,
  FOREIGN KEY (institution_id,from_room_id) REFERENCES campus_resource,
  FOREIGN KEY (institution_id,to_room_id) REFERENCES campus_resource,
  CHECK(from_room_id <> to_room_id)
);
GRANT SELECT ON teaching_room_alternative TO nexus_app;
GRANT SELECT,INSERT ON class_room_change TO nexus_app;
GRANT UPDATE (room_id) ON class_session TO nexus_app;
