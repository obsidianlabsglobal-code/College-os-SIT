CREATE TABLE aura_tutor_usage (
  id uuid PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution,
  actor_id text NOT NULL REFERENCES "user",
  role text NOT NULL CHECK (role IN ('student','faculty')),
  topic text NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL CHECK (state IN ('reserved','answered','unconfirmed')),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  budget_microusd bigint NOT NULL CHECK (budget_microusd >= 0),
  provider_request text
);
CREATE INDEX aura_tutor_budget ON aura_tutor_usage (institution_id,created_at);
GRANT SELECT,INSERT ON aura_tutor_usage TO nexus_app;
GRANT UPDATE (state,input_tokens,output_tokens,budget_microusd,provider_request) ON aura_tutor_usage TO nexus_app;
