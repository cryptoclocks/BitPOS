-- Public mobile entry points for migrations 167 (coupon checkout admission) and
-- 168 (scheduled-order admission). The 097/098/107 functions stay revoked from the
-- application role; these wrappers resolve a customer-typed coupon code, list
-- published slots on the server clock and expose the 107 hold function
-- (which authenticates the mobile account/session itself) behind a wrapper. Additive only.
-- Rollback: DROP FUNCTION mobile_coupon_apply(uuid,text,uuid), mobile_schedule_slots(uuid,text), mobile_schedule_hold(uuid,uuid,uuid);
SET search_path=bitpos,public;
CREATE FUNCTION mobile_coupon_apply(p_source uuid,p_code text,p_command uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;merchant uuid;norm text;campaign coupon097_campaigns;version uuid;prior coupon098_commands;used uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'COUPON_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();merchant:=nullif(current_setting('bitpos.merchant',true),'')::uuid;
 IF p_source IS NULL OR p_command IS NULL OR merchant IS NULL OR p_code IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 norm:=upper(btrim(p_code));
 IF norm !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' THEN RAISE EXCEPTION 'COUPON_NOT_FOUND';END IF;
 SELECT * INTO campaign FROM coupon097_campaigns WHERE merchant_id=merchant AND coupon097_campaigns.code=norm;
 IF NOT FOUND OR NOT campaign.enabled OR campaign.active_version_id IS NULL THEN RAISE EXCEPTION 'COUPON_NOT_FOUND';END IF;
 version:=campaign.active_version_id;
 -- Replay of a stored command keeps the policy version it was first bound to, so a later
 -- campaign revision cannot turn an idempotent retry into a conflict or a second hold.
 SELECT * INTO prior FROM coupon098_commands WHERE account_id=actor AND command_id=p_command;
 IF FOUND THEN
  SELECT h.version_id INTO used FROM coupon098_quotes q JOIN coupon097_holds h ON h.id=q.hold_id WHERE q.merchant_id=prior.merchant_id AND q.quote_id=prior.quote_id;
  IF used IS NULL OR NOT EXISTS(SELECT 1 FROM coupon097_versions v WHERE v.id=used AND v.campaign_id=campaign.id)THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  version:=used;
 END IF;
 RETURN coupon098_apply(p_source,version,jsonb_build_object('commandId',p_command));
END $$;
CREATE FUNCTION mobile_schedule_slots(p_branch uuid,p_serving text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE merchant uuid;at timestamptz:=clock_timestamp();result jsonb;
BEGIN
 PERFORM dispatch_realtime_actor();PERFORM dispatch_live_actor();merchant:=nullif(current_setting('bitpos.merchant',true),'')::uuid;
 IF p_branch IS NULL OR merchant IS NULL OR p_serving IS NULL OR p_serving NOT IN('pickup','delivery')THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF NOT EXISTS(SELECT 1 FROM marketplace_branches b WHERE b.merchant_id=merchant AND b.id=p_branch AND b.enabled AND CASE p_serving WHEN 'pickup' THEN b.pickup_enabled ELSE b.delivery_enabled END)THEN RETURN '[]'::jsonb;END IF;
 -- Only slots that can still take a booking are published; capacity numbers are not exposed.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'startsAt',s.starts_at,'endsAt',s.ends_at,'bookingClosesAt',s.booking_closes_at,'timezone',s.timezone)ORDER BY s.starts_at),'[]'::jsonb)INTO result
 FROM(SELECT w.* FROM schedule107_windows w
  JOIN marketplace_branches b ON b.merchant_id=w.merchant_id AND b.id=w.branch_id AND b.timezone=w.timezone
  WHERE w.merchant_id=merchant AND w.branch_id=p_branch AND w.serving=p_serving AND w.enabled AND w.booking_closes_at>at
  AND(SELECT count(*)FROM schedule107_holds x WHERE x.slot_id=w.id AND x.state='HELD'AND x.expires_at>at AND NOT EXISTS(SELECT 1 FROM schedule168_bookings k WHERE k.hold_id=x.id))
   +(SELECT count(*)FROM schedule168_bookings k WHERE k.slot_id=w.id AND k.state IN('BOUND','PAID','DUE'))<w.capacity
  ORDER BY w.starts_at LIMIT 48)s;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION mobile_coupon_apply(uuid,text,uuid),mobile_schedule_slots(uuid,text)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mobile_coupon_apply(uuid,text,uuid),mobile_schedule_slots(uuid,text)TO bitpos_app;
-- One hold per quote (107 UNIQUE): a different command for an already-held quote is a typed refusal, not a unique violation.
CREATE FUNCTION mobile_schedule_hold(p_slot uuid,p_quote uuid,p_command uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;merchant uuid;receipt jsonb;w schedule107_windows;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'SCHEDULE_READ_COMMITTED_REQUIRED';END IF;
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();merchant:=nullif(current_setting('bitpos.merchant',true),'')::uuid;
 IF p_slot IS NULL OR p_quote IS NULL OR p_command IS NULL OR merchant IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF NOT EXISTS(SELECT 1 FROM schedule107_commands c WHERE c.account_id=actor AND c.command_id=p_command)
  AND EXISTS(SELECT 1 FROM schedule107_holds h WHERE h.merchant_id=merchant AND h.quote_id=p_quote)THEN RAISE EXCEPTION 'SCHEDULE_QUOTE_ALREADY_HELD';END IF;
 receipt:=schedule107_hold(p_slot,p_quote,p_command);
 SELECT * INTO STRICT w FROM schedule107_windows WHERE id=(receipt->>'slotId')::uuid AND merchant_id=merchant;
 RETURN receipt||jsonb_build_object('startsAt',w.starts_at,'endsAt',w.ends_at);
END $$;
REVOKE ALL ON FUNCTION mobile_schedule_hold(uuid,uuid,uuid)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mobile_schedule_hold(uuid,uuid,uuid)TO bitpos_app;
