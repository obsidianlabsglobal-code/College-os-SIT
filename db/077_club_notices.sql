-- CL-028: club officers publish notices to club members or to everyone eligible for the club; notices expire or are withdrawn.
CREATE TABLE club_notice (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL,
  author_id text NOT NULL REFERENCES "user",
  audience text NOT NULL CHECK (audience IN ('members','eligible')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_on date NOT NULL,
  withdrawn_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,club_id) REFERENCES club
);
CREATE INDEX club_notice_current ON club_notice (institution_id,club_id,expires_on) WHERE withdrawn_at IS NULL;
GRANT SELECT, INSERT ON club_notice TO nexus_app;
GRANT UPDATE (withdrawn_at) ON club_notice TO nexus_app;
