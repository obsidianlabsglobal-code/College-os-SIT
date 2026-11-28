-- Staff work queues: a request has one accountable staff owner. Assignment is audited and notifies the assignee
-- through the existing outbox. Starting review claims an unassigned request for the reviewer.
ALTER TABLE service_request ADD COLUMN assigned_to text REFERENCES "user"(id), ADD COLUMN assigned_at timestamptz,
  ADD CONSTRAINT service_request_assignment_pair CHECK ((assigned_to IS NULL) = (assigned_at IS NULL));
CREATE INDEX service_request_assignee ON service_request (institution_id,assigned_to,status) WHERE assigned_to IS NOT NULL;
GRANT UPDATE (assigned_to, assigned_at) ON service_request TO nexus_app;
INSERT INTO automation_rule (key,event_type,title,authority,workflow) VALUES
  ('request-assigned-notify','service_request.assigned','Tell the staff member a request has been assigned to them','L3','requests');
CREATE INDEX audit_event_search ON audit_event (institution_id,occurred_at DESC,id DESC);
