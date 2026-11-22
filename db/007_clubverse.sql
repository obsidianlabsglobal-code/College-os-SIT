CREATE TABLE club_category (
  id text PRIMARY KEY, label text NOT NULL
);
INSERT INTO club_category VALUES ('technical','Technical and engineering'),('academic','Academic and research'),('enterprise','Entrepreneurship and professional'),('sports','Sports'),('creative','Cultural and creative'),('service','Service and leadership'),('faculty','Faculty and staff'),('special','Special-purpose');
CREATE TABLE club_template (
  id text PRIMARY KEY, category_id text NOT NULL REFERENCES club_category, label text NOT NULL
);
INSERT INTO club_template VALUES ('general','special','General community'),('technical-society','technical','Technical society'),('sports-team','sports','Sports team'),('research-circle','academic','Research circle');
CREATE TABLE club_proposal (
  institution_id uuid REFERENCES institution, id uuid DEFAULT gen_random_uuid(),
  founder_id text NOT NULL REFERENCES "user", category_id text NOT NULL REFERENCES club_category,
  template_id text REFERENCES club_template, name text NOT NULL, purpose text NOT NULL, rules text NOT NULL,
  joining text NOT NULL CHECK (joining IN ('open','approval','invitation')),
  audience text NOT NULL CHECK (audience IN ('students','faculty','campus')),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','under_review','changes_requested','approved','rejected')),
  revision integer NOT NULL DEFAULT 0, review_note text, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id,id)
);
CREATE TABLE club (
  institution_id uuid NOT NULL, id uuid NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','suspended','archived')),
  PRIMARY KEY (institution_id,id), FOREIGN KEY (institution_id,id) REFERENCES club_proposal
);
CREATE UNIQUE INDEX club_recognized_name ON club_proposal (institution_id,lower(name)) WHERE state='approved';
CREATE TABLE club_member (
  institution_id uuid NOT NULL, club_id uuid NOT NULL, account_id text NOT NULL REFERENCES "user",
  state text NOT NULL CHECK (state IN ('requested','invited','active','declined','ended')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id,club_id,account_id),
  FOREIGN KEY (institution_id,club_id) REFERENCES club
);
CREATE TABLE club_grant (
  institution_id uuid NOT NULL, id uuid DEFAULT gen_random_uuid(), club_id uuid NOT NULL,
  account_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('lead','officer','advisor')),
  granted_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,club_id,account_id) REFERENCES club_member,
  CHECK (ended_at IS NULL OR ended_at >= granted_at)
);
CREATE UNIQUE INDEX club_active_grant ON club_grant (institution_id,club_id,account_id,kind) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX club_single_lead ON club_grant (institution_id,club_id) WHERE kind='lead' AND ended_at IS NULL;
CREATE TABLE club_handover (
  institution_id uuid NOT NULL, id uuid DEFAULT gen_random_uuid(), club_id uuid NOT NULL,
  outgoing_id text NOT NULL, incoming_id text NOT NULL, notes text NOT NULL, approved_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,club_id,outgoing_id) REFERENCES club_member,
  FOREIGN KEY (institution_id,club_id,incoming_id) REFERENCES club_member,
  CHECK (outgoing_id <> incoming_id)
);
CREATE UNIQUE INDEX club_pending_handover ON club_handover (institution_id,club_id) WHERE approved_at IS NULL;
CREATE TABLE club_event (
  institution_id uuid NOT NULL, id uuid DEFAULT gen_random_uuid(), club_id uuid NOT NULL,
  author_id text NOT NULL REFERENCES "user", title text NOT NULL, location text NOT NULL, requirements text NOT NULL,
  audience text NOT NULL CHECK (audience IN ('club','eligible')),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 10000),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','pending_approval','approved','published','registration_open','registration_closed','in_progress','completed','cancelled')),
  revision integer NOT NULL DEFAULT 0,
  PRIMARY KEY (institution_id,id), FOREIGN KEY (institution_id,club_id) REFERENCES club,
  CHECK (ends_at > starts_at)
);
CREATE TABLE club_registration (
  institution_id uuid NOT NULL, event_id uuid NOT NULL, account_id text NOT NULL REFERENCES "user",
  registered_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz, verified_by text REFERENCES "user",
  evidence text, PRIMARY KEY (institution_id,event_id,account_id),
  FOREIGN KEY (institution_id,event_id) REFERENCES club_event,
  CHECK ((verified_at IS NULL AND verified_by IS NULL AND evidence IS NULL) OR
         (verified_at IS NOT NULL AND verified_by IS NOT NULL AND evidence IS NOT NULL))
);
CREATE INDEX club_proposal_founder ON club_proposal (institution_id,founder_id);
CREATE INDEX club_event_parent ON club_event (institution_id,club_id,starts_at);
GRANT SELECT ON club_category,club_template TO nexus_app;
GRANT SELECT,INSERT ON club_proposal,club,club_member,club_grant,club_event,club_registration,club_handover TO nexus_app;
GRANT UPDATE (name,purpose,rules,category_id,template_id,joining,audience,state,revision,review_note) ON club_proposal TO nexus_app;
GRANT UPDATE (state) ON club TO nexus_app;
GRANT UPDATE (state,updated_at) ON club_member TO nexus_app;
GRANT UPDATE (ended_at) ON club_grant TO nexus_app;
GRANT UPDATE (state,revision) ON club_event TO nexus_app;
GRANT UPDATE (verified_at,verified_by,evidence) ON club_registration TO nexus_app;
GRANT UPDATE (approved_at) ON club_handover TO nexus_app;
