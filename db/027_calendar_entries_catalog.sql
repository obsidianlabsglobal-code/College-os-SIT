-- SA-010: institution-wide calendar dates (term dates, holidays, events) published by the office.
CREATE TABLE calendar_entry (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK (kind IN ('term','holiday','event','deadline')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  created_by text NOT NULL REFERENCES "user",
  withdrawn_at timestamptz,
  PRIMARY KEY (institution_id,id),
  CHECK (ends_on >= starts_on)
);
GRANT SELECT, INSERT ON calendar_entry TO nexus_app;
GRANT UPDATE (withdrawn_at) ON calendar_entry TO nexus_app;

-- SA-002: the office decides which offerings appear in the catalog. Existing offerings stay listed.
ALTER TABLE offering ADD COLUMN catalog_visible boolean NOT NULL DEFAULT true;
GRANT UPDATE (catalog_visible) ON offering TO nexus_app;
