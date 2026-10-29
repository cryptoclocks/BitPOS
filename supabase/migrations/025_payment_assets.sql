-- Additive storage: no UPDATE to historical orders, quotes, attempts or payments.
SET search_path=bitpos,public;
CREATE TABLE payment_assets(
 asset_id text PRIMARY KEY,descriptor jsonb NOT NULL,enabled boolean NOT NULL DEFAULT false,
 verified_at timestamptz, CHECK(descriptor->>'assetId'=asset_id),
 CHECK(descriptor->>'cluster'='devnet'),CHECK(descriptor->>'genesisHash'='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'),
 CHECK((descriptor->>'decimals')::int=6),CHECK(descriptor->>'instructionPolicy' IN ('token2022_zero_fee','spl_checked'))
);
CREATE UNIQUE INDEX payment_asset_unique_mint ON payment_assets((descriptor->>'mint'));
INSERT INTO payment_assets VALUES
 ('usdg-devnet','{"assetId":"usdg-devnet","symbol":"USDG","displayLabel":"USDG devnet","cluster":"devnet","genesisHash":"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG","mint":"4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7","tokenProgram":"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb","decimals":6,"instructionPolicy":"token2022_zero_fee","issuerTestAsset":true}',true,clock_timestamp()),
 ('usdc-devnet','{"assetId":"usdc-devnet","symbol":"USDC","displayLabel":"USDC devnet (Circle)","cluster":"devnet","genesisHash":"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG","mint":"4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU","tokenProgram":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","decimals":6,"instructionPolicy":"spl_checked","issuerTestAsset":true}',false,NULL);
CREATE TABLE merchant_payment_assets(
 merchant_id uuid NOT NULL REFERENCES merchants,asset_id text NOT NULL REFERENCES payment_assets,
 enabled boolean NOT NULL DEFAULT false,policy jsonb NOT NULL,version int NOT NULL DEFAULT 1,
 PRIMARY KEY(merchant_id,asset_id),CHECK(policy->>'id' IS NOT NULL),
 CHECK((policy->>'numerator')::numeric BETWEEN 1 AND 18446744073709551615),
 CHECK((policy->>'denominator')::numeric BETWEEN 1 AND 18446744073709551615)
);
INSERT INTO merchant_payment_assets(merchant_id,asset_id,enabled,policy)
 SELECT id,'usdg-devnet',true,'{"id":"USD_CENTS_TO_USDG_1_TO_1","numerator":"10000","denominator":"1"}' FROM merchants;
CREATE FUNCTION default_merchant_payment_asset() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$ BEGIN
 INSERT INTO merchant_payment_assets(merchant_id,asset_id,enabled,policy) VALUES(NEW.id,'usdg-devnet',true,'{"id":"USD_CENTS_TO_USDG_1_TO_1","numerator":"10000","denominator":"1"}');RETURN NEW;END $$;
CREATE TRIGGER merchant_default_asset AFTER INSERT ON merchants FOR EACH ROW EXECUTE FUNCTION default_merchant_payment_asset();
CREATE TABLE payment_quotes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,order_id uuid NOT NULL,
 original_quote_id uuid,price_version_id uuid,price_currency text NOT NULL,price_total_minor numeric(20,0) NOT NULL,
 descriptor jsonb NOT NULL,settlement jsonb NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 historical_attempt_id uuid UNIQUE REFERENCES payment_attempts,
 UNIQUE(merchant_id,order_id,id),FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id)
);
CREATE TABLE order_payment_selection(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,quote_id uuid NOT NULL,
 PRIMARY KEY(merchant_id,order_id),FOREIGN KEY(merchant_id,order_id,quote_id) REFERENCES payment_quotes(merchant_id,order_id,id)
);
CREATE TABLE payment_attempt_assets(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,attempt_id uuid NOT NULL REFERENCES payment_attempts,
 quote_id uuid NOT NULL,descriptor jsonb NOT NULL,settlement jsonb NOT NULL,
 payer text NOT NULL,recipient text NOT NULL,reference text NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(merchant_id,attempt_id),FOREIGN KEY(merchant_id,order_id,quote_id) REFERENCES payment_quotes(merchant_id,order_id,id)
);
CREATE TABLE payment_asset_requests(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,idempotency_key text NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,
 PRIMARY KEY(merchant_id,order_id,idempotency_key),FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id)
);
CREATE FUNCTION immutable_payment_sidecar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_PAYMENT_EVIDENCE' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_payment_quotes BEFORE UPDATE OR DELETE ON payment_quotes FOR EACH ROW EXECUTE FUNCTION immutable_payment_sidecar();
CREATE TRIGGER immutable_attempt_assets BEFORE UPDATE OR DELETE ON payment_attempt_assets FOR EACH ROW EXECUTE FUNCTION immutable_payment_sidecar();
CREATE TRIGGER immutable_asset_requests BEFORE UPDATE OR DELETE ON payment_asset_requests FOR EACH ROW EXECUTE FUNCTION immutable_payment_sidecar();
-- Backfill known USDG only; preserve historical JSON settlement shapes verbatim.
INSERT INTO payment_quotes(merchant_id,order_id,original_quote_id,price_version_id,price_currency,price_total_minor,descriptor,settlement,expires_at)
 SELECT o.merchant_id,o.id,a.quote_id,a.price_version_id,coalesce(a.catalog_currency,'THB'),coalesce(a.total_minor,o.thb_minor),r.descriptor,
 coalesce(a.settlement,jsonb_build_object('currency','USDG','decimals',6,'amountMinor',o.usdg_minor::text,'network','solana:devnet','genesisHash',r.descriptor->>'genesisHash','mint',r.descriptor->>'mint','tokenProgram',r.descriptor->>'tokenProgram','testToken',true,'recipient',o.treasury,'sponsor','merchant_funded')),o.quote_expires_at
 FROM orders o LEFT JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id
 CROSS JOIN payment_assets r WHERE r.asset_id='usdg-devnet' AND (o.authority_version IS NULL OR a.order_id IS NOT NULL) AND (a.order_id IS NULL OR (a.settlement->>'currency'='USDG' AND a.settlement->>'decimals'='6' AND a.settlement->>'genesisHash'=r.descriptor->>'genesisHash' AND a.settlement->>'mint'=r.descriptor->>'mint' AND a.settlement->>'tokenProgram'=r.descriptor->>'tokenProgram'));
INSERT INTO order_payment_selection SELECT merchant_id,order_id,id FROM payment_quotes;
-- Each old attempt gets its own exact original amount/recipient quote; no financial-row writes.
INSERT INTO payment_quotes(merchant_id,order_id,original_quote_id,price_version_id,price_currency,price_total_minor,descriptor,settlement,expires_at,historical_attempt_id)
 SELECT p.merchant_id,p.order_id,a.quote_id,a.price_version_id,coalesce(a.catalog_currency,'THB'),coalesce(a.total_minor,o.thb_minor),r.descriptor,
 jsonb_build_object('currency','USDG','decimals',6,'amountMinor',p.amount_minor::text,'network','solana:devnet','genesisHash',r.descriptor->>'genesisHash','mint',p.mint,'tokenProgram',p.token_program,'testToken',true,'recipient',p.recipient,'sponsor','merchant_funded'),o.quote_expires_at,p.id
 FROM payment_attempts p JOIN orders o ON o.merchant_id=p.merchant_id AND o.id=p.order_id LEFT JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id
 JOIN payment_assets r ON r.asset_id='usdg-devnet' AND p.mint=r.descriptor->>'mint' AND p.token_program=r.descriptor->>'tokenProgram';
INSERT INTO payment_attempt_assets SELECT p.merchant_id,p.order_id,p.id,q.id,q.descriptor,q.settlement,p.payer,p.recipient,p.reference,q.expires_at
 FROM payment_attempts p JOIN payment_quotes q ON q.merchant_id=p.merchant_id AND q.order_id=p.order_id AND q.historical_attempt_id=p.id;
CREATE FUNCTION freeze_new_attempt_asset() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE q payment_quotes%ROWTYPE; BEGIN
 PERFORM 1 FROM orders WHERE merchant_id=NEW.merchant_id AND id=NEW.order_id FOR UPDATE;
 SELECT pq.* INTO q FROM order_payment_selection s JOIN payment_quotes pq ON pq.merchant_id=s.merchant_id AND pq.order_id=s.order_id AND pq.id=s.quote_id WHERE s.merchant_id=NEW.merchant_id AND s.order_id=NEW.order_id;
 IF NOT FOUND OR NEW.mint IS DISTINCT FROM q.descriptor->>'mint' OR NEW.token_program IS DISTINCT FROM q.descriptor->>'tokenProgram' OR NEW.recipient IS DISTINCT FROM q.settlement->>'recipient' OR NEW.amount_minor::text IS DISTINCT FROM q.settlement->>'amountMinor' THEN RAISE EXCEPTION 'PAYMENT_QUOTE_MISMATCH' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM payment_attempts p WHERE p.merchant_id=NEW.merchant_id AND p.order_id=NEW.order_id AND p.id<>NEW.id AND (p.status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED') OR (p.status<>'FINALIZED' AND (p.signature IS NOT NULL OR p.signed_base64 IS NOT NULL) AND p.failure_reconciled_at IS NULL))) THEN RAISE EXCEPTION 'PAYMENT_PENDING' USING ERRCODE='23514';END IF;
 INSERT INTO payment_attempt_assets VALUES(NEW.merchant_id,NEW.order_id,NEW.id,q.id,q.descriptor,q.settlement,NEW.payer,NEW.recipient,NEW.reference,q.expires_at);RETURN NEW;
END $$;
CREATE TRIGGER freeze_attempt_asset AFTER INSERT ON payment_attempts FOR EACH ROW EXECUTE FUNCTION freeze_new_attempt_asset();
CREATE FUNCTION payment_asset_change_safe(p_merchant uuid,p_order uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM orders o WHERE o.merchant_id=p_merchant AND o.id=p_order AND o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT') AND o.quote_expires_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM payment_attempts p WHERE p.merchant_id=o.merchant_id AND p.order_id=o.id AND (p.status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED') OR ((p.signature IS NOT NULL OR p.signed_base64 IS NOT NULL) AND p.failure_reconciled_at IS NULL))));
$$;
-- Freeze default quote once creation's authority exists; historical USDG-only pricing is untouched.
CREATE FUNCTION freeze_default_payment_quote() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE o orders%ROWTYPE;a order_authority%ROWTYPE;r payment_assets%ROWTYPE;q uuid;s jsonb;policy jsonb;product numeric;raw numeric; BEGIN
 IF TG_TABLE_NAME='orders' THEN o:=NEW;IF o.authority_version=2 THEN RETURN NEW;END IF;
 ELSE SELECT * INTO o FROM orders WHERE merchant_id=NEW.merchant_id AND id=NEW.order_id;a:=NEW;END IF;
 SELECT * INTO r FROM payment_assets WHERE asset_id='usdg-devnet';
 s:=coalesce(a.settlement,jsonb_build_object('currency','USDG','decimals',6,'amountMinor',o.usdg_minor::text,'network','solana:devnet','genesisHash',r.descriptor->>'genesisHash','mint',r.descriptor->>'mint','tokenProgram',r.descriptor->>'tokenProgram','testToken',true,'recipient',o.treasury,'sponsor','merchant_funded'));
 s:=s||jsonb_build_object('assetId',r.asset_id,'displayLabel',r.descriptor->>'displayLabel');
 IF a.catalog_currency='USD' THEN
  SELECT registry.*,m.policy INTO r.asset_id,r.descriptor,r.enabled,r.verified_at,policy FROM payment_assets registry JOIN merchant_payment_assets m ON m.asset_id=registry.asset_id WHERE m.merchant_id=o.merchant_id AND m.enabled AND registry.enabled AND registry.verified_at IS NOT NULL ORDER BY (registry.asset_id='usdg-devnet') DESC,registry.asset_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_ASSET_UNAVAILABLE' USING ERRCODE='23514';END IF;
  product:=a.total_minor::numeric*(policy->>'numerator')::numeric;
  IF mod(product,(policy->>'denominator')::numeric)<>0 THEN RAISE EXCEPTION 'NONDIVISIBLE_DENOMINATION' USING ERRCODE='23514';END IF;
  raw:=product/(policy->>'denominator')::numeric;
  IF raw<=0 OR raw>999999999999999999 THEN RAISE EXCEPTION 'INVALID_PAYMENT_AMOUNT' USING ERRCODE='23514';END IF;
  s:=s||jsonb_build_object('assetId',r.asset_id,'displayLabel',r.descriptor->>'displayLabel','currency',r.descriptor->>'symbol','genesisHash',r.descriptor->>'genesisHash','mint',r.descriptor->>'mint','tokenProgram',r.descriptor->>'tokenProgram','amountMinor',raw::numeric(20,0)::text,'denominationPolicy',policy);
 ELSIF a.catalog_currency='USDG' THEN
  s:=s||jsonb_build_object('denominationPolicy',jsonb_build_object('id','USDG_RAW_IDENTITY','numerator','1','denominator','1'));
 END IF;
 INSERT INTO payment_quotes(merchant_id,order_id,original_quote_id,price_version_id,price_currency,price_total_minor,descriptor,settlement,expires_at) VALUES(o.merchant_id,o.id,a.quote_id,a.price_version_id,coalesce(a.catalog_currency,'THB'),coalesce(a.total_minor,o.thb_minor),r.descriptor,s,o.quote_expires_at) RETURNING id INTO q;
 INSERT INTO order_payment_selection VALUES(o.merchant_id,o.id,q);RETURN NEW;
END $$;
CREATE TRIGGER freeze_legacy_default_payment AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION freeze_default_payment_quote();
CREATE TRIGGER freeze_versioned_default_payment AFTER INSERT ON order_authority FOR EACH ROW EXECUTE FUNCTION freeze_default_payment_quote();
GRANT SELECT ON payment_assets TO bitpos_app;
GRANT SELECT,INSERT,UPDATE ON merchant_payment_assets,order_payment_selection TO bitpos_app;
GRANT SELECT,INSERT ON payment_quotes,payment_attempt_assets,payment_asset_requests TO bitpos_app;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['merchant_payment_assets','payment_quotes','order_payment_selection','payment_attempt_assets','payment_asset_requests'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_access ON %I TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);END LOOP;END $$;
REVOKE ALL ON FUNCTION default_merchant_payment_asset(),immutable_payment_sidecar(),freeze_new_attempt_asset(),freeze_default_payment_quote(),payment_asset_change_safe(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION freeze_new_attempt_asset(),freeze_default_payment_quote(),payment_asset_change_safe(uuid,uuid) TO bitpos_app;
