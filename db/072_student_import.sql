-- Student roster import (office): rows land as pending sign-up requests for section teachers to check, or are
-- pre-approved by the office. The same refusals as self sign-up apply.
ALTER TABLE roster_import DROP CONSTRAINT roster_import_kind_check,
  ADD CONSTRAINT roster_import_kind_check CHECK (kind IN ('teachers','students')),
  ADD COLUMN mode text CHECK (mode IS NULL OR mode IN ('pending','approved')),
  ADD CONSTRAINT roster_import_mode CHECK ((kind = 'students') = (mode IS NOT NULL));
