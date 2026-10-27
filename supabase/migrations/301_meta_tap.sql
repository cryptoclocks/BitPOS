-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- NTAG 424 DNA tap stickers on BitPOS Mini devices. The server verifies the sticker's SUN CMAC with
-- per-sticker keys derived from a master key that never enters the database; this schema only stores
-- which sticker belongs to which device, the highest accepted read counter (replay guard), and the
-- short-lived single-use tap sessions a phone can claim.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_ntag_tags(
 tag_id text PRIMARY KEY CHECK(tag_id ~ '^[A-Za-z0-9_-]{4,64}$'),
 merchant_id uuid NOT NULL REFERENCES merchants,
 device_id uuid NOT NULL,
 uid text NOT NULL CHECK(uid ~ '^[0-9A-F]{14}$'),
 key_version int NOT NULL DEFAULT 1 CHECK(key_version>0),
 last_counter int NOT NULL DEFAULT -1 CHECK(last_counter BETWEEN -1 AND 16777215),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 retired_at timestamptz,
 UNIQUE(merchant_id,tag_id),
 FOREIGN KEY(merchant_id,device_id) REFERENCES devices(merchant_id,id)
);
CREATE UNIQUE INDEX meta_ntag_active_uid ON meta_ntag_tags(uid) WHERE retired_at IS NULL;

CREATE TABLE meta_tap_sessions(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 tag_id text NOT NULL,
 device_id uuid NOT NULL,
 counter int NOT NULL CHECK(counter BETWEEN 0 AND 16777215),
 token_sha256 bytea NOT NULL UNIQUE CHECK(octet_length(token_sha256)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 claimed_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 UNIQUE(tag_id,counter),
 FOREIGN KEY(merchant_id,tag_id) REFERENCES meta_ntag_tags(merchant_id,tag_id),
 FOREIGN KEY(merchant_id,device_id) REFERENCES devices(merchant_id,id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '120 seconds'),
 CHECK(claimed_at IS NULL OR (claimed_at>=created_at AND claimed_at<expires_at))
);

ALTER TABLE meta_ntag_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_tap_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_ntag_tenant ON meta_ntag_tags USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_tap_tenant ON meta_tap_sessions USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_ntag_tags TO bitpos_app;
GRANT UPDATE(retired_at) ON meta_ntag_tags TO bitpos_app;
GRANT SELECT ON meta_tap_sessions TO bitpos_app;

-- A tap arrives before the server knows the tenant. Only after the caller has verified the SUN CMAC
-- does it call this function: it checks the UID, advances the counter atomically (a replayed or older
-- URL fails), and opens one single-use session. Returns no row on replay, unknown or retired sticker.
CREATE FUNCTION bitpos.meta_record_tap(p_tag_id text,p_uid text,p_counter int,p_token_sha256 bytea,p_ttl_seconds int DEFAULT 120)
RETURNS TABLE(merchant_id uuid,device_id uuid,session_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE t meta_ntag_tags%ROWTYPE;now_ts timestamptz:=clock_timestamp();
BEGIN
 IF p_ttl_seconds NOT BETWEEN 10 AND 120 OR p_counter NOT BETWEEN 0 AND 16777215 THEN RAISE EXCEPTION 'invalid tap' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM meta_ntag_tags WHERE tag_id=p_tag_id FOR UPDATE;
 IF NOT FOUND OR t.retired_at IS NOT NULL OR t.uid<>upper(p_uid) OR p_counter<=t.last_counter THEN RETURN; END IF;
 UPDATE meta_ntag_tags SET last_counter=p_counter WHERE tag_id=p_tag_id;
 RETURN QUERY INSERT INTO meta_tap_sessions(merchant_id,tag_id,device_id,counter,token_sha256,created_at,expires_at)
  VALUES(t.merchant_id,t.tag_id,t.device_id,p_counter,p_token_sha256,now_ts,now_ts+make_interval(secs=>p_ttl_seconds))
  RETURNING meta_tap_sessions.merchant_id,meta_tap_sessions.device_id,meta_tap_sessions.id,meta_tap_sessions.expires_at;
END $$;

-- The phone presents the session token once; a second claim, an expired session or a wrong token gets no row.
CREATE FUNCTION bitpos.meta_claim_tap(p_token_sha256 bytea)
RETURNS TABLE(merchant_id uuid,device_id uuid,session_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 UPDATE meta_tap_sessions s SET claimed_at=clock_timestamp()
 WHERE s.token_sha256=p_token_sha256 AND s.claimed_at IS NULL AND s.expires_at>clock_timestamp()
 RETURNING s.merchant_id,s.device_id,s.id
$$;

REVOKE ALL ON FUNCTION bitpos.meta_record_tap(text,text,int,bytea,int),bitpos.meta_claim_tap(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_record_tap(text,text,int,bytea,int),bitpos.meta_claim_tap(bytea) TO bitpos_app;
