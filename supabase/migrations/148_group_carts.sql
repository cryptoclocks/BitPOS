-- Shared group carts (DS49-DS51 core). A group stores selection INTENTS only (branch, product,
-- quantity per member): no prices, quotes, payments or orders. Each member's lines are priced and
-- paid later through the existing single-branch food quote/order flow, so no parent payment exists.
-- All mutations go through SECURITY DEFINER functions that check the calling mobile account.
SET search_path TO bitpos,extensions,public;
CREATE TABLE group_carts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_account_id uuid NOT NULL REFERENCES mobile_accounts,
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','LOCKED','CANCELLED')),version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE group_cart_members(
 group_id uuid NOT NULL REFERENCES group_carts,account_id uuid NOT NULL REFERENCES mobile_accounts,joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(group_id,account_id)
);
CREATE TABLE group_cart_invites(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),group_id uuid NOT NULL REFERENCES group_carts,token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,revoked_at timestamptz,created_by uuid NOT NULL REFERENCES mobile_accounts
);
CREATE TABLE group_cart_lines(
 group_id uuid NOT NULL REFERENCES group_carts,account_id uuid NOT NULL,
 branch_id uuid NOT NULL REFERENCES marketplace_branches(id),product_id uuid NOT NULL REFERENCES products(id),
 qty integer NOT NULL CHECK(qty BETWEEN 1 AND 99),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(group_id,account_id,branch_id,product_id),FOREIGN KEY(group_id,account_id) REFERENCES group_cart_members(group_id,account_id)
);
CREATE FUNCTION group_cart_actor() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE a uuid:=nullif(current_setting('bitpos.mobile_account',true),'')::uuid;
BEGIN IF a IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF; RETURN a; END $$;
CREATE FUNCTION group_cart_member(g uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM group_cart_members WHERE group_id=g AND account_id::text=current_setting('bitpos.mobile_account',true));
$$;
CREATE FUNCTION group_cart_create() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a uuid:=group_cart_actor();g uuid;
BEGIN
 IF (SELECT count(*) FROM group_carts WHERE owner_account_id=a AND state='OPEN')>=5 THEN RAISE EXCEPTION 'GROUP_LIMIT'; END IF;
 INSERT INTO group_carts(owner_account_id) VALUES(a) RETURNING id INTO g;
 INSERT INTO group_cart_members(group_id,account_id) VALUES(g,a);
 RETURN g;
END $$;
CREATE FUNCTION group_cart_invite(g uuid,token_digest text,ttl_seconds int) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a uuid:=group_cart_actor();c group_carts;exp timestamptz:=clock_timestamp()+make_interval(secs=>ttl_seconds);
BEGIN
 SELECT * INTO c FROM group_carts WHERE id=g FOR UPDATE;
 IF NOT FOUND OR c.owner_account_id<>a THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND'; END IF;
 IF c.state<>'OPEN' THEN RAISE EXCEPTION 'GROUP_NOT_OPEN'; END IF;
 INSERT INTO group_cart_invites(group_id,token_hash,expires_at,created_by) VALUES(g,token_digest,exp,a);
 RETURN exp;
END $$;
CREATE FUNCTION group_cart_join(token_digest text,max_members int) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a uuid:=group_cart_actor();gid uuid;st text;n int;
BEGIN
 SELECT i.group_id INTO gid FROM group_cart_invites i WHERE i.token_hash=token_digest AND i.revoked_at IS NULL AND i.expires_at>clock_timestamp();
 IF gid IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND'; END IF;
 SELECT state INTO st FROM group_carts WHERE id=gid FOR UPDATE;
 IF EXISTS(SELECT 1 FROM group_cart_members WHERE group_id=gid AND account_id=a) THEN RETURN gid; END IF;
 IF st<>'OPEN' THEN RAISE EXCEPTION 'GROUP_NOT_OPEN'; END IF;
 SELECT count(*) INTO n FROM group_cart_members WHERE group_id=gid;
 IF n>=max_members THEN RAISE EXCEPTION 'GROUP_FULL'; END IF;
 INSERT INTO group_cart_members(group_id,account_id) VALUES(gid,a);
 UPDATE group_carts SET version=version+1,updated_at=clock_timestamp() WHERE id=gid;
 RETURN gid;
END $$;
-- qty 0 removes. A member edits only their own lines; the owner may also remove anyone's line.
CREATE FUNCTION group_cart_set_line(g uuid,target uuid,branch uuid,product uuid,q int) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a uuid:=group_cart_actor();c group_carts;v bigint;
BEGIN
 SELECT * INTO c FROM group_carts WHERE id=g FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM group_cart_members WHERE group_id=g AND account_id=a) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND'; END IF;
 IF c.state<>'OPEN' THEN RAISE EXCEPTION 'GROUP_NOT_OPEN'; END IF;
 IF q<0 OR q>99 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF target<>a AND NOT (c.owner_account_id=a AND q=0) THEN RAISE EXCEPTION 'NOT_YOUR_LINE'; END IF;
 IF q=0 THEN
  DELETE FROM group_cart_lines WHERE group_id=g AND account_id=target AND branch_id=branch AND product_id=product;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM marketplace_branches b JOIN products p ON p.merchant_id=b.merchant_id WHERE b.id=branch AND b.enabled AND p.id=product AND p.archived_at IS NULL) THEN RAISE EXCEPTION 'PRODUCT_UNAVAILABLE'; END IF;
  IF (SELECT count(*) FROM group_cart_lines WHERE group_id=g)>=100 AND NOT EXISTS(SELECT 1 FROM group_cart_lines WHERE group_id=g AND account_id=target AND branch_id=branch AND product_id=product) THEN RAISE EXCEPTION 'CART_TOO_LARGE'; END IF;
  INSERT INTO group_cart_lines(group_id,account_id,branch_id,product_id,qty) VALUES(g,target,branch,product,q)
   ON CONFLICT(group_id,account_id,branch_id,product_id) DO UPDATE SET qty=EXCLUDED.qty,updated_at=clock_timestamp();
 END IF;
 UPDATE group_carts SET version=version+1,updated_at=clock_timestamp() WHERE id=g RETURNING version INTO v;
 RETURN v;
END $$;
CREATE FUNCTION group_cart_lock(g uuid,expected bigint) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a uuid:=group_cart_actor();c group_carts;v bigint;
BEGIN
 SELECT * INTO c FROM group_carts WHERE id=g FOR UPDATE;
 IF NOT FOUND OR c.owner_account_id<>a THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND'; END IF;
 IF c.state<>'OPEN' THEN RAISE EXCEPTION 'GROUP_NOT_OPEN'; END IF;
 IF c.version<>expected THEN RAISE EXCEPTION 'GROUP_CHANGED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM group_cart_lines WHERE group_id=g) THEN RAISE EXCEPTION 'EMPTY_CART'; END IF;
 UPDATE group_carts SET state='LOCKED',version=version+1,updated_at=clock_timestamp() WHERE id=g RETURNING version INTO v;
 UPDATE group_cart_invites SET revoked_at=clock_timestamp() WHERE group_id=g AND revoked_at IS NULL;
 RETURN v;
END $$;
CREATE FUNCTION group_cart_cancel(g uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a uuid:=group_cart_actor();c group_carts;
BEGIN
 SELECT * INTO c FROM group_carts WHERE id=g FOR UPDATE;
 IF NOT FOUND OR c.owner_account_id<>a THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND'; END IF;
 IF c.state='CANCELLED' THEN RETURN; END IF;
 UPDATE group_carts SET state='CANCELLED',version=version+1,updated_at=clock_timestamp() WHERE id=g;
 UPDATE group_cart_invites SET revoked_at=clock_timestamp() WHERE group_id=g AND revoked_at IS NULL;
END $$;
CREATE FUNCTION group_cart_leave(g uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE a uuid:=group_cart_actor();c group_carts;
BEGIN
 SELECT * INTO c FROM group_carts WHERE id=g FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM group_cart_members WHERE group_id=g AND account_id=a) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND'; END IF;
 IF c.owner_account_id=a THEN RAISE EXCEPTION 'OWNER_CANNOT_LEAVE'; END IF;
 IF c.state<>'OPEN' THEN RAISE EXCEPTION 'GROUP_NOT_OPEN'; END IF;
 DELETE FROM group_cart_lines WHERE group_id=g AND account_id=a;
 DELETE FROM group_cart_members WHERE group_id=g AND account_id=a;
 UPDATE group_carts SET version=version+1,updated_at=clock_timestamp() WHERE id=g;
END $$;
REVOKE ALL ON group_carts,group_cart_members,group_cart_invites,group_cart_lines FROM PUBLIC,bitpos_app;
GRANT SELECT ON group_carts,group_cart_members,group_cart_lines TO bitpos_app;
ALTER TABLE group_carts ENABLE ROW LEVEL SECURITY;ALTER TABLE group_carts FORCE ROW LEVEL SECURITY;
ALTER TABLE group_cart_members ENABLE ROW LEVEL SECURITY;ALTER TABLE group_cart_members FORCE ROW LEVEL SECURITY;
ALTER TABLE group_cart_invites ENABLE ROW LEVEL SECURITY;ALTER TABLE group_cart_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE group_cart_lines ENABLE ROW LEVEL SECURITY;ALTER TABLE group_cart_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY group_cart_read ON group_carts FOR SELECT TO bitpos_app USING(group_cart_member(id));
CREATE POLICY group_member_read ON group_cart_members FOR SELECT TO bitpos_app USING(group_cart_member(group_id));
CREATE POLICY group_line_read ON group_cart_lines FOR SELECT TO bitpos_app USING(group_cart_member(group_id));
REVOKE ALL ON FUNCTION group_cart_member(uuid),group_cart_create(),group_cart_invite(uuid,text,int),group_cart_join(text,int),group_cart_set_line(uuid,uuid,uuid,uuid,int),group_cart_lock(uuid,bigint),group_cart_cancel(uuid),group_cart_leave(uuid),group_cart_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION group_cart_member(uuid),group_cart_create(),group_cart_invite(uuid,text,int),group_cart_join(text,int),group_cart_set_line(uuid,uuid,uuid,uuid,int),group_cart_lock(uuid,bigint),group_cart_cancel(uuid),group_cart_leave(uuid),group_cart_actor() TO bitpos_app;
