-- Student sign-up does not collect a bus stop: the transport module (dot/transport, TR-001 / TR-003) owns each student's
-- route and stop, and QR boarding checks only that record.
ALTER TABLE signup_request DROP COLUMN bus_stop;
ALTER TABLE person_detail DROP COLUMN bus_stop;
