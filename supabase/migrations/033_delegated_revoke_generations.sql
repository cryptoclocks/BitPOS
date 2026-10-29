-- Apply transactionally after 031/032, before deploying generation-aware API.
-- Existing rows/bytes/signatures/states remain generation 1. No journal is copied,
-- replaced or deleted. The existing tenant RLS, grants and composite grant FK stay.
-- Rollback is operational: disable new revoke admission, keep this schema and the
-- generation-aware reconciler until pending signatures settle. Do not downgrade
-- to 031 API or drop generations after retries: that would lose financial history.
SET search_path TO bitpos,public;
ALTER TABLE delegated_lifecycle ADD COLUMN generation integer NOT NULL DEFAULT 1 CHECK(generation>0);
ALTER TABLE delegated_lifecycle DROP CONSTRAINT delegated_lifecycle_pkey;
ALTER TABLE delegated_lifecycle ADD PRIMARY KEY(merchant_id,grant_id,kind,generation);
ALTER TABLE delegated_lifecycle ADD CHECK(kind='revoke' OR generation=1);
CREATE UNIQUE INDEX delegated_lifecycle_pending ON delegated_lifecycle(merchant_id,grant_id,kind) WHERE state IN ('PREPARED','SIGNED');
CREATE FUNCTION guard_delegated_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE previous delegated_lifecycle;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable delegated lifecycle'; END IF;
 IF TG_OP='INSERT' THEN
  -- Serialize admission with API/reconciliation and concurrent inserts.
  PERFORM 1 FROM delegated_grants WHERE merchant_id=NEW.merchant_id AND id=NEW.grant_id FOR UPDATE;
  SELECT * INTO previous FROM delegated_lifecycle WHERE merchant_id=NEW.merchant_id AND grant_id=NEW.grant_id AND kind=NEW.kind ORDER BY generation DESC LIMIT 1;
  IF NEW.state<>'PREPARED' OR NEW.signed_base64 IS NOT NULL OR NEW.generation<>coalesce(previous.generation,0)+1
   OR previous.generation IS NOT NULL AND (NEW.kind<>'revoke' OR previous.state NOT IN ('EXPIRED','FAILED')) THEN
   RAISE EXCEPTION 'unresolved delegated lifecycle generation';
  END IF;
 ELSE
  IF (NEW.merchant_id,NEW.grant_id,NEW.kind,NEW.generation,NEW.unsigned_base64,NEW.blockhash,NEW.last_valid_height,NEW.signature)
   IS DISTINCT FROM (OLD.merchant_id,OLD.grant_id,OLD.kind,OLD.generation,OLD.unsigned_base64,OLD.blockhash,OLD.last_valid_height,OLD.signature)
   OR OLD.signed_base64 IS NOT NULL AND NEW.signed_base64 IS DISTINCT FROM OLD.signed_base64
   OR OLD.state IN ('FINALIZED','FAILED','EXPIRED') AND NEW IS DISTINCT FROM OLD
   OR OLD.state='SIGNED' AND NEW.state='PREPARED'
   OR NEW.state='SIGNED' AND NEW.signed_base64 IS NULL THEN
   RAISE EXCEPTION 'immutable delegated lifecycle';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_delegated_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON delegated_lifecycle FOR EACH ROW EXECUTE FUNCTION guard_delegated_lifecycle();
