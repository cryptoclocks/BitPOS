-- Scoped support operations. General inbox requires an explicit extra grant;
-- merchant scope never implies access to unrelated account enquiries.
SET search_path=bitpos,public;
ALTER TABLE mobile_support_cases ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE mobile_support_messages DROP CONSTRAINT mobile_support_messages_author_kind_check;
ALTER TABLE mobile_support_messages ADD CONSTRAINT mobile_support_message_author CHECK(author_kind IN('CUSTOMER','STAFF'));
ALTER TABLE mobile_support_messages ADD COLUMN staff_account_id uuid REFERENCES mobile_accounts;
ALTER TABLE mobile_support_messages ADD CONSTRAINT mobile_support_staff_identity CHECK((author_kind='CUSTOMER' AND staff_account_id IS NULL) OR(author_kind='STAFF' AND staff_account_id IS NOT NULL));
DROP POLICY own_support_messages ON mobile_support_messages;
CREATE POLICY own_support_messages ON mobile_support_messages USING(account_id=NULLIF(current_setting('bitpos.mobile_account',true),'')::uuid) WITH CHECK(account_id=NULLIF(current_setting('bitpos.mobile_account',true),'')::uuid AND author_kind='CUSTOMER' AND staff_account_id IS NULL);
CREATE TABLE platform_support_general_grants(grant_id uuid PRIMARY KEY REFERENCES platform_staff_role_grants,granted_by text NOT NULL CHECK(length(btrim(granted_by)) BETWEEN 1 AND 160),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE mobile_support_staff_commands(
 actor_account_id uuid NOT NULL REFERENCES mobile_accounts,command_id uuid NOT NULL,request_hash text NOT NULL,case_id uuid NOT NULL REFERENCES mobile_support_cases,
 session_id uuid NOT NULL REFERENCES mobile_sessions,grant_id uuid NOT NULL REFERENCES platform_staff_role_grants,
 receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_account_id,command_id)
);
CREATE TABLE mobile_support_access_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_account_id uuid NOT NULL REFERENCES mobile_accounts,session_id uuid NOT NULL REFERENCES mobile_sessions,
 grant_id uuid NOT NULL REFERENCES platform_staff_role_grants,case_id uuid REFERENCES mobile_support_cases,merchant_id uuid REFERENCES merchants,
 operation text NOT NULL CHECK(operation IN('LIST','READ','REPLY','RESOLVE','REOPEN','WAIT')),purpose text NOT NULL CHECK(length(btrim(purpose)) BETWEEN 1 AND 300),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE platform_support_general_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_support_staff_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_support_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_support_general_grants,mobile_support_staff_commands,mobile_support_access_audit FROM PUBLIC,bitpos_app;
CREATE TRIGGER support_access_immutable BEFORE UPDATE OR DELETE ON mobile_support_access_audit FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER support_command_immutable BEFORE UPDATE OR DELETE ON mobile_support_staff_commands FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION support_message_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE current_case mobile_support_cases;
BEGIN
 SELECT * INTO current_case FROM mobile_support_cases WHERE id=NEW.case_id AND account_id=NEW.account_id FOR UPDATE;
 IF NOT FOUND OR current_case.state='RESOLVED' THEN RAISE EXCEPTION 'SUPPORT_CASE_CLOSED';END IF;
 UPDATE mobile_support_cases SET version=version+1,state=CASE WHEN NEW.author_kind='CUSTOMER' THEN 'OPEN' ELSE state END WHERE id=NEW.case_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION support_message_version() FROM PUBLIC;
CREATE TRIGGER support_message_version BEFORE INSERT ON mobile_support_messages FOR EACH ROW EXECUTE FUNCTION support_message_version();
CREATE FUNCTION support_staff_authority(merchant uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;selected uuid;
BEGIN
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF merchant IS NOT NULL THEN RETURN food_incident_staff(merchant,false);END IF;
 BEGIN
  SELECT g.id INTO selected FROM platform_staff_role_grants g JOIN platform_support_general_grants x ON x.grant_id=g.id
  WHERE g.account_id=actor AND g.role IN('support','administrator') AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() ORDER BY g.id LIMIT 1 FOR SHARE OF g,x NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DISPATCH_AUTH_RETRY' USING ERRCODE='40001';END;
 IF selected IS NULL THEN RAISE EXCEPTION 'ROLE_REQUIRED';END IF;
 RETURN selected;
END $$;
CREATE FUNCTION support_case_safe(c mobile_support_cases) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('id',(c).id,'subject',(c).subject,'state',(c).state,'createdAt',(c).created_at,'version',(c).version::text,
 'order',CASE WHEN(c).order_id IS NULL THEN NULL ELSE jsonb_build_object('merchantId',(c).merchant_id,'orderId',(c).order_id) END)
$$;
CREATE FUNCTION support_staff_list(merchant uuid,after_id uuid,purpose text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE selected uuid;items jsonb;next_id uuid;after_at timestamptz;
BEGIN
 IF length(btrim(purpose)) NOT BETWEEN 1 AND 300 OR purpose IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 selected:=support_staff_authority(merchant);
 IF after_id IS NOT NULL THEN SELECT created_at INTO after_at FROM mobile_support_cases WHERE id=after_id AND merchant_id IS NOT DISTINCT FROM merchant;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;END IF;
 SELECT coalesce(jsonb_agg(support_case_safe(c) ORDER BY c.created_at,c.id),'[]') INTO items FROM(SELECT * FROM mobile_support_cases WHERE merchant_id IS NOT DISTINCT FROM merchant AND(after_id IS NULL OR(created_at,id)>(after_at,after_id)) ORDER BY created_at,id LIMIT 51)c;
 IF jsonb_array_length(items)>50 THEN next_id:=(items->49->>'id')::uuid;items:=items-50;END IF;
 INSERT INTO mobile_support_access_audit(actor_account_id,session_id,grant_id,merchant_id,operation,purpose)VALUES(dispatch_live_actor(),nullif(current_setting('bitpos.mobile_session',true),'')::uuid,selected,merchant,'LIST',btrim(purpose));
 RETURN jsonb_build_object('items',items,'nextCursor',next_id);
END $$;
CREATE FUNCTION support_staff_read(target uuid,after_id uuid,purpose text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c mobile_support_cases;selected uuid;items jsonb;next_id uuid;after_at timestamptz;
BEGIN
 IF length(btrim(purpose)) NOT BETWEEN 1 AND 300 OR purpose IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO c FROM mobile_support_cases WHERE id=target;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 selected:=support_staff_authority(c.merchant_id);
 IF after_id IS NOT NULL THEN SELECT created_at INTO after_at FROM mobile_support_messages WHERE id=after_id AND case_id=target;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'authorKind',m.author_kind,'createdAt',m.created_at) ORDER BY m.created_at,m.id),'[]') INTO items FROM(SELECT * FROM mobile_support_messages WHERE case_id=target AND(after_id IS NULL OR(created_at,id)>(after_at,after_id)) ORDER BY created_at,id LIMIT 51)m;
 IF jsonb_array_length(items)>50 THEN next_id:=(items->49->>'id')::uuid;items:=items-50;END IF;
 INSERT INTO mobile_support_access_audit(actor_account_id,session_id,grant_id,case_id,merchant_id,operation,purpose)VALUES(dispatch_live_actor(),nullif(current_setting('bitpos.mobile_session',true),'')::uuid,selected,c.id,c.merchant_id,'READ',btrim(purpose));
 RETURN jsonb_build_object('ticket',support_case_safe(c),'messages',jsonb_build_object('items',items,'nextCursor',next_id));
END $$;
CREATE FUNCTION support_staff_command(target uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE c mobile_support_cases;selected uuid;actor uuid;key uuid;digest text;prior mobile_support_staff_commands;action text;receipt jsonb;
BEGIN
 IF jsonb_typeof(payload)<>'object' OR NOT payload ?& ARRAY['commandId','expectedVersion','action','message','reason'] OR(SELECT count(*) FROM jsonb_object_keys(payload))<>5
 OR jsonb_typeof(payload->'commandId')<>'string' OR NOT coalesce(canonical_online_option_uuid(payload->>'commandId'),false)
 OR jsonb_typeof(payload->'expectedVersion')<>'string' OR(payload->>'expectedVersion')!~'^[1-9][0-9]{0,18}$' OR(payload->>'expectedVersion')::numeric>9223372036854775807
 OR jsonb_typeof(payload->'action')<>'string' OR(payload->>'action') NOT IN('REPLY','RESOLVE','REOPEN','WAIT')
 OR jsonb_typeof(payload->'message')<>'string' OR jsonb_typeof(payload->'reason')<>'string' OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 300
 OR length(payload->>'message')>4000 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 action:=payload->>'action';IF(action='REPLY' AND length(btrim(payload->>'message'))<1) OR(action<>'REPLY' AND payload->>'message'<>'') THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO c FROM mobile_support_cases WHERE id=target;IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 -- All customer mutations use the same account-row lock before reading state.
 PERFORM 1 FROM mobile_accounts WHERE id=c.account_id FOR UPDATE;
 SELECT * INTO STRICT c FROM mobile_support_cases WHERE id=target FOR UPDATE;
 selected:=support_staff_authority(c.merchant_id);actor:=dispatch_live_actor();key:=(payload->>'commandId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||key::text,94));
 digest:=encode(sha256(convert_to(jsonb_build_array(target,payload)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM mobile_support_staff_commands WHERE actor_account_id=actor AND command_id=key;
 IF FOUND THEN IF prior.request_hash<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 IF c.version<>(payload->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF action='REPLY' THEN
  IF c.state='RESOLVED' THEN RAISE EXCEPTION 'SUPPORT_CASE_CLOSED';END IF;
  INSERT INTO mobile_support_messages(account_id,case_id,command_id,body,author_kind,staff_account_id)VALUES(c.account_id,c.id,key,btrim(payload->>'message'),'STAFF',actor);
 ELSE
  IF(action='REOPEN' AND c.state<>'RESOLVED') OR(action IN('RESOLVE','WAIT') AND c.state='RESOLVED') THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  UPDATE mobile_support_cases SET state=CASE action WHEN 'RESOLVE' THEN 'RESOLVED' WHEN 'WAIT' THEN 'WAITING_CUSTOMER' ELSE 'OPEN' END,version=version+1 WHERE id=c.id;
 END IF;
 SELECT * INTO STRICT c FROM mobile_support_cases WHERE id=target;receipt:=support_case_safe(c);
 INSERT INTO mobile_support_staff_commands(actor_account_id,command_id,request_hash,case_id,session_id,grant_id,receipt)VALUES(actor,key,digest,c.id,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,selected,receipt);
 INSERT INTO mobile_support_access_audit(actor_account_id,session_id,grant_id,case_id,merchant_id,operation,purpose)VALUES(actor,nullif(current_setting('bitpos.mobile_session',true),'')::uuid,selected,c.id,c.merchant_id,action,btrim(payload->>'reason'));
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION support_staff_authority(uuid),support_case_safe(mobile_support_cases),support_staff_list(uuid,uuid,text),support_staff_read(uuid,uuid,text),support_staff_command(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_staff_list(uuid,uuid,text),support_staff_read(uuid,uuid,text),support_staff_command(uuid,jsonb) TO bitpos_app;
