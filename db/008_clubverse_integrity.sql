ALTER TABLE club_event ADD COLUMN published_at timestamptz;
UPDATE club_event SET published_at=starts_at WHERE state IN ('published','registration_open','registration_closed','in_progress','completed');
GRANT UPDATE (published_at) ON club_event TO nexus_app;
ALTER TABLE club_handover ADD COLUMN cancelled_at timestamptz;
ALTER TABLE club_handover ADD CHECK (num_nonnulls(approved_at,cancelled_at)<=1);
DROP INDEX club_pending_handover;
CREATE UNIQUE INDEX club_pending_handover ON club_handover (institution_id,club_id)
  WHERE approved_at IS NULL AND cancelled_at IS NULL;
GRANT UPDATE (cancelled_at) ON club_handover TO nexus_app;
ALTER TABLE audit_event ADD COLUMN subject_id text REFERENCES "user";
