-- OP-011: safety incidents reported by any member, coordinated by the office, escalated when unassigned past 24 hours.
ALTER TABLE case_record DROP CONSTRAINT case_record_kind_check,
  ADD CONSTRAINT case_record_kind_check CHECK (kind IN ('support','grievance','facility','integrity','department','representation','letter',
    'transport_incident','lost_and_found','safety'));
