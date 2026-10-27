-- One effective attention rule; customer polling never builds staff cycle-history JSON.
SET search_path=bitpos,public;
CREATE FUNCTION food_dispatch_search_attention(s food_dispatch_searches) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$ SELECT CASE WHEN (s).mode='MANUAL' THEN 'MANUAL' WHEN NOT food_dispatch_policy_live((s).policy_id) THEN 'POLICY_UNAVAILABLE'
 WHEN (s).absolute_deadline<=clock_timestamp() OR (s).cycle_deadline<=clock_timestamp() THEN 'DEADLINE' WHEN (s).offers_remaining=0 THEN 'BUDGET' ELSE (s).attention_reason END; $$;
REVOKE ALL ON FUNCTION food_dispatch_search_attention(food_dispatch_searches) FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
CREATE OR REPLACE FUNCTION food_dispatch_search_value(shipment uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT jsonb_build_object('shipmentId',s.shipment_id,'policyId',s.policy_id,'version',s.version::text,'epoch',s.epoch::text,'mode',s.mode,
 'attentionReason',food_dispatch_search_attention(s),
 'openedAt',s.opened_at,'absoluteDeadline',s.absolute_deadline,'cycleNumber',s.cycle_number,'cycleStartedAt',s.cycle_started_at,'cycleDeadline',s.cycle_deadline,
 'offersRemaining',s.offers_remaining,'nextRetryAt',s.next_retry_at,
 'cycles',(SELECT coalesce(jsonb_agg(jsonb_build_object('cycleNumber',c.cycle_number,'epoch',c.epoch::text,'startedAt',c.started_at,'deadline',c.deadline,'offerBudget',c.offer_budget,'reason',c.reason) ORDER BY c.cycle_number),'[]'::jsonb) FROM food_dispatch_search_cycles c WHERE c.shipment_id=s.shipment_id))
 FROM food_dispatch_searches s WHERE s.shipment_id=shipment
$$;

-- Owner-only matching/reassignment facts; no driver history, staff reasons, policy or worker secrets.
CREATE FUNCTION food_customer_dispatch_progress(s food_shipments,active jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE phase text;attention text;released integer;last_released timestamptz;matching jsonb;reassignment jsonb;
BEGIN
 IF s.state IN('DELIVERED','CANCELLED','FAILED') THEN phase:='CLOSED';
 ELSIF active IS NOT NULL THEN phase:=CASE WHEN (active->>'serviceAvailable')::boolean THEN 'ASSIGNED' ELSE 'NEEDS_ATTENTION' END;
 ELSIF EXISTS(SELECT 1 FROM food_dispatch_offers o WHERE o.shipment_id=s.id AND o.generation=s.generation AND o.state='OFFERED' AND o.expires_at>clock_timestamp()) THEN phase:='OFFERED';
 ELSE
  SELECT jsonb_build_object('version',q.version::text,'expiresAt',q.absolute_deadline),food_dispatch_search_attention(q) INTO matching,attention FROM food_dispatch_searches q WHERE q.shipment_id=s.id;
  IF FOUND THEN
  attention:=CASE WHEN attention IN('PROVIDER_UNAVAILABLE','NO_CANDIDATE','DEADLINE','BUDGET','POLICY_UNAVAILABLE','MANUAL') THEN attention ELSE NULL END;
  phase:=CASE WHEN attention IS NULL THEN 'SEARCHING' ELSE 'NEEDS_ATTENTION' END;
 ELSIF s.state IN('OFFERING','READY_FOR_DISPATCH','INCIDENT') THEN phase:='NEEDS_ATTENTION';
 ELSE phase:='NOT_STARTED';END IF;
 END IF;
 SELECT count(*)::integer,max(a.closed_at) INTO released,last_released FROM food_assignments a WHERE a.shipment_id=s.id AND a.state='RELEASED' AND a.picked_up_at IS NULL;
 IF released>0 THEN reassignment:=jsonb_build_object('count',released,'lastReleasedAt',last_released);END IF;
 RETURN jsonb_build_object('phase',phase,'attentionReason',attention,'search',matching,'reassignment',reassignment);
END $$;
REVOKE ALL ON FUNCTION food_customer_dispatch_progress(food_shipments,jsonb) FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
CREATE OR REPLACE FUNCTION dispatch_customer_work(oid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;s food_shipments;a food_assignments;tracking jsonb;proof jsonb;active jsonb:=NULL;available boolean;progress jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;
 actor:=nullif(current_setting('bitpos.mobile_account',true),'')::uuid;
 SELECT * INTO s FROM food_shipments WHERE order_id=oid AND account_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 s:=dispatch_lock_root(s.id);PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();
 IF s.account_id<>actor THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 tracking:=dispatch_food_tracking(s.id);
 SELECT * INTO a FROM food_assignments WHERE id=s.active_assignment_id;
 IF FOUND THEN
  SELECT jsonb_build_object('id',f.id,'kind',f.kind,'expiresAt',f.expires_at,'attemptsRemaining',10-f.attempts) INTO proof FROM fulfillment_proofs f WHERE f.assignment_id=a.id AND f.generation=a.generation AND f.kind='DELIVERY' AND f.revoked_at IS NULL AND f.consumed_at IS NULL;
  -- One final live decision gates every previously fetched private field.
  available:=a.state<>'INCIDENT' AND food_driver_authority(a.driver_id,a.shipment_id) IS NULL;
  active:=jsonb_build_object('serviceAvailable',available,'id',a.id,'state',a.state,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,
   'location',CASE WHEN available THEN tracking->'location' ELSE NULL END,
   'deliveryProof',CASE WHEN available THEN proof ELSE NULL END);
 END IF;
 progress:=food_customer_dispatch_progress(s,active);
 IF active IS NOT NULL THEN
  available:=a.state<>'INCIDENT' AND food_driver_authority(a.driver_id,a.shipment_id) IS NULL;
  IF NOT available THEN active:=active||jsonb_build_object('serviceAvailable',false,'location',NULL,'deliveryProof',NULL);progress:=progress||jsonb_build_object('phase','NEEDS_ATTENTION','attentionReason',NULL);END IF;
 END IF;
 PERFORM dispatch_realtime_actor();
 RETURN jsonb_build_object('shipmentId',s.id,'state',s.state,'version',s.version::text,'generation',s.generation::text,'assignment',active,'dispatch',progress);
END $$;

-- Empty transactional wake hints only; existing snapshot authorization/clock reconciliation remains authoritative.
CREATE TRIGGER food_customer_search_realtime_wake AFTER INSERT OR UPDATE OR DELETE ON food_dispatch_searches FOR EACH STATEMENT EXECUTE FUNCTION dispatch_realtime_wake();
CREATE TRIGGER food_customer_policy_realtime_wake AFTER INSERT OR UPDATE OR DELETE ON food_dispatch_policy_heads FOR EACH STATEMENT EXECUTE FUNCTION dispatch_realtime_wake();
