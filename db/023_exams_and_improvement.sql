-- SA-015 / SA-016 / AD-009 / AD-029 / LE-008: examination sittings scheduled by the office with a room and an invigilator.
-- Published sittings cannot overlap for the same section, room or invigilator. External sittings cite their official source.
CREATE TABLE exam_sitting (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL,
  section_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('internal','external')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  slot tstzrange NOT NULL CHECK (NOT isempty(slot) AND NOT lower_inf(slot) AND NOT upper_inf(slot)),
  room_id uuid NOT NULL,
  invigilator_id text NOT NULL REFERENCES "user",
  source text CHECK (source IS NULL OR length(btrim(source)) BETWEEN 1 AND 300),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','cancelled')),
  change_reason text,
  created_by text NOT NULL REFERENCES "user",
  published_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,offering_id) REFERENCES offering,
  FOREIGN KEY (institution_id,section_id) REFERENCES section,
  FOREIGN KEY (institution_id,room_id) REFERENCES campus_resource,
  CHECK (kind = 'internal' OR source IS NOT NULL),
  CHECK ((state = 'draft') = (published_at IS NULL)),
  CONSTRAINT exam_section_overlap EXCLUDE USING gist (institution_id WITH =,section_id WITH =,slot WITH &&) WHERE (state='published'),
  CONSTRAINT exam_room_overlap EXCLUDE USING gist (institution_id WITH =,room_id WITH =,slot WITH &&) WHERE (state='published'),
  CONSTRAINT exam_invigilator_overlap EXCLUDE USING gist (institution_id WITH =,invigilator_id WITH =,slot WITH &&) WHERE (state='published')
);
CREATE INDEX exam_sitting_window ON exam_sitting (institution_id,lower(slot));
GRANT SELECT, INSERT ON exam_sitting TO nexus_app;
GRANT UPDATE (state,change_reason,published_at,revision,room_id,invigilator_id) ON exam_sitting TO nexus_app;

-- LE-010 / LE-011 / DH-025: improvement actions with an accountable owner, a due date and dated progress updates.
CREATE TABLE improvement_action (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  department_id uuid,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  measure text NOT NULL CHECK (length(btrim(measure)) BETWEEN 1 AND 500),
  owner_id text NOT NULL REFERENCES "user",
  due_on date NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','done','dropped')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_by text NOT NULL REFERENCES "user",
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,department_id) REFERENCES department,
  CHECK ((state = 'open') = (closed_at IS NULL))
);
CREATE TABLE improvement_update (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL,
  author_id text NOT NULL REFERENCES "user",
  progress integer NOT NULL CHECK (progress BETWEEN 0 AND 100),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,action_id) REFERENCES improvement_action
);
GRANT SELECT, INSERT ON improvement_action, improvement_update TO nexus_app;
GRANT UPDATE (state,progress,closed_at,owner_id) ON improvement_action TO nexus_app;
