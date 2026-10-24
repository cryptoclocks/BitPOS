-- Customer support: append-only customer messages; no payment or order mutations.
SET search_path TO bitpos,public;
CREATE TABLE mobile_support_cases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES mobile_accounts,
 command_id uuid NOT NULL,request_hash text NOT NULL,
 merchant_id uuid,order_id uuid,subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 160),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','WAITING_CUSTOMER','RESOLVED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,command_id),UNIQUE(account_id,id),
 CHECK((merchant_id IS NULL)=(order_id IS NULL)),
 FOREIGN KEY(merchant_id,order_id) REFERENCES online_food_orders(merchant_id,order_id)
);
CREATE TABLE mobile_support_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL,case_id uuid NOT NULL,
 command_id uuid NOT NULL,body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
 author_kind text NOT NULL DEFAULT 'CUSTOMER' CHECK(author_kind='CUSTOMER'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,case_id,command_id),
 FOREIGN KEY(account_id,case_id) REFERENCES mobile_support_cases(account_id,id)
);
CREATE INDEX mobile_support_messages_case ON mobile_support_messages(account_id,case_id,id);
ALTER TABLE mobile_support_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_support_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE mobile_support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_support_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY own_support_cases ON mobile_support_cases USING(account_id=NULLIF(current_setting('bitpos.mobile_account',true),'')::uuid) WITH CHECK(account_id=NULLIF(current_setting('bitpos.mobile_account',true),'')::uuid);
CREATE POLICY own_support_messages ON mobile_support_messages USING(account_id=NULLIF(current_setting('bitpos.mobile_account',true),'')::uuid) WITH CHECK(account_id=NULLIF(current_setting('bitpos.mobile_account',true),'')::uuid);
GRANT SELECT,INSERT ON mobile_support_cases,mobile_support_messages TO bitpos_app;

-- Enforce linked-order ownership even for a direct restricted-role INSERT.
CREATE FUNCTION mobile_support_order_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM online_food_orders WHERE merchant_id=NEW.merchant_id AND order_id=NEW.order_id AND account_id=NEW.account_id) THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION mobile_support_order_guard() FROM PUBLIC;
CREATE TRIGGER mobile_support_order_owner BEFORE INSERT ON mobile_support_cases FOR EACH ROW EXECUTE FUNCTION mobile_support_order_guard();
