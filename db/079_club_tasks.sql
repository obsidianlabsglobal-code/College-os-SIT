-- CL-047: club officers record meeting decisions as tasks with an owner (an active member) and a due date; the owner closes it.
CREATE TABLE club_task (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL,
  decided_on date NOT NULL,
  decision text NOT NULL CHECK (length(btrim(decision)) BETWEEN 1 AND 500),
  owner_id text NOT NULL REFERENCES "user",
  due_on date NOT NULL CHECK (due_on >= decided_on),
  created_by text NOT NULL REFERENCES "user",
  done_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,club_id) REFERENCES club,
  FOREIGN KEY (institution_id,club_id,owner_id) REFERENCES club_member
);
CREATE INDEX club_task_open ON club_task (institution_id,club_id,due_on) WHERE done_at IS NULL;
GRANT SELECT, INSERT ON club_task TO nexus_app;
GRANT UPDATE (done_at) ON club_task TO nexus_app;
