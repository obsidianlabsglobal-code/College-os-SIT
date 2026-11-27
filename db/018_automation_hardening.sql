-- Automation hardening (review of 27 Nov): composite tenant keys, explicit rule states, cancellation,
-- deferral, operator audit, worker role, scheduled rules, versioned handlers and institution-specific effort evidence.

-- Tenant-consistent references: a job or notification can only point at an audit event of its own institution.
ALTER TABLE audit_event ADD CONSTRAINT audit_event_tenant_id UNIQUE (institution_id,id);
ALTER TABLE job DROP CONSTRAINT job_event_id_fkey,
  ADD CONSTRAINT job_event_tenant FOREIGN KEY (institution_id,event_id) REFERENCES audit_event (institution_id,id) ON DELETE CASCADE;
ALTER TABLE notification DROP CONSTRAINT notification_event_id_fkey,
  ADD CONSTRAINT notification_event_tenant FOREIGN KEY (institution_id,event_id) REFERENCES audit_event (institution_id,id) ON DELETE CASCADE;
-- One notification per recipient, event and kind (an escalation is distinct from the original routing).
ALTER TABLE notification DROP CONSTRAINT notification_institution_id_recipient_id_event_id_key,
  ADD CONSTRAINT notification_once UNIQUE (institution_id,recipient_id,event_id,kind);
-- Operator actions reference a rule or job, never a payload.
ALTER TABLE audit_event ADD COLUMN ref text CHECK (length(ref) <= 120);

-- Explicit lifecycle. paused = held (jobs wait, resume runs them); disabled = events no longer create jobs.
CREATE TABLE automation_setting (
  institution_id uuid REFERENCES institution NOT NULL,
  rule_key text REFERENCES automation_rule NOT NULL,
  state text NOT NULL CHECK (state IN ('active','paused','disabled')),
  changed_by text REFERENCES "user"(id) NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,rule_key)
);
INSERT INTO automation_setting (institution_id,rule_key,state,changed_by,changed_at)
  SELECT institution_id,rule_key,'paused',paused_by,paused_at FROM automation_pause;
DROP TABLE automation_pause;

ALTER TABLE job DROP CONSTRAINT job_status_check,
  ADD CONSTRAINT job_status_check CHECK (status IN ('queued','running','succeeded','skipped','cancelled','dead')),
  ADD COLUMN handler_version integer NOT NULL DEFAULT 1;

-- Handler versions make event contracts explicit; a changed handler gets a new version.
ALTER TABLE automation_rule ADD COLUMN handler_version integer NOT NULL DEFAULT 1,
  ADD COLUMN workflow text CHECK (workflow IN ('attendance','assignments','results','requests','timetable')),
  DROP COLUMN baseline_minutes;
UPDATE automation_rule SET workflow = CASE key
  WHEN 'assignment-published-notify' THEN 'assignments' WHEN 'grade-published-notify' THEN 'results' ELSE 'requests' END;
INSERT INTO automation_rule (key,event_type,title,authority,workflow) VALUES
  ('assignment-deadline-reminder','assignment.published','Remind students who have not submitted, 24 hours before the deadline','L3','assignments'),
  ('class-change-notify','class.moved','Tell enrolled students a class has moved','L3','timetable'),
  ('class-cancel-notify','class.cancelled','Tell enrolled students a class is cancelled','L3','timetable'),
  ('class-room-notify','class.room_changed','Tell enrolled students a class has a new room','L3','timetable'),
  ('attendance-summary-prepare','attendance.recorded','Prepare the attendance summary for the teacher to share','L1','attendance'),
  ('request-sla-escalate','service_request.submitted','Escalate a request still unreviewed after 48 hours','L3','requests');
ALTER TABLE automation_rule ALTER COLUMN workflow SET NOT NULL;

CREATE OR REPLACE FUNCTION enqueue_automation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO job (institution_id,event_id,rule_key,handler_version)
  SELECT NEW.institution_id,NEW.id,r.key,r.handler_version FROM automation_rule r
  WHERE r.event_type=NEW.action AND NOT EXISTS (
    SELECT 1 FROM automation_setting s WHERE s.institution_id=NEW.institution_id AND s.rule_key=r.key AND s.state='disabled')
  ON CONFLICT DO NOTHING;
  IF FOUND THEN PERFORM pg_notify('nexus_jobs',''); END IF;  -- wake listening workers; polling remains the fallback
  RETURN NULL;
END $$;

-- Effort evidence per institution and workflow. 'synthetic' rows are labelled engineering rehearsals, never pilot results.
CREATE TABLE automation_effort_sample (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  workflow text NOT NULL CHECK (workflow IN ('attendance','assignments','results','requests','timetable')),
  phase text NOT NULL CHECK (phase IN ('baseline','post')),
  quality text NOT NULL CHECK (quality IN ('synthetic','measured')),
  cases integer NOT NULL CHECK (cases > 0),
  human_minutes numeric NOT NULL CHECK (human_minutes >= 0),  -- includes review, correction, exceptions and recovery
  method text NOT NULL CHECK (length(method) BETWEEN 1 AND 500),
  recorded_by text REFERENCES "user"(id) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id)
);

-- Least-privilege worker role. Login and password are provisioned outside migrations (like nexus_app).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nexus_worker') THEN CREATE ROLE nexus_worker NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO nexus_worker;
GRANT SELECT ON institution, membership, assignment, submission, grade, roster, offering, course, section, service_request,
  class_session, class_attendance_revision, class_attendance_mark, campus_resource, audit_event, automation_rule, automation_setting TO nexus_worker;
GRANT SELECT, UPDATE ON job TO nexus_worker;
GRANT INSERT ON notification TO nexus_worker;
GRANT SELECT, INSERT, UPDATE ON worker_heartbeat TO nexus_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON automation_setting TO nexus_app;
GRANT SELECT, INSERT ON automation_effort_sample TO nexus_app;
GRANT UPDATE (status) ON job TO nexus_app;
