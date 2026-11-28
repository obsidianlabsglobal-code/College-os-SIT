-- SP-001–SP-011, SP-015–SP-017, SP-019–SP-021, SP-023: sports run by the office (admin) with assigned coaches and match officials.
CREATE TABLE sport_tournament (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  sport text NOT NULL CHECK (length(btrim(sport)) BETWEEN 1 AND 60),
  level text NOT NULL CHECK (level IN ('intramural','interdepartmental','intercollege')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  created_by text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,name),
  CHECK (ends_on >= starts_on)
);
-- An external team is an intercollege opponent: a name the office validated, with no players in this institution.
CREATE TABLE sport_team (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sport text NOT NULL CHECK (length(btrim(sport)) BETWEEN 1 AND 60),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  department_id uuid,
  external boolean NOT NULL DEFAULT false,
  coach_id text REFERENCES "user",
  trials_open boolean NOT NULL DEFAULT false,
  created_by text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,sport,name),
  FOREIGN KEY (institution_id,department_id) REFERENCES department,
  CHECK (NOT external OR (department_id IS NULL AND coach_id IS NULL AND NOT trials_open))
);
CREATE TABLE team_player (
  institution_id uuid NOT NULL,
  team_id uuid NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','selected','declined')),
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 500),
  decided_by text REFERENCES "user",
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  PRIMARY KEY (institution_id,team_id,student_id),
  FOREIGN KEY (institution_id,team_id) REFERENCES sport_team,
  CHECK ((state = 'requested') = (decided_at IS NULL))
);
CREATE TABLE tournament_entry (
  institution_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  team_id uuid NOT NULL,
  PRIMARY KEY (institution_id,tournament_id,team_id),
  FOREIGN KEY (institution_id,tournament_id) REFERENCES sport_tournament,
  FOREIGN KEY (institution_id,team_id) REFERENCES sport_team
);
CREATE TABLE sport_fixture (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  home_team_id uuid NOT NULL,
  away_team_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  official_id text NOT NULL REFERENCES "user",
  slot tstzrange NOT NULL CHECK (NOT isempty(slot) AND NOT lower_inf(slot) AND NOT upper_inf(slot)),
  state text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled','completed','cancelled')),
  home_score integer CHECK (home_score >= 0),
  away_score integer CHECK (away_score >= 0),
  result_reason text,
  result_by text REFERENCES "user",
  result_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_by text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,tournament_id) REFERENCES sport_tournament,
  FOREIGN KEY (institution_id,home_team_id) REFERENCES sport_team,
  FOREIGN KEY (institution_id,away_team_id) REFERENCES sport_team,
  FOREIGN KEY (institution_id,venue_id) REFERENCES campus_resource,
  CHECK (home_team_id <> away_team_id),
  CHECK ((state = 'completed') = (home_score IS NOT NULL AND away_score IS NOT NULL)),
  CONSTRAINT fixture_venue_overlap EXCLUDE USING gist (institution_id WITH =,venue_id WITH =,slot WITH &&) WHERE (state <> 'cancelled')
);
CREATE TABLE fixture_participant (
  institution_id uuid NOT NULL,
  fixture_id uuid NOT NULL,
  student_id text NOT NULL REFERENCES "user",
  verified_by text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,fixture_id,student_id),
  FOREIGN KEY (institution_id,fixture_id) REFERENCES sport_fixture
);
CREATE TABLE team_training (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  slot tstzrange NOT NULL CHECK (NOT isempty(slot) AND NOT lower_inf(slot) AND NOT upper_inf(slot)),
  created_by text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,team_id) REFERENCES sport_team,
  FOREIGN KEY (institution_id,venue_id) REFERENCES campus_resource,
  CONSTRAINT training_venue_overlap EXCLUDE USING gist (institution_id WITH =,venue_id WITH =,slot WITH &&)
);
CREATE TABLE team_announcement (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  author_id text NOT NULL REFERENCES "user",
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,team_id) REFERENCES sport_team
);
GRANT SELECT, INSERT ON sport_tournament, sport_team, team_player, tournament_entry, sport_fixture, fixture_participant, team_training, team_announcement TO nexus_app;
GRANT UPDATE (coach_id,trials_open) ON sport_team TO nexus_app;
GRANT UPDATE (state,reason,decided_by,decided_at) ON team_player TO nexus_app;
GRANT UPDATE (state,home_score,away_score,result_reason,result_by,result_at,revision) ON sport_fixture TO nexus_app;

-- SP-017: verified participation can be curated into a student's portfolio.
ALTER TABLE portfolio_item DROP CONSTRAINT portfolio_item_source_check,
  ADD CONSTRAINT portfolio_item_source_check CHECK (source IN ('certificate','milestone','result','participation'));
