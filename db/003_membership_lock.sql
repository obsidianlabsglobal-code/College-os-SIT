-- PostgreSQL requires UPDATE on at least one column for SELECT FOR SHARE.
-- Limit the privilege to an identity column and reject changes at the table.
GRANT UPDATE (id) ON membership TO nexus_app;
CREATE FUNCTION guard_membership_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Membership identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER membership_identity_guard BEFORE UPDATE OF id ON membership
FOR EACH ROW EXECUTE FUNCTION guard_membership_identity();
