-- Pilot health: failed sign-ins through the app's forms, so the office can help someone who is locked out.
CREATE TABLE sign_in_failure (
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  method text NOT NULL CHECK (method IN ('password','code')),
  failed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sign_in_failure_recent ON sign_in_failure (failed_at);
GRANT SELECT, INSERT, DELETE ON sign_in_failure TO nexus_app;
