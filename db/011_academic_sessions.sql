CREATE TABLE class_session (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  series_id uuid NOT NULL,
  offering_id uuid NOT NULL,
  section_id uuid NOT NULL,
  faculty_id text NOT NULL REFERENCES "user",
  room_id uuid NOT NULL,
  slot tstzrange NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','cancelled','conducted')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  change_reason text,
  created_by text NOT NULL REFERENCES "user",
  published_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,offering_id) REFERENCES offering,
  FOREIGN KEY (institution_id,section_id) REFERENCES section,
  FOREIGN KEY (institution_id,room_id) REFERENCES campus_resource,
  CHECK (NOT isempty(slot) AND NOT lower_inf(slot) AND NOT upper_inf(slot) AND lower_inc(slot) AND NOT upper_inc(slot)),
  CHECK ((state = 'draft') = (published_at IS NULL)),
  CONSTRAINT class_section_overlap EXCLUDE USING gist (institution_id WITH =,section_id WITH =,slot WITH &&) WHERE (state IN ('published','conducted')),
  CONSTRAINT class_faculty_overlap EXCLUDE USING gist (institution_id WITH =,faculty_id WITH =,slot WITH &&) WHERE (state IN ('published','conducted')),
  CONSTRAINT class_room_overlap EXCLUDE USING gist (institution_id WITH =,room_id WITH =,slot WITH &&) WHERE (state IN ('published','conducted'))
);
CREATE INDEX class_session_window ON class_session (institution_id,lower(slot));
CREATE INDEX class_session_series ON class_session (institution_id,series_id);

CREATE TABLE class_attendance_revision (
  institution_id uuid NOT NULL,
  session_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  actor_id text NOT NULL REFERENCES "user",
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text,
  CHECK (revision = 1 OR nullif(btrim(reason),'') IS NOT NULL),
  PRIMARY KEY (institution_id,session_id,revision),
  FOREIGN KEY (institution_id,session_id) REFERENCES class_session
);
CREATE TABLE class_attendance_mark (
  institution_id uuid NOT NULL,
  session_id uuid NOT NULL,
  revision integer NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  status text NOT NULL CHECK (status IN ('present','absent')),
  PRIMARY KEY (institution_id,session_id,revision,student_id),
  FOREIGN KEY (institution_id,session_id,revision) REFERENCES class_attendance_revision
);
CREATE INDEX class_attendance_student ON class_attendance_mark (institution_id,student_id,session_id,revision DESC);

GRANT SELECT,INSERT ON class_session,class_attendance_revision,class_attendance_mark TO nexus_app;
GRANT UPDATE (slot,state,revision,change_reason,published_at) ON class_session TO nexus_app;
