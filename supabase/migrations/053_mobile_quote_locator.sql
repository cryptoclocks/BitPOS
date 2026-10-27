SET search_path=bitpos,public;
CREATE INDEX online_quotes_account ON order_quotes(source_account_id,id) WHERE origin_kind='online';
CREATE FUNCTION mobile_owned_quote_location(p_account uuid,p_session uuid,p_quote uuid)
RETURNS TABLE(merchant_id uuid,branch_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT q.merchant_id,q.source_branch_id FROM order_quotes q
 WHERE q.id=p_quote AND q.origin_kind='online' AND q.source_account_id=p_account
 AND EXISTS(SELECT 1 FROM mobile_sessions s JOIN mobile_accounts a ON a.id=s.account_id
 WHERE s.id=p_session AND s.account_id=p_account AND s.revoked_at IS NULL
 AND s.access_expires_at>statement_timestamp() AND s.refresh_expires_at>statement_timestamp() AND a.disabled_at IS NULL)
$$;
REVOKE ALL ON FUNCTION mobile_owned_quote_location(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mobile_owned_quote_location(uuid,uuid,uuid) TO bitpos_app;

CREATE FUNCTION guard_online_food_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM order_authority a WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.order_id
 AND a.source_kind='online' AND a.source_account_id=NEW.account_id AND a.source_branch_id=NEW.branch_id)
 OR NEW.acceptance_status<>'PENDING' OR NEW.event_sequence<>0
 THEN RAISE EXCEPTION 'online lifecycle ownership mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_online_food_insert BEFORE INSERT ON online_food_orders FOR EACH ROW EXECUTE FUNCTION guard_online_food_insert();
-- Preserve any online rows created between additive migrations; baseline snapshots
-- are explicitly not a claim about historical event occurrence times.
INSERT INTO online_food_orders(merchant_id,order_id,account_id,branch_id,acceptance_deadline)
SELECT a.merchant_id,a.order_id,a.source_account_id,a.source_branch_id,
 least(o.quote_expires_at,o.created_at+interval '2 minutes')
FROM order_authority a JOIN orders o ON o.merchant_id=a.merchant_id AND o.id=a.order_id
WHERE a.source_kind='online' AND NOT EXISTS(SELECT 1 FROM online_food_orders f WHERE f.merchant_id=a.merchant_id AND f.order_id=a.order_id);
SELECT online_food_event(merchant_id,order_id,'SNAPSHOT_BASELINE') FROM online_food_orders WHERE event_sequence=0;
