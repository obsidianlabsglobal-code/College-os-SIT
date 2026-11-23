CREATE TABLE opportunity_listing (
  institution_id uuid NOT NULL REFERENCES institution,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('internship','scholarship','competition')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 140),
  sponsor text NOT NULL CHECK (length(trim(sponsor)) BETWEEN 1 AND 140),
  eligibility text NOT NULL CHECK (length(trim(eligibility)) BETWEEN 1 AND 1500),
  source_url text NOT NULL CHECK (length(source_url)<=2048 AND source_url LIKE 'https://%'),
  deadline date NOT NULL,
  verified_by text NOT NULL REFERENCES "user",
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  withdrawn_at timestamptz,
  withdrawn_by text REFERENCES "user",
  withdrawal_reason text,
  CHECK ((withdrawn_at IS NULL)=(withdrawn_by IS NULL) AND
    ((withdrawn_at IS NULL AND withdrawal_reason IS NULL) OR
    (withdrawn_at IS NOT NULL AND withdrawal_reason IS NOT NULL AND length(trim(withdrawal_reason)) BETWEEN 1 AND 300))),
  PRIMARY KEY (institution_id,id)
);
CREATE INDEX opportunity_deadlines ON opportunity_listing(institution_id,deadline,id) WHERE withdrawn_at IS NULL;
GRANT SELECT,INSERT ON opportunity_listing TO nexus_app;
GRANT UPDATE(withdrawn_at,withdrawn_by,withdrawal_reason) ON opportunity_listing TO nexus_app;
