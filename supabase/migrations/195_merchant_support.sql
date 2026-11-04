-- Shop (merchant) support requests: an owner/manager writes to the BitPOS team from inside the app and platform support staff answer.
-- Deliberately separate from the customer support tables (mobile_support_*, bound to a mobile account): nothing of that stack is altered.
-- Shop side: tenant tables under RLS (a shop sees only its own cases), messages insert-only, the case row carries state/version/updated_at.
-- Staff side: SECURITY DEFINER functions only; the authority is the EXISTING per-merchant scope check food_incident_staff(merchant,false)
-- (roles support/dispatcher/administrator with a scope on that merchant, live mobile session), every access is written to an immutable audit with a stated purpose.
-- Rollback: DROP FUNCTION merchant_support_staff_*; DROP TABLE merchant_support_staff_audit, merchant_support_messages, merchant_support_cases.
SET search_path=bitpos,public;

CREATE TABLE merchant_support_cases(
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 subject text NOT NULL CHECK(char_length(btrim(subject)) BETWEEN 3 AND 120),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','ANSWERED','RESOLVED')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_by text NOT NULL,
 idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 8 AND 128),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),UNIQUE(merchant_id,idempotency_key)
);
CREATE INDEX merchant_support_cases_recent ON merchant_support_cases(merchant_id,updated_at DESC,id DESC);
CREATE TABLE merchant_support_messages(
 merchant_id uuid NOT NULL,
 case_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 author_kind text NOT NULL CHECK(author_kind IN('SHOP','STAFF')),
 author text NOT NULL,
 staff_account_id uuid REFERENCES mobile_accounts(id),
 body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 1 AND 4000),
 idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 8 AND 128),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),UNIQUE(merchant_id,case_id,idempotency_key),
 FOREIGN KEY(merchant_id,case_id) REFERENCES merchant_support_cases(merchant_id,id),
 CHECK((author_kind='SHOP' AND staff_account_id IS NULL) OR(author_kind='STAFF' AND staff_account_id IS NOT NULL))
);
CREATE INDEX merchant_support_messages_thread ON merchant_support_messages(merchant_id,case_id,created_at,id);
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON merchant_support_messages FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TABLE merchant_support_staff_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts(id),
 grant_id uuid NOT NULL REFERENCES platform_staff_role_grants(id),
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 case_id uuid,
 operation text NOT NULL CHECK(operation IN('LIST','READ','REPLY','RESOLVE','REOPEN')),
 purpose text NOT NULL CHECK(char_length(btrim(purpose)) BETWEEN 1 AND 300),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON merchant_support_staff_audit FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();

ALTER TABLE merchant_support_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_support_staff_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON merchant_support_cases FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY tenant_access ON merchant_support_messages FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true) AND author_kind='SHOP');
REVOKE ALL ON merchant_support_staff_audit FROM PUBLIC,bitpos_app;
GRANT SELECT,INSERT ON merchant_support_cases TO bitpos_app;
GRANT UPDATE(state,version,updated_at) ON merchant_support_cases TO bitpos_app;
GRANT SELECT,INSERT ON merchant_support_messages TO bitpos_app;

CREATE FUNCTION merchant_support_case_safe(c merchant_support_cases) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('id',(c).id,'merchantId',(c).merchant_id,'subject',(c).subject,'state',(c).state,'version',(c).version::text,'createdAt',(c).created_at,'updatedAt',(c).updated_at)
$$;
CREATE FUNCTION merchant_support_staff_list(p_merchant uuid,p_purpose text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE selected uuid;items jsonb;
BEGIN
 IF p_merchant IS NULL OR p_purpose IS NULL OR length(btrim(p_purpose)) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 selected:=food_incident_staff(p_merchant,false);
 SELECT coalesce(jsonb_agg(merchant_support_case_safe(c) ORDER BY c.updated_at DESC,c.id DESC),'[]') INTO items
 FROM(SELECT * FROM merchant_support_cases WHERE merchant_id=p_merchant ORDER BY updated_at DESC,id DESC LIMIT 50)c;
 INSERT INTO merchant_support_staff_audit(actor_account_id,grant_id,merchant_id,operation,purpose)VALUES(dispatch_live_actor(),selected,p_merchant,'LIST',btrim(p_purpose));
 RETURN jsonb_build_object('items',items);
END $$;
CREATE FUNCTION merchant_support_staff_read(p_case uuid,p_purpose text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c merchant_support_cases;selected uuid;items jsonb;
BEGIN
 IF p_purpose IS NULL OR length(btrim(p_purpose)) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO c FROM merchant_support_cases WHERE id=p_case;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 selected:=food_incident_staff(c.merchant_id,false);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'authorKind',m.author_kind,'createdAt',m.created_at) ORDER BY m.created_at,m.id),'[]') INTO items
 FROM(SELECT * FROM merchant_support_messages WHERE merchant_id=c.merchant_id AND case_id=c.id ORDER BY created_at,id LIMIT 500)m;
 INSERT INTO merchant_support_staff_audit(actor_account_id,grant_id,merchant_id,case_id,operation,purpose)VALUES(dispatch_live_actor(),selected,c.merchant_id,c.id,'READ',btrim(p_purpose));
 RETURN jsonb_build_object('ticket',merchant_support_case_safe(c),'messages',items);
END $$;
CREATE FUNCTION merchant_support_staff_command(p_case uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c merchant_support_cases;selected uuid;actor uuid;act text;key text;
BEGIN
 IF jsonb_typeof(payload)<>'object' OR NOT payload ?& ARRAY['commandId','expectedVersion','action','message','reason'] OR(SELECT count(*) FROM jsonb_object_keys(payload))<>5
 OR jsonb_typeof(payload->'commandId')<>'string' OR(payload->>'commandId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR jsonb_typeof(payload->'expectedVersion')<>'string' OR(payload->>'expectedVersion')!~'^[1-9][0-9]{0,17}$'
 OR jsonb_typeof(payload->'action')<>'string' OR(payload->>'action') NOT IN('REPLY','RESOLVE','REOPEN')
 OR jsonb_typeof(payload->'message')<>'string' OR jsonb_typeof(payload->'reason')<>'string' OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 300
 OR length(payload->>'message')>4000 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 act:=payload->>'action';key:=payload->>'commandId';
 IF(act='REPLY' AND length(btrim(payload->>'message'))<1) OR(act<>'REPLY' AND payload->>'message'<>'') THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO c FROM merchant_support_cases WHERE id=p_case;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 selected:=food_incident_staff(c.merchant_id,false);actor:=dispatch_live_actor();
 SELECT * INTO STRICT c FROM merchant_support_cases WHERE merchant_id=c.merchant_id AND id=p_case FOR UPDATE;
 IF act='REPLY' AND EXISTS(SELECT 1 FROM merchant_support_messages WHERE merchant_id=c.merchant_id AND case_id=c.id AND idempotency_key=key AND staff_account_id=actor) THEN
  RETURN merchant_support_case_safe(c); -- the same command again: already applied
 END IF;
 IF c.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF act='REPLY' THEN
  IF c.state='RESOLVED' THEN RAISE EXCEPTION 'SUPPORT_CASE_CLOSED';END IF;
  INSERT INTO merchant_support_messages(merchant_id,case_id,author_kind,author,staff_account_id,body,idempotency_key)VALUES(c.merchant_id,c.id,'STAFF',actor::text,actor,btrim(payload->>'message'),key);
  UPDATE merchant_support_cases SET state='ANSWERED',version=version+1,updated_at=clock_timestamp() WHERE merchant_id=c.merchant_id AND id=c.id;
 ELSIF act='RESOLVE' THEN
  IF c.state='RESOLVED' THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  UPDATE merchant_support_cases SET state='RESOLVED',version=version+1,updated_at=clock_timestamp() WHERE merchant_id=c.merchant_id AND id=c.id;
 ELSE
  IF c.state<>'RESOLVED' THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  UPDATE merchant_support_cases SET state='OPEN',version=version+1,updated_at=clock_timestamp() WHERE merchant_id=c.merchant_id AND id=c.id;
 END IF;
 INSERT INTO merchant_support_staff_audit(actor_account_id,grant_id,merchant_id,case_id,operation,purpose)VALUES(actor,selected,c.merchant_id,c.id,act,btrim(payload->>'reason'));
 SELECT * INTO STRICT c FROM merchant_support_cases WHERE merchant_id=c.merchant_id AND id=p_case;
 RETURN merchant_support_case_safe(c);
END $$;
REVOKE ALL ON FUNCTION merchant_support_case_safe(merchant_support_cases),merchant_support_staff_list(uuid,text),merchant_support_staff_read(uuid,text),merchant_support_staff_command(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merchant_support_staff_list(uuid,text),merchant_support_staff_read(uuid,text),merchant_support_staff_command(uuid,jsonb) TO bitpos_app;
