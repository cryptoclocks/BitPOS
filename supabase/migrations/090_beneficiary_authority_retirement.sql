-- Candidate: local review/application only. No actual-use migration authorization.
BEGIN;
SET LOCAL search_path=bitpos,public;
CREATE FUNCTION settlement090_beneficiary_authority_retired(origin uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;original mobile_sessions;
BEGIN
 actor:=settlement088_live_actor();
 -- Original mutations hold SHARE on this session until COMMIT. A committed
 -- revocation therefore closes all original in-flight and future mutations.
 SELECT * INTO original FROM mobile_sessions WHERE id=origin AND account_id=actor
 AND device_id=nullif(current_setting('bitpos.mobile_device',true),'')::uuid FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF original.revoked_at IS NULL THEN RAISE EXCEPTION 'BENEFICIARY_AUTHORITY_STILL_LIVE';END IF;
 PERFORM settlement088_live_actor();
 RETURN jsonb_build_object('kind','BENEFICIARY_AUTHORITY_RETIRED','accountId',actor,'originalSessionId',origin,'deviceId',original.device_id);
END $$;
REVOKE ALL ON FUNCTION settlement090_beneficiary_authority_retired(uuid) FROM PUBLIC,bitpos_settlement_worker;
GRANT EXECUTE ON FUNCTION settlement090_beneficiary_authority_retired(uuid) TO bitpos_app;
COMMIT;
