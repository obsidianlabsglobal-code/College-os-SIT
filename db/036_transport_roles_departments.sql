-- Pilot foundation (integration session): transport office and driver roles, transport case kinds, and which
-- departments are switched on. Everything is built for every department; the office switches departments on.
ALTER TABLE membership DROP CONSTRAINT membership_role_check,
  ADD CONSTRAINT membership_role_check CHECK (role IN ('student','faculty','hod','admin','principal','transport','driver'));

-- TR-025 / TO-012 / TR-024: incidents and lost property, readable by the reporter and the transport office, which coordinates.
ALTER TABLE case_record DROP CONSTRAINT case_record_kind_check,
  ADD CONSTRAINT case_record_kind_check CHECK (kind IN ('support','grievance','facility','integrity','department','representation','letter',
    'transport_incident','lost_and_found'));

-- Departments are on unless the office switches them off; existing data keeps working. Changes are audited by the service.
ALTER TABLE department ADD COLUMN active boolean NOT NULL DEFAULT true;
GRANT UPDATE (active) ON department TO nexus_app;
