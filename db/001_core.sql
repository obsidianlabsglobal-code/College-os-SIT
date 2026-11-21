CREATE TABLE institution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata'
);
CREATE TABLE department (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  name text NOT NULL,
  PRIMARY KEY (institution_id,id)
);
CREATE TABLE membership (
  institution_id uuid REFERENCES institution NOT NULL,
  account_id text REFERENCES "user"(id) NOT NULL,
  role text NOT NULL CHECK (role IN ('student','faculty','hod','admin')),
  department_id uuid,
  ended_at timestamptz,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  UNIQUE NULLS NOT DISTINCT (institution_id,account_id,role,department_id),
  FOREIGN KEY (institution_id,department_id) REFERENCES department,
  CHECK ((role = 'hod') = (department_id IS NOT NULL))
);
CREATE TABLE course (
  institution_id uuid NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,department_id) REFERENCES department
);
CREATE TABLE academic_scheme (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  name text NOT NULL,
  PRIMARY KEY (institution_id,id)
);
CREATE TABLE academic_term (
  institution_id uuid NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  scheme_id uuid NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,scheme_id) REFERENCES academic_scheme
);
CREATE TABLE section (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  name text NOT NULL,
  PRIMARY KEY (institution_id,id)
);
CREATE TABLE offering (
  institution_id uuid NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  section_id uuid NOT NULL,
  term_id uuid NOT NULL,
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,course_id,section_id,term_id),
  FOREIGN KEY (institution_id,course_id) REFERENCES course,
  FOREIGN KEY (institution_id,section_id) REFERENCES section,
  FOREIGN KEY (institution_id,term_id) REFERENCES academic_term
);
CREATE TABLE roster (
  institution_id uuid NOT NULL,
  offering_id uuid NOT NULL,
  account_id text REFERENCES "user"(id) NOT NULL,
  role text NOT NULL CHECK (role IN ('student','faculty')),
  ended_at timestamptz,
  PRIMARY KEY (institution_id,offering_id,account_id,role),
  FOREIGN KEY (institution_id,offering_id) REFERENCES offering
);
CREATE TABLE assignment (
  institution_id uuid NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  deadline timestamptz NOT NULL,
  max_marks integer NOT NULL CHECK (max_marks > 0),
  rubric text,
  published_at timestamptz,
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,offering_id) REFERENCES offering
);
CREATE TABLE submission (
  institution_id uuid NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  student_id text REFERENCES "user"(id) NOT NULL,
  body text,
  submitted_at timestamptz NOT NULL,
  request_id uuid NOT NULL,
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,assignment_id,student_id),
  FOREIGN KEY (institution_id,assignment_id) REFERENCES assignment
);
CREATE TABLE grade (
  institution_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  marks integer NOT NULL CHECK (marks >= 0),
  feedback text NOT NULL,
  reason text,
  published_at timestamptz,
  PRIMARY KEY (institution_id,submission_id,revision),
  FOREIGN KEY (institution_id,submission_id) references submission
);
CREATE UNIQUE INDEX one_grade_draft ON grade (institution_id,submission_id) WHERE published_at IS NULL;
CREATE TABLE attachment (
  institution_id uuid NOT NULL,
  id uuid DEFAULT gen_random_uuid(),
  assignment_id uuid,
  submission_id uuid,
  filename text NOT NULL,
  mime text NOT NULL CHECK (mime IN ('text/plain','application/pdf')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 5242880),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,assignment_id) REFERENCES assignment,
  FOREIGN KEY (institution_id,submission_id) REFERENCES submission,
  CHECK (num_nonnulls(assignment_id,submission_id) = 1)
);
CREATE TABLE audit_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id uuid REFERENCES institution NOT NULL,
  actor_id text REFERENCES "user"(id) NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  revision integer,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX assignment_offering ON assignment (institution_id,offering_id);
CREATE INDEX membership_account ON membership (account_id) WHERE ended_at IS NULL;
CREATE INDEX roster_account ON roster (institution_id,account_id,role) WHERE ended_at IS NULL;
CREATE INDEX attachment_assignment ON attachment (institution_id,assignment_id);
CREATE INDEX attachment_submission ON attachment (institution_id,submission_id);
