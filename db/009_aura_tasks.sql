CREATE TABLE aura_task (
  institution_id uuid NOT NULL, id uuid DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL, actor_id text NOT NULL REFERENCES "user",
  actor_role text NOT NULL CHECK (actor_role IN ('student','faculty')),
  agent text NOT NULL, agent_version integer NOT NULL CHECK (agent_version>0),
  provider text NOT NULL, payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  state text NOT NULL DEFAULT 'awaiting_approval' CHECK (state IN ('awaiting_approval','succeeded','cancelled')),
  event_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes', finished_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,club_id) REFERENCES club,
  FOREIGN KEY (institution_id,event_id) REFERENCES club_event,
  CHECK ((state='succeeded')=(event_id IS NOT NULL)),
  CHECK ((state='awaiting_approval')=(finished_at IS NULL))
);
CREATE INDEX aura_task_owner ON aura_task (institution_id,actor_id,created_at DESC);
CREATE INDEX aura_task_budget ON aura_task (institution_id,created_at DESC);
CREATE TABLE aura_approval (
  institution_id uuid NOT NULL, task_id uuid NOT NULL, decided_by text NOT NULL REFERENCES "user",
  decision text NOT NULL CHECK (decision IN ('confirmed','cancelled')),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,task_id),
  FOREIGN KEY (institution_id,task_id) REFERENCES aura_task
);
CREATE TABLE aura_invocation (
  institution_id uuid NOT NULL, task_id uuid NOT NULL, sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 2),
  tool text NOT NULL, duration_ms integer NOT NULL CHECK (duration_ms>=0),
  model_calls integer NOT NULL DEFAULT 0 CHECK (model_calls>=0),
  model_cost_micros bigint NOT NULL DEFAULT 0 CHECK (model_cost_micros>=0),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,task_id,sequence),
  FOREIGN KEY (institution_id,task_id) REFERENCES aura_task
);
GRANT SELECT,INSERT ON aura_task,aura_approval,aura_invocation TO nexus_app;
GRANT UPDATE (state,event_id,finished_at) ON aura_task TO nexus_app;
