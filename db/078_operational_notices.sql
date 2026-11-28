-- OP-010: a notice can be marked operational (maintenance or closure) and can end on a date; after that only its author sees it.
ALTER TABLE notice ADD COLUMN kind text NOT NULL DEFAULT 'general' CHECK (kind IN ('general','operational'));
ALTER TABLE notice ADD COLUMN expires_on date;
