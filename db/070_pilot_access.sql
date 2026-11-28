-- Pilot access (cc/pilot-access): teacher import, email sign-in limits, student sign-up with teacher approval, consent.
-- Built for every department; department.active (db/036) decides who may join.

-- Contact and identity details a member gives the college; read by the office and, for students, by their approvers.
CREATE TABLE person_detail (
  institution_id uuid REFERENCES institution NOT NULL,
  account_id text NOT NULL REFERENCES "user",
  phone text CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ]{7,16}$'),
  usn text CHECK (usn IS NULL OR usn ~ '^[A-Z0-9]{6,16}$'),
  semester smallint CHECK (semester IS NULL OR semester BETWEEN 1 AND 10),
  bus_stop text CHECK (bus_stop IS NULL OR length(btrim(bus_stop)) BETWEEN 1 AND 80),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,account_id)
);
CREATE UNIQUE INDEX person_detail_usn ON person_detail (institution_id,usn) WHERE usn IS NOT NULL;
GRANT SELECT, INSERT ON person_detail TO nexus_app;
GRANT UPDATE (phone,usn,semester,bus_stop,updated_at) ON person_detail TO nexus_app;

-- Class mentors: a teacher responsible for a section, who may approve its students.
CREATE TABLE section_mentor (
  institution_id uuid NOT NULL,
  section_id uuid NOT NULL,
  account_id text NOT NULL REFERENCES "user",
  assigned_by text NOT NULL REFERENCES "user",
  assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  PRIMARY KEY (institution_id,section_id,account_id),
  FOREIGN KEY (institution_id,section_id) REFERENCES section
);
GRANT SELECT, INSERT ON section_mentor TO nexus_app;
GRANT UPDATE (ended_at) ON section_mentor TO nexus_app;

-- ID-012: an import is previewed (validated rows stored), then applied exactly as previewed after the office confirms.
CREATE TABLE roster_import (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind = 'teachers'),
  rows jsonb NOT NULL,
  state text NOT NULL DEFAULT 'previewed' CHECK (state IN ('previewed','applied','discarded')),
  created_by text NOT NULL REFERENCES "user",
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  applied_at timestamptz,
  PRIMARY KEY (institution_id,id),
  CHECK ((state = 'applied') = (applied_at IS NOT NULL))
);
GRANT SELECT, INSERT ON roster_import TO nexus_app;
GRANT UPDATE (state,applied_at) ON roster_import TO nexus_app;

-- AD-002: per-email limit on sign-in codes (the auth library limits per address).
CREATE TABLE sign_in_code_request (
  email text NOT NULL CHECK (email = lower(btrim(email))),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sign_in_code_request_recent ON sign_in_code_request (email,requested_at);
GRANT SELECT, INSERT, DELETE ON sign_in_code_request TO nexus_app;

-- Local and test mail (console adapter only). Never used once a real provider is configured.
CREATE TABLE dev_mailbox (
  id bigserial PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT, INSERT ON dev_mailbox TO nexus_app;
GRANT USAGE ON SEQUENCE dev_mailbox_id_seq TO nexus_app;

-- Student sign-up: a signed-in (email-verified) person asks to join a section; a teacher of that section decides.
CREATE TABLE signup_request (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id text NOT NULL REFERENCES "user",
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  usn text NOT NULL CHECK (usn ~ '^[A-Z0-9]{6,16}$'),
  semester smallint NOT NULL CHECK (semester BETWEEN 1 AND 10),
  section_id uuid NOT NULL,
  term_id uuid NOT NULL,
  phone text CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ]{7,16}$'),
  bus_stop text CHECK (bus_stop IS NULL OR length(btrim(bus_stop)) BETWEEN 1 AND 80),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected')),
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 300),
  decided_by text REFERENCES "user",
  decided_at timestamptz,
  admission_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,section_id) REFERENCES section,
  FOREIGN KEY (institution_id,term_id) REFERENCES academic_term,
  CHECK ((state = 'pending') = (decided_by IS NULL AND decided_at IS NULL)),
  CHECK (state <> 'rejected' OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX signup_request_open_account ON signup_request (institution_id,account_id) WHERE state IN ('pending','approved');
CREATE UNIQUE INDEX signup_request_open_usn ON signup_request (institution_id,usn) WHERE state IN ('pending','approved');
GRANT SELECT, INSERT ON signup_request TO nexus_app;
GRANT UPDATE (state,reason,decided_by,decided_at,admission_id) ON signup_request TO nexus_app;

-- Consent: an institution can require members to accept the current privacy notice before using a workspace.
ALTER TABLE institution ADD COLUMN consent_required boolean NOT NULL DEFAULT false;
CREATE TABLE consent_record (
  institution_id uuid REFERENCES institution NOT NULL,
  account_id text NOT NULL REFERENCES "user",
  notice_version text NOT NULL CHECK (notice_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?$'),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,account_id,notice_version)
);
GRANT SELECT, INSERT ON consent_record TO nexus_app;
GRANT UPDATE (consent_required) ON institution TO nexus_app;
