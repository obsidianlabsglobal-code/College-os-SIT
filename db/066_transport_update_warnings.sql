CREATE TABLE transport_update_warning (
  institution_id uuid NOT NULL,
  disruption_id uuid NOT NULL,
  notice_sequence integer NOT NULL,
  warned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (institution_id,disruption_id,notice_sequence),
  FOREIGN KEY (institution_id,disruption_id,notice_sequence) REFERENCES transport_disruption_notice
);
GRANT SELECT,INSERT ON transport_update_warning TO nexus_app;
