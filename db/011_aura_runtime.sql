-- AURA runtime: one row per chat request with a truthful state machine, a per-call model ledger
-- and links to the existing approval-gated event task. Applied migrations stay immutable; this file is new.
CREATE TABLE aura_request (
  institution_id uuid NOT NULL REFERENCES institution, id uuid DEFAULT gen_random_uuid(),
  actor_id text NOT NULL REFERENCES "user",
  actor_role text NOT NULL CHECK (actor_role IN ('student','faculty')),
  nonce uuid NOT NULL,
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 600),
  route text CHECK (route IN ('direct','model','unsupported','unavailable')),
  capability text,
  state text NOT NULL DEFAULT 'created' CHECK (state IN (
    'created','interpreting','prepared','awaiting_confirmation','executing','succeeded','failed','cancelled')),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
  failure text,
  model_calls integer NOT NULL DEFAULT 0 CHECK (model_calls BETWEEN 0 AND 3),
  tool_calls integer NOT NULL DEFAULT 0 CHECK (tool_calls BETWEEN 0 AND 5),
  task_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,actor_id,nonce),
  FOREIGN KEY (institution_id,task_id) REFERENCES aura_task,
  CHECK ((state IN ('succeeded','failed','cancelled'))=(finished_at IS NOT NULL)),
  CHECK (state<>'failed' OR failure IS NOT NULL),
  CHECK (state NOT IN ('awaiting_confirmation') OR task_id IS NOT NULL)
);
CREATE INDEX aura_request_owner ON aura_request (institution_id,actor_id,created_at DESC);
CREATE INDEX aura_request_rate ON aura_request (institution_id,created_at DESC);

-- Spend is reserved at the worst-case estimate before a paid call and replaced by actual usage after it.
-- A call whose outcome is unknown (timeout, dropped connection) keeps its reservation as spent.
CREATE TABLE aura_model_call (
  institution_id uuid NOT NULL, request_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 3),
  provider text NOT NULL, model text NOT NULL, purpose text NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','succeeded','failed','indeterminate')),
  reserved_micros bigint NOT NULL CHECK (reserved_micros>0),
  cost_micros bigint CHECK (cost_micros>=0),
  provider_request_id text, input_tokens integer, output_tokens integer,
  cache_read_tokens integer, cache_write_tokens integer, stop_reason text,
  latency_ms integer CHECK (latency_ms>=0), failure text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
  PRIMARY KEY (institution_id,request_id,sequence),
  FOREIGN KEY (institution_id,request_id) REFERENCES aura_request,
  CHECK ((status='reserved')=(finished_at IS NULL)),
  CHECK (status<>'succeeded' OR (cost_micros IS NOT NULL AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL))
);
CREATE INDEX aura_model_call_spend ON aura_model_call (institution_id,created_at DESC);
CREATE INDEX aura_model_call_total ON aura_model_call (created_at DESC);

GRANT SELECT,INSERT ON aura_request,aura_model_call TO nexus_app;
GRANT UPDATE (route,capability,state,result,failure,model_calls,tool_calls,task_id,finished_at) ON aura_request TO nexus_app;
GRANT UPDATE (status,cost_micros,provider_request_id,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,
  stop_reason,latency_ms,failure,finished_at) ON aura_model_call TO nexus_app;
