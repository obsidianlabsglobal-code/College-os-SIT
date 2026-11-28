-- SP-004: tell a student the coach's trial decision in their inbox. Mutable like any other notification kind (SL-010).
ALTER TABLE automation_rule DROP CONSTRAINT automation_rule_workflow_check,
  ADD CONSTRAINT automation_rule_workflow_check CHECK (workflow IN ('attendance','assignments','results','requests','timetable','cases','sports'));
INSERT INTO automation_rule (key,event_type,title,authority,workflow) VALUES
  ('sport-selected-notify','sport.player_selected','Tell a student they were selected for a team','L3','sports'),
  ('sport-declined-notify','sport.player_declined','Tell a student their trial was not successful','L3','sports');
ALTER TABLE account_preference DROP CONSTRAINT account_preference_muted_kinds_check,
  ADD CONSTRAINT account_preference_muted_kinds_check CHECK (muted_kinds <@ ARRAY['assignment','reminder','result','class','correction','case','attendance','request','followup','escalation','sport']);
