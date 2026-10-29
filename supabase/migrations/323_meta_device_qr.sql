-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- "Scan to open Messenger" on the BitPOS Mini: for phones without NFC. The device (authenticated by its device key)
-- asks for a short-lived QR link; opening it starts a tap session for that device exactly like an NTAG424 tap, then
-- the usual Messenger consent flow. A QR on a screen can be photographed, so a link lives at most 3 minutes and opens
-- at most 5 sessions; sessions record how they started (nfc / qr).
ALTER TABLE meta_tap_sessions ALTER COLUMN tag_id DROP NOT NULL;
ALTER TABLE meta_tap_sessions ADD COLUMN via text NOT NULL DEFAULT 'nfc' CHECK(via IN ('nfc','qr'));
ALTER TABLE meta_tap_sessions ADD CONSTRAINT meta_tap_sessions_via_tag CHECK((via='nfc')=(tag_id IS NOT NULL));

CREATE TABLE meta_device_qr_links(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 device_id uuid NOT NULL,
 token_sha256 bytea NOT NULL UNIQUE CHECK(octet_length(token_sha256)=32),
 uses int NOT NULL DEFAULT 0 CHECK(uses BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,device_id) REFERENCES devices(merchant_id,id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '180 seconds')
);
CREATE INDEX meta_device_qr_links_device ON meta_device_qr_links(merchant_id,device_id,created_at DESC);
ALTER TABLE meta_device_qr_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON meta_device_qr_links USING (merchant_id=current_setting('bitpos.merchant',true)::uuid);
GRANT SELECT ON meta_device_qr_links TO bitpos_app;

-- Called after the device key was checked by the server; the token itself is never stored.
CREATE FUNCTION bitpos.meta_issue_device_qr(p_device_id uuid,p_token_sha256 bytea,p_ttl_seconds int DEFAULT 150)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE m uuid;now_ts timestamptz:=clock_timestamp();
BEGIN
 IF p_ttl_seconds NOT BETWEEN 30 AND 180 THEN RAISE EXCEPTION 'invalid ttl' USING ERRCODE='22023'; END IF;
 SELECT merchant_id INTO m FROM devices WHERE id=p_device_id AND revoked_at IS NULL;
 IF m IS NULL THEN RETURN NULL; END IF;
 INSERT INTO meta_device_qr_links(merchant_id,device_id,token_sha256,created_at,expires_at) VALUES(m,p_device_id,p_token_sha256,now_ts,now_ts+make_interval(secs=>p_ttl_seconds));
 RETURN now_ts+make_interval(secs=>p_ttl_seconds);
END $$;

-- Opening a QR link: one more use (at most 5, before expiry), and a fresh tap session for its device.
CREATE FUNCTION bitpos.meta_record_qr(p_token_sha256 bytea,p_session_sha256 bytea,p_ttl_seconds int DEFAULT 120)
RETURNS TABLE(merchant_id uuid,device_id uuid,session_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
DECLARE q meta_device_qr_links%ROWTYPE;now_ts timestamptz:=clock_timestamp();
BEGIN
 IF p_ttl_seconds NOT BETWEEN 10 AND 120 THEN RAISE EXCEPTION 'invalid ttl' USING ERRCODE='22023'; END IF;
 SELECT * INTO q FROM meta_device_qr_links l WHERE l.token_sha256=p_token_sha256 FOR UPDATE;
 IF NOT FOUND OR q.expires_at<=now_ts OR q.uses>=5 THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM devices d WHERE d.merchant_id=q.merchant_id AND d.id=q.device_id AND d.revoked_at IS NULL) THEN RETURN; END IF;
 UPDATE meta_device_qr_links SET uses=uses+1 WHERE meta_device_qr_links.merchant_id=q.merchant_id AND id=q.id;
 RETURN QUERY INSERT INTO meta_tap_sessions(merchant_id,tag_id,device_id,counter,token_sha256,created_at,expires_at,via)
  VALUES(q.merchant_id,NULL,q.device_id,0,p_session_sha256,now_ts,now_ts+make_interval(secs=>p_ttl_seconds),'qr')
  RETURNING meta_tap_sessions.merchant_id,meta_tap_sessions.device_id,meta_tap_sessions.id,meta_tap_sessions.expires_at;
END $$;
REVOKE ALL ON FUNCTION bitpos.meta_issue_device_qr(uuid,bytea,int),bitpos.meta_record_qr(bytea,bytea,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_issue_device_qr(uuid,bytea,int),bitpos.meta_record_qr(bytea,bytea,int) TO bitpos_app;
