CREATE TABLE notice (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  author_id text REFERENCES "user"(id) NOT NULL,
  author_role text NOT NULL CHECK (author_role IN ('admin','hod','faculty')),
  department_id uuid,
  offering_id uuid,
  title text NOT NULL,
  body text NOT NULL,
  published_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,department_id) REFERENCES department,
  FOREIGN KEY (institution_id,offering_id) REFERENCES offering,
  CHECK ((author_role='admin' AND num_nonnulls(department_id,offering_id)=0)
    OR (author_role='hod' AND department_id IS NOT NULL AND offering_id IS NULL)
    OR (author_role='faculty' AND department_id IS NULL AND offering_id IS NOT NULL))
);
CREATE INDEX notice_published ON notice (institution_id,published_at DESC) WHERE published_at IS NOT NULL;

CREATE TABLE service_request (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  student_id text REFERENCES "user"(id) NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','in_progress','resolved','declined')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  handled_by text REFERENCES "user"(id),
  outcome text,
  closed_at timestamptz,
  PRIMARY KEY (institution_id,id),
  CHECK ((status='submitted') = (handled_by IS NULL)),
  CHECK ((status IN ('resolved','declined')) = (outcome IS NOT NULL AND closed_at IS NOT NULL))
);
CREATE INDEX service_request_queue ON service_request (institution_id,status,created_at);
CREATE INDEX service_request_student ON service_request (institution_id,student_id,created_at);
GRANT SELECT, INSERT ON notice, service_request TO nexus_app;
GRANT UPDATE (published_at) ON notice TO nexus_app;
GRANT UPDATE (status, handled_by, outcome, closed_at) ON service_request TO nexus_app;
