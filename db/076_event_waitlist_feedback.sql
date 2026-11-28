-- CL-044, CL-046: a waitlist for full club events, withdrawal that promotes the earliest waiting person,
-- and one feedback response per registered student after the event is completed.
CREATE TABLE club_waitlist (
  institution_id uuid NOT NULL,
  event_id uuid NOT NULL,
  account_id text NOT NULL REFERENCES "user",
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,event_id,account_id),
  FOREIGN KEY (institution_id,event_id) REFERENCES club_event
);
CREATE INDEX club_waitlist_order ON club_waitlist (institution_id,event_id,joined_at);
GRANT SELECT, INSERT, DELETE ON club_waitlist TO nexus_app;
GRANT DELETE ON club_registration TO nexus_app;

CREATE TABLE club_event_feedback (
  institution_id uuid NOT NULL,
  event_id uuid NOT NULL,
  account_id text NOT NULL REFERENCES "user",
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (length(comment) <= 1000),
  given_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,event_id,account_id),
  FOREIGN KEY (institution_id,event_id,account_id) REFERENCES club_registration
);
GRANT SELECT, INSERT ON club_event_feedback TO nexus_app;
