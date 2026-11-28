-- Phone notifications (pilot plumbing for the transport 5-minute alert). The push service only receives an empty,
-- signed wake-up; the phone then fetches its own messages from NEXUS under the member's session.
CREATE TABLE push_subscription (
  institution_id uuid REFERENCES institution NOT NULL,
  account_id text NOT NULL REFERENCES "user",
  endpoint text NOT NULL CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,account_id,endpoint)
);
CREATE TABLE push_message (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id text NOT NULL REFERENCES "user",
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(body) <= 300),
  url text NOT NULL CHECK (url ~ '^/' AND length(url) <= 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  fetched_at timestamptz,
  PRIMARY KEY (institution_id,id)
);
CREATE INDEX push_message_unread ON push_message (account_id,created_at) WHERE fetched_at IS NULL;
GRANT SELECT, INSERT, DELETE ON push_subscription TO nexus_app;
GRANT SELECT, INSERT ON push_message TO nexus_app;
GRANT UPDATE (fetched_at) ON push_message TO nexus_app;
GRANT SELECT, INSERT, DELETE ON push_subscription TO nexus_worker;
GRANT SELECT, INSERT ON push_message TO nexus_worker;
