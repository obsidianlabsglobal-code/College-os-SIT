-- ID-014: universal search. pg_trgm scores typos against rows each reader has already access-checked (no GIN index:
-- search never scans a table unscoped). The office keeps its own related-word groups; each person's recent searches.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE search_synonym (
  institution_id uuid NOT NULL REFERENCES institution,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  words text[] NOT NULL CHECK (cardinality(words) BETWEEN 2 AND 12),
  created_by text NOT NULL REFERENCES "user",
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id)
);
GRANT SELECT, INSERT, DELETE ON search_synonym TO nexus_app;

CREATE TABLE search_recent (
  institution_id uuid NOT NULL REFERENCES institution,
  account_id text NOT NULL REFERENCES "user",
  query text NOT NULL CHECK (length(query) BETWEEN 2 AND 120),
  searched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,account_id,query)
);
GRANT SELECT, INSERT, DELETE ON search_recent TO nexus_app;
GRANT UPDATE (searched_at) ON search_recent TO nexus_app;
