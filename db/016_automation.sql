-- Durable automation: transactional outbox (trigger on audit_event, same transaction as the domain write),
-- leased jobs, in-app notifications and worker liveness. Rules are code-defined handlers; institutions can pause them.
CREATE TABLE automation_rule (
  key text PRIMARY KEY,
  event_type text NOT NULL,
  title text NOT NULL,
  authority text NOT NULL CHECK (authority IN ('L0','L1','L2','L3')),
  baseline_minutes numeric CHECK (baseline_minutes >= 0)  -- per case; NULL until measured
);
INSERT INTO automation_rule (key,event_type,title,authority) VALUES
  ('assignment-published-notify','assignment.published','Tell enrolled students about a newly published assignment','L3'),
  ('grade-published-notify','grade.published','Tell a student their result is published','L3'),
  ('request-submitted-route','service_request.submitted','Route a new service request to the office queue','L3');

CREATE TABLE automation_pause (
  institution_id uuid REFERENCES institution NOT NULL,
  rule_key text REFERENCES automation_rule NOT NULL,
  paused_by text REFERENCES "user"(id) NOT NULL,
  paused_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,rule_key)
);

CREATE TABLE job (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id uuid REFERENCES institution NOT NULL,
  event_id bigint REFERENCES audit_event NOT NULL,
  rule_key text REFERENCES automation_rule NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','skipped','dead')),
  attempt integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_until timestamptz,
  lease_token uuid,
  last_error text,
  outcome jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  UNIQUE (institution_id,event_id,rule_key)
);
CREATE INDEX job_runnable ON job (run_after) WHERE status IN ('queued','running');

CREATE TABLE notification (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  recipient_id text REFERENCES "user"(id) NOT NULL,
  event_id bigint REFERENCES audit_event NOT NULL,
  kind text NOT NULL,
  entity_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) <= 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,recipient_id,event_id)
);
CREATE INDEX notification_inbox ON notification (institution_id,recipient_id,created_at DESC);

CREATE TABLE worker_heartbeat (worker text PRIMARY KEY, seen_at timestamptz NOT NULL);

CREATE FUNCTION enqueue_automation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO job (institution_id,event_id,rule_key)
  SELECT NEW.institution_id,NEW.id,r.key FROM automation_rule r WHERE r.event_type=NEW.action
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER audit_event_automation AFTER INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION enqueue_automation();

GRANT SELECT ON automation_rule TO nexus_app;
GRANT SELECT, INSERT, DELETE ON automation_pause TO nexus_app;
GRANT SELECT, INSERT ON job TO nexus_app;
GRANT UPDATE (status,attempt,run_after,lease_until,lease_token,last_error,outcome,finished_at) ON job TO nexus_app;
GRANT SELECT, INSERT ON notification TO nexus_app;
GRANT UPDATE (read_at) ON notification TO nexus_app;
GRANT SELECT, INSERT, UPDATE ON worker_heartbeat TO nexus_app;
