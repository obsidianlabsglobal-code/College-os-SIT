-- AD-020: leave and permission letters become requests on the shared case engine, owned by the office.
ALTER TABLE case_record DROP CONSTRAINT case_record_kind_check,
  ADD CONSTRAINT case_record_kind_check CHECK (kind IN ('support','grievance','facility','integrity','department','representation','letter'));

-- SL-010 / SL-011: a member's own display and notification preferences in one institution.
CREATE TABLE account_preference (
  institution_id uuid REFERENCES institution NOT NULL,
  account_id text NOT NULL REFERENCES "user",
  large_text boolean NOT NULL DEFAULT false,
  reduced_motion boolean NOT NULL DEFAULT false,
  discoverable boolean NOT NULL DEFAULT true,
  muted_kinds text[] NOT NULL DEFAULT '{}' CHECK (muted_kinds <@ ARRAY['assignment','reminder','result','class','correction','case','attendance','request','followup','escalation']),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,account_id)
);
GRANT SELECT, INSERT ON account_preference TO nexus_app;
GRANT UPDATE (large_text,reduced_motion,discoverable,muted_kinds,updated_at) ON account_preference TO nexus_app;

-- SL-015: support services the office publishes for every member, withdrawn rather than deleted.
CREATE TABLE support_service (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('accessibility','counselling','health','financial','academic','safety')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 1000),
  contact text NOT NULL CHECK (length(btrim(contact)) BETWEEN 1 AND 200),
  hours text NOT NULL CHECK (length(btrim(hours)) BETWEEN 1 AND 120),
  created_by text NOT NULL REFERENCES "user",
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  withdrawn_at timestamptz,
  PRIMARY KEY (institution_id,id)
);
GRANT SELECT, INSERT ON support_service TO nexus_app;
GRANT UPDATE (withdrawn_at) ON support_service TO nexus_app;
