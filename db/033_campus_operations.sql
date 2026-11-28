-- OP-002 / OP-014: a member requests a room or lab slot with a purpose; a student names a supervising teacher. The office
-- approves or declines with a reason. Approved bookings cannot overlap each other; class clashes are checked by the service.
CREATE TABLE facility_booking (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL,
  requester_id text NOT NULL REFERENCES "user",
  supervisor_id text REFERENCES "user",
  purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 1 AND 300),
  slot tstzrange NOT NULL CHECK (NOT isempty(slot) AND NOT lower_inf(slot) AND NOT upper_inf(slot)),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','approved','declined','cancelled')),
  decided_by text REFERENCES "user",
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,resource_id) REFERENCES campus_resource,
  CHECK (state = 'cancelled' OR (state = 'requested') = (decided_by IS NULL AND reason IS NULL)),
  CONSTRAINT facility_booking_overlap EXCLUDE USING gist (institution_id WITH =,resource_id WITH =,slot WITH &&) WHERE (state='approved')
);
GRANT SELECT, INSERT ON facility_booking TO nexus_app;
GRANT UPDATE (state,decided_by,reason) ON facility_booking TO nexus_app;

-- OP-004: library holdings with a copy count.
CREATE TABLE library_item (
  institution_id uuid REFERENCES institution NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  author text NOT NULL CHECK (length(btrim(author)) BETWEEN 1 AND 160),
  copies integer NOT NULL CHECK (copies BETWEEN 1 AND 500),
  created_by text NOT NULL REFERENCES "user",
  PRIMARY KEY (institution_id,id)
);
GRANT SELECT, INSERT ON library_item TO nexus_app;
GRANT UPDATE (copies) ON library_item TO nexus_app;

-- OP-003 / OP-004 / OP-005: the office issues a book copy or a piece of equipment to a current member with a due date, and
-- receives it back with its condition. Open equipment loans name the current custodian.
CREATE TABLE custody_loan (
  institution_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  book_id uuid,
  resource_id uuid,
  borrower_id text NOT NULL REFERENCES "user",
  due_on date NOT NULL,
  issued_by text NOT NULL REFERENCES "user",
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  returned_at timestamptz,
  received_by text REFERENCES "user",
  condition text CHECK (condition IN ('good','damaged','lost')),
  PRIMARY KEY (institution_id,id),
  FOREIGN KEY (institution_id,book_id) REFERENCES library_item,
  FOREIGN KEY (institution_id,resource_id) REFERENCES campus_resource,
  CHECK ((book_id IS NULL) <> (resource_id IS NULL)),
  CHECK ((returned_at IS NULL) = (received_by IS NULL AND condition IS NULL))
);
CREATE UNIQUE INDEX custody_one_open_equipment ON custody_loan (institution_id,resource_id) WHERE resource_id IS NOT NULL AND returned_at IS NULL;
GRANT SELECT, INSERT ON custody_loan TO nexus_app;
GRANT UPDATE (returned_at,received_by,condition) ON custody_loan TO nexus_app;
