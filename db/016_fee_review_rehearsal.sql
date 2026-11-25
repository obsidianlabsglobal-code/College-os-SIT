-- Immutable review evidence, not a financial ledger or payment record.
CREATE TABLE fee_review_rehearsal (
  institution_id uuid NOT NULL REFERENCES institution,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sample_key text NOT NULL CHECK (sample_key = 'fee-review-demo-v1'),
  submitted_by text NOT NULL REFERENCES "user"(id),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object' AND octet_length(evidence::text) <= 12000),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,id),
  UNIQUE (institution_id,sample_key),
  UNIQUE (institution_id,id,evidence_sha256,submitted_by)
);
CREATE TABLE fee_review_rehearsal_approval (
  institution_id uuid NOT NULL,
  review_id uuid NOT NULL,
  evidence_sha256 text NOT NULL,
  submitted_by text NOT NULL,
  approved_by text NOT NULL REFERENCES "user"(id),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,review_id),
  FOREIGN KEY (institution_id,review_id,evidence_sha256,submitted_by)
    REFERENCES fee_review_rehearsal (institution_id,id,evidence_sha256,submitted_by),
  CHECK (approved_by <> submitted_by)
);
GRANT SELECT, INSERT ON fee_review_rehearsal, fee_review_rehearsal_approval TO nexus_app;
