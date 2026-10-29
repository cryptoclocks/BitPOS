-- Add USD fixed-point precision without modifying historical financial evidence.
SET search_path=bitpos,public;
DO $$DECLARE c record;BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='bitpos.catalog_price_versions'::regclass AND contype='c' AND (pg_get_constraintdef(oid) LIKE '%decimals%' OR pg_get_constraintdef(oid) LIKE '%quote_policy%') LOOP EXECUTE format('ALTER TABLE bitpos.catalog_price_versions DROP CONSTRAINT %I',c.conname);END LOOP;
END $$;
ALTER TABLE catalog_price_versions ADD CONSTRAINT catalog_precision_policy CHECK(
 (currency='THB' AND decimals=2 AND quote_policy IS NULL) OR
 (currency='USD' AND decimals=2 AND quote_policy='USD_CENTS_TO_USDG_1_TO_1') OR
 (currency='USD' AND decimals=4 AND quote_policy='USD_FIXED4_TO_USDG_1_TO_1') OR
 (currency='USDG' AND decimals=6 AND quote_policy='USDG_RAW_IDENTITY'));
CREATE OR REPLACE FUNCTION bitpos.policy_for_precision(p jsonb,d smallint) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE n numeric;den numeric;common numeric;name text;BEGIN
 IF d=2 THEN RETURN p;END IF;
 IF d<>4 THEN RAISE EXCEPTION 'INVALID_USD_PRECISION' USING ERRCODE='23514';END IF;
 n:=(p->>'numerator')::numeric;den:=(p->>'denominator')::numeric*100;common:=gcd(n,den);n:=n/common;den:=den/common;
 name:=replace(p->>'id','USD_CENTS','USD_FIXED4');
 IF n<1 OR den<1 OR n>18446744073709551615 OR den>18446744073709551615 OR octet_length(name)>64 THEN RAISE EXCEPTION 'INVALID_PRECISION_POLICY' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('id',name,'numerator',n::numeric(20,0)::text,'denominator',den::numeric(20,0)::text);
END $$;
REVOKE ALL ON FUNCTION bitpos.policy_for_precision(jsonb,smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.policy_for_precision(jsonb,smallint) TO bitpos_app;

CREATE OR REPLACE FUNCTION guard_quote_money() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v catalog_price_versions; amount numeric; BEGIN
 SELECT * INTO STRICT v FROM catalog_price_versions WHERE merchant_id=NEW.merchant_id AND id=NEW.price_version_id;
 SELECT sum((l->'unitPrice'->>'amountMinor')::numeric*(l->>'qty')::numeric) INTO amount FROM jsonb_array_elements(NEW.lines) l;
 IF v.currency NOT IN ('USD','USDG') OR amount<>NEW.total_minor
 OR NEW.usdg_minor::numeric<>NEW.total_minor::numeric*(CASE WHEN v.currency='USD' THEN power(10::numeric,6-v.decimals) ELSE 1 END)
 OR NEW.settlement IS DISTINCT FROM jsonb_build_object('currency','USDG','decimals',6,'amountMinor',NEW.usdg_minor::text,'network','solana:devnet','genesisHash','EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','mint','4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7','tokenProgram','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb','testToken',true,'recipient',NEW.treasury,'sponsor','merchant_funded')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.lines) l WHERE l->'unitPrice'->>'currency'<>v.currency OR (l->'unitPrice'->>'decimals')::int<>v.decimals OR l->>'priceVersion'<>v.id::text OR (l->>'qty')::int NOT BETWEEN 1 AND 100 OR (l->'unitPrice'->>'amountMinor')::bigint<=0)
 THEN RAISE EXCEPTION 'invalid canonical quote money' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION freeze_default_payment_quote() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE o orders%ROWTYPE;a order_authority%ROWTYPE;r payment_assets%ROWTYPE;q uuid;s jsonb;policy jsonb;product numeric;raw numeric; BEGIN
 IF TG_TABLE_NAME='orders' THEN o:=NEW;IF o.authority_version=2 THEN RETURN NEW;END IF;
 ELSE SELECT * INTO o FROM orders WHERE merchant_id=NEW.merchant_id AND id=NEW.order_id;a:=NEW;END IF;
 SELECT * INTO r FROM payment_assets WHERE asset_id='usdg-devnet';
 s:=coalesce(a.settlement,jsonb_build_object('currency','USDG','decimals',6,'amountMinor',o.usdg_minor::text,'network','solana:devnet','genesisHash',r.descriptor->>'genesisHash','mint',r.descriptor->>'mint','tokenProgram',r.descriptor->>'tokenProgram','testToken',true,'recipient',o.treasury,'sponsor','merchant_funded'));
 s:=s||jsonb_build_object('assetId',r.asset_id,'displayLabel',r.descriptor->>'displayLabel');
 IF a.catalog_currency='USD' THEN
  SELECT registry.*,m.policy INTO r.asset_id,r.descriptor,r.enabled,r.verified_at,policy FROM payment_assets registry JOIN merchant_payment_assets m ON m.asset_id=registry.asset_id WHERE m.merchant_id=o.merchant_id AND m.enabled AND registry.enabled AND registry.verified_at IS NOT NULL ORDER BY (registry.asset_id='usdg-devnet') DESC,registry.asset_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_ASSET_UNAVAILABLE' USING ERRCODE='23514';END IF;
  policy:=bitpos.policy_for_precision(policy,a.catalog_decimals);
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
