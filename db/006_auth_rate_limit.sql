CREATE TABLE "rateLimit" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "count" integer NOT NULL,
  "lastRequest" bigint NOT NULL
);
CREATE INDEX auth_rate_limit_last_request ON "rateLimit" ("lastRequest");
GRANT SELECT, INSERT, UPDATE, DELETE ON "rateLimit" TO nexus_app;
