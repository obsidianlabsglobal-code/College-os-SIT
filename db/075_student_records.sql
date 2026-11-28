-- AD-005: the office corrects a member's college details with a reason; every change keeps the old and new value.
CREATE TABLE person_detail_change (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id text NOT NULL REFERENCES "user",
  field text NOT NULL CHECK (field IN ('usn','semester','phone')),
  old_value text,
  new_value text,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 300),
  changed_by text NOT NULL REFERENCES "user",
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id)
);
GRANT SELECT, INSERT ON person_detail_change TO nexus_app;
