-- AD-019 / ID-008 slice: the office lends a bounded duty to a staff member until an expiry, and may revoke it early.
CREATE TABLE delegation (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  duty text NOT NULL CHECK (duty IN ('exam_cell','calendar')),
  delegate_id text NOT NULL REFERENCES "user",
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  granted_by text NOT NULL REFERENCES "user",
  starts_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by text REFERENCES "user",
  PRIMARY KEY (institution_id,id),
  CHECK (expires_at > starts_at),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX delegation_active ON delegation (institution_id,delegate_id,duty) WHERE revoked_at IS NULL;
GRANT SELECT, INSERT ON delegation TO nexus_app;
GRANT UPDATE (revoked_at,revoked_by) ON delegation TO nexus_app;

-- AD-011 / AD-012: certificates drafted from records with their sources, issued by an administrator with a
-- verification code, and revocable with a reason.
CREATE TABLE certificate (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES "user",
  kind text NOT NULL CHECK (kind IN ('bonafide','attendance','results')),
  body text NOT NULL,
  sources jsonb NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','issued','revoked')),
  drafted_by text NOT NULL REFERENCES "user",
  drafted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  issued_by text REFERENCES "user",
  issued_at timestamptz,
  verification_code text UNIQUE,
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IS NULL OR length(btrim(revoke_reason)) BETWEEN 1 AND 500),
  PRIMARY KEY (institution_id,id),
  CHECK ((state = 'draft') = (issued_at IS NULL)),
  CHECK ((state = 'draft') = (verification_code IS NULL)),
  CHECK ((state = 'revoked') = (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL))
);
GRANT SELECT, INSERT ON certificate TO nexus_app;
GRANT UPDATE (state,issued_by,issued_at,verification_code,revoked_at,revoke_reason) ON certificate TO nexus_app;

-- SL-014: opt-in study groups inside an offering, open to its current students.
CREATE TABLE study_group (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  capacity integer NOT NULL CHECK (capacity BETWEEN 2 AND 30),
  created_by text NOT NULL REFERENCES "user",
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,offering_id,name),
  FOREIGN KEY (institution_id,offering_id) REFERENCES offering
);
CREATE TABLE study_group_member (
  institution_id uuid NOT NULL,
  group_id uuid NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,group_id,student_id),
  FOREIGN KEY (institution_id,group_id) REFERENCES study_group
);
GRANT SELECT, INSERT, DELETE ON study_group, study_group_member TO nexus_app;
GRANT UPDATE (capacity) ON study_group TO nexus_app;

-- SL-009: a student's own profile fields and who may read them.
CREATE TABLE student_profile (
  institution_id uuid REFERENCES institution NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  bio text NOT NULL DEFAULT '' CHECK (length(bio) <= 1000),
  interests text NOT NULL DEFAULT '' CHECK (length(interests) <= 300),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','teachers','classmates')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,student_id)
);
GRANT SELECT, INSERT ON student_profile TO nexus_app;
GRANT UPDATE (bio,interests,visibility,updated_at) ON student_profile TO nexus_app;
