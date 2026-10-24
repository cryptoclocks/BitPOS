-- Canonical coupon arithmetic only. No public/app grant until the owned-quote
-- adapter, quota/funding reservations and checkout lifecycle are integrated.
SET search_path=bitpos,public;
CREATE FUNCTION coupon096_minor(value jsonb)RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF jsonb_typeof(value)IS DISTINCT FROM 'string' OR(value#>>'{}')!~'^(0|[1-9][0-9]{0,17})$'THEN RAISE EXCEPTION 'INVALID_COUPON_MONEY';END IF;
 RETURN(value#>>'{}')::bigint;
END $$;
CREATE FUNCTION coupon096_price(terms jsonb,food_lines jsonb)RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE minimum bigint;maximum bigint;merchant_bps integer;discount_bps integer;food numeric;discount numeric;requested numeric;merchant numeric;allocated numeric;items jsonb;line jsonb;
BEGIN
 IF jsonb_typeof(terms)IS DISTINCT FROM 'object' OR NOT terms ?& ARRAY['minimumFoodMinor','maximumDiscountMinor','discount','merchantFundingBps']OR(SELECT count(*)FROM jsonb_object_keys(terms))<>4 THEN RAISE EXCEPTION 'INVALID_COUPON_TERMS';END IF;
 minimum:=coupon096_minor(terms->'minimumFoodMinor');maximum:=coupon096_minor(terms->'maximumDiscountMinor');IF maximum=0 THEN RAISE EXCEPTION 'INVALID_COUPON_CAP';END IF;
 IF jsonb_typeof(terms->'merchantFundingBps')IS DISTINCT FROM 'number'OR(terms->>'merchantFundingBps')!~'^(0|[1-9][0-9]{0,4})$'OR(terms->>'merchantFundingBps')::numeric>10000 THEN RAISE EXCEPTION 'INVALID_COUPON_BASIS_POINTS';END IF;merchant_bps:=(terms->>'merchantFundingBps')::integer;
 IF jsonb_typeof(food_lines)IS DISTINCT FROM 'array'OR jsonb_array_length(food_lines)NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_COUPON_LINES';END IF;
 food:=0;
 FOR line IN SELECT value FROM jsonb_array_elements(food_lines)LOOP
  IF jsonb_typeof(line)IS DISTINCT FROM 'object'OR NOT line ?& ARRAY['lineId','amountMinor']OR(SELECT count(*)FROM jsonb_object_keys(line))<>2
  OR jsonb_typeof(line->'lineId')IS DISTINCT FROM 'string'OR(line->>'lineId')!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'THEN RAISE EXCEPTION 'INVALID_COUPON_LINE_ID';END IF;
  food:=food+coupon096_minor(line->'amountMinor');
 END LOOP;
 IF(SELECT count(DISTINCT value->>'lineId')FROM jsonb_array_elements(food_lines))<>jsonb_array_length(food_lines)THEN RAISE EXCEPTION 'INVALID_COUPON_LINE_ID';END IF;
 IF food>999999999999999999 THEN RAISE EXCEPTION 'COUPON_AMOUNT_OVERFLOW';END IF;
 IF food<minimum THEN RAISE EXCEPTION 'COUPON_MINIMUM_NOT_MET';END IF;
 IF food=0 THEN RAISE EXCEPTION 'COUPON_NO_DISCOUNTABLE_FOOD';END IF;
 IF jsonb_typeof(terms->'discount')IS DISTINCT FROM 'object'OR(SELECT count(*)FROM jsonb_object_keys(terms->'discount'))<>2 THEN RAISE EXCEPTION 'INVALID_COUPON_DISCOUNT_KIND';END IF;
 IF terms->'discount'->>'kind'='FIXED'THEN
  IF NOT(terms->'discount')?'fixedMinor'THEN RAISE EXCEPTION 'INVALID_COUPON_FIXED_AMOUNT';END IF;
  requested:=coupon096_minor(terms->'discount'->'fixedMinor');IF requested=0 THEN RAISE EXCEPTION 'INVALID_COUPON_FIXED_AMOUNT';END IF;
 ELSIF terms->'discount'->>'kind'='BASIS_POINTS'THEN
  IF jsonb_typeof(terms->'discount'->'basisPoints')IS DISTINCT FROM 'number'OR(terms->'discount'->>'basisPoints')!~'^[1-9][0-9]{0,4}$'OR(terms->'discount'->>'basisPoints')::numeric>10000 THEN RAISE EXCEPTION 'INVALID_COUPON_BASIS_POINTS';END IF;
  discount_bps:=(terms->'discount'->>'basisPoints')::integer;requested:=floor(food*discount_bps/10000);
 ELSE RAISE EXCEPTION 'INVALID_COUPON_DISCOUNT_KIND';END IF;
 discount:=least(food,maximum,requested);IF discount=0 THEN RAISE EXCEPTION 'COUPON_DISCOUNT_ROUNDS_TO_ZERO';END IF;
 SELECT sum(floor(discount*coupon096_minor(value->'amountMinor')/food))INTO allocated FROM jsonb_array_elements(food_lines);
 WITH base AS(SELECT value->>'lineId' line_id,coupon096_minor(value->'amountMinor') food_minor,
 floor(discount*coupon096_minor(value->'amountMinor')/food)::bigint base_minor,mod(discount*coupon096_minor(value->'amountMinor'),food) remainder FROM jsonb_array_elements(food_lines)),
 ranked AS(SELECT *,row_number()OVER(ORDER BY remainder DESC,line_id COLLATE "C")position FROM base),
 final AS(SELECT *,base_minor+CASE WHEN position<=discount-allocated THEN 1 ELSE 0 END final_minor FROM ranked)
 SELECT jsonb_agg(jsonb_build_object('lineId',line_id,'foodMinor',food_minor::text,'discountMinor',final_minor::text,'payableFoodMinor',(food_minor-final_minor)::text)ORDER BY line_id COLLATE "C")INTO items FROM final;
 merchant:=floor(discount*merchant_bps/10000);
 RETURN jsonb_build_object('foodMinor',food::bigint::text,'discountMinor',discount::bigint::text,'payableFoodMinor',(food-discount)::bigint::text,'merchantFundingMinor',merchant::bigint::text,'platformFundingMinor',(discount-merchant)::bigint::text,'lines',items);
END $$;
REVOKE ALL ON FUNCTION coupon096_minor(jsonb),coupon096_price(jsonb,jsonb)FROM PUBLIC,bitpos_app;

CREATE FUNCTION coupon096_identifier(value jsonb)RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF jsonb_typeof(value)IS DISTINCT FROM 'string'OR(value#>>'{}')!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'THEN RAISE EXCEPTION 'INVALID_COMMERCE_POLICY_ID';END IF;RETURN value#>>'{}';
END $$;
CREATE FUNCTION coupon096_rate(value jsonb)RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF jsonb_typeof(value)IS DISTINCT FROM 'number'OR(value#>>'{}')!~'^(0|[1-9][0-9]{0,4})$'OR(value#>>'{}')::numeric>10000 THEN RAISE EXCEPTION 'INVALID_COMMERCE_RATE';END IF;RETURN(value#>>'{}')::integer;
END $$;
CREATE FUNCTION coupon096_money(amount numeric,currency text,decimals integer)RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF amount<0 OR amount>999999999999999999 OR amount<>floor(amount)THEN RAISE EXCEPTION 'COMMERCE_AMOUNT_OVERFLOW';END IF;RETURN jsonb_build_object('currency',currency,'decimals',decimals,'amountMinor',amount::bigint::text);
END $$;
CREATE FUNCTION coupon096_commerce(input jsonb)RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE currency text;decimals integer;serving text;food numeric:=0;delivery numeric;service numeric;tip numeric;max_tip numeric;tip_cap numeric;tax_base numeric;tax numeric;tax_rate integer;tip_rate integer;
 merchant_fee numeric;driver_fee numeric;platform_fee numeric;discounted_food numeric;merchant_discount numeric:=0;subsidy numeric:=0;payable numeric;merchant numeric;driver numeric;platform numeric;cp jsonb;line jsonb;tip_party text;
BEGIN
 IF jsonb_typeof(input)IS DISTINCT FROM 'object'OR NOT input ?& ARRAY['currency','decimals','serving','foodLines','deliveryFeeMinor','serviceFeeMinor','feeAllocation','taxPolicy','tipPolicy','tipMinor']
 OR input-ARRAY['currency','decimals','serving','foodLines','deliveryFeeMinor','serviceFeeMinor','feeAllocation','taxPolicy','tipPolicy','tipMinor','coupon']<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_COMMERCE_INPUT';END IF;
 IF jsonb_typeof(input->'currency')IS DISTINCT FROM 'string'OR jsonb_typeof(input->'decimals')IS DISTINCT FROM 'number'OR(input->>'decimals')!~'^[246]$'THEN RAISE EXCEPTION 'INVALID_COMMERCE_DENOMINATION';END IF;
 currency:=input->>'currency';decimals:=(input->>'decimals')::integer;
 IF NOT(currency='USD'AND decimals IN(2,4)OR currency='THB'AND decimals=2 OR currency='USDG'AND decimals=6)THEN RAISE EXCEPTION 'INVALID_COMMERCE_DENOMINATION';END IF;
 serving:=input->>'serving';IF jsonb_typeof(input->'serving')IS DISTINCT FROM 'string'OR serving NOT IN('pickup','delivery')THEN RAISE EXCEPTION 'INVALID_COMMERCE_SERVING';END IF;
 IF jsonb_typeof(input->'foodLines')IS DISTINCT FROM 'array'OR jsonb_array_length(input->'foodLines')NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_COMMERCE_LINES';END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(input->'foodLines')LOOP
  IF jsonb_typeof(line)IS DISTINCT FROM 'object'OR NOT line ?& ARRAY['lineId','amountMinor']OR(SELECT count(*)FROM jsonb_object_keys(line))<>2 THEN RAISE EXCEPTION 'INVALID_COMMERCE_LINES';END IF;
  PERFORM coupon096_identifier(line->'lineId');food:=food+coupon096_minor(line->'amountMinor');
 END LOOP;
 IF(SELECT count(DISTINCT value->>'lineId')FROM jsonb_array_elements(input->'foodLines'))<>jsonb_array_length(input->'foodLines')THEN RAISE EXCEPTION 'INVALID_COMMERCE_LINES';END IF;
 delivery:=coupon096_minor(input->'deliveryFeeMinor');service:=coupon096_minor(input->'serviceFeeMinor');tip:=coupon096_minor(input->'tipMinor');
 IF jsonb_typeof(input->'feeAllocation')IS DISTINCT FROM 'object'OR NOT(input->'feeAllocation')?& ARRAY['merchantMinor','driverMinor','platformMinor']OR(SELECT count(*)FROM jsonb_object_keys(input->'feeAllocation'))<>3 THEN RAISE EXCEPTION 'INVALID_COMMERCE_FEE_POLICY';END IF;
 merchant_fee:=coupon096_minor(input->'feeAllocation'->'merchantMinor');driver_fee:=coupon096_minor(input->'feeAllocation'->'driverMinor');platform_fee:=coupon096_minor(input->'feeAllocation'->'platformMinor');
 IF merchant_fee+driver_fee+platform_fee<>delivery+service THEN RAISE EXCEPTION 'COMMERCE_FEE_ALLOCATION_MISMATCH';END IF;
 IF jsonb_typeof(input->'taxPolicy')IS DISTINCT FROM 'object'OR NOT(input->'taxPolicy')?& ARRAY['id','basisPoints','taxableDelivery','taxableService']OR(SELECT count(*)FROM jsonb_object_keys(input->'taxPolicy'))<>4
 OR jsonb_typeof(input->'taxPolicy'->'taxableDelivery')IS DISTINCT FROM 'boolean'OR jsonb_typeof(input->'taxPolicy'->'taxableService')IS DISTINCT FROM 'boolean'THEN RAISE EXCEPTION 'INVALID_COMMERCE_TAX_POLICY';END IF;
 PERFORM coupon096_identifier(input->'taxPolicy'->'id');tax_rate:=coupon096_rate(input->'taxPolicy'->'basisPoints');
 IF jsonb_typeof(input->'tipPolicy')IS DISTINCT FROM 'object'OR NOT(input->'tipPolicy')?& ARRAY['id','maximumMinor','maximumFoodBps','party']OR(SELECT count(*)FROM jsonb_object_keys(input->'tipPolicy'))<>4 THEN RAISE EXCEPTION 'INVALID_COMMERCE_TIP_POLICY';END IF;
 PERFORM coupon096_identifier(input->'tipPolicy'->'id');max_tip:=coupon096_minor(input->'tipPolicy'->'maximumMinor');tip_rate:=coupon096_rate(input->'tipPolicy'->'maximumFoodBps');tip_party:=input->'tipPolicy'->>'party';
 IF jsonb_typeof(input->'tipPolicy'->'party')IS DISTINCT FROM 'string'OR tip_party NOT IN('MERCHANT','DRIVER','PLATFORM')THEN RAISE EXCEPTION 'INVALID_COMMERCE_TIP_PARTY';END IF;
 IF serving='pickup'AND(delivery<>0 OR driver_fee<>0 OR tip<>0 AND tip_party='DRIVER')THEN RAISE EXCEPTION 'COMMERCE_DRIVER_REQUIRES_DELIVERY';END IF;
 IF input?'coupon'THEN
  IF jsonb_typeof(input->'coupon')IS DISTINCT FROM 'object'OR NOT(input->'coupon')?& ARRAY['versionId','terms']OR(SELECT count(*)FROM jsonb_object_keys(input->'coupon'))<>2 THEN RAISE EXCEPTION 'INVALID_COUPON_TERMS';END IF;
  PERFORM coupon096_identifier(input->'coupon'->'versionId');cp:=coupon096_price(input->'coupon'->'terms',input->'foodLines');discounted_food:=(cp->>'payableFoodMinor')::numeric;merchant_discount:=(cp->>'merchantFundingMinor')::numeric;subsidy:=(cp->>'platformFundingMinor')::numeric;
 ELSE discounted_food:=food;END IF;
 tip_cap:=least(max_tip,floor(discounted_food*tip_rate/10000));IF tip>tip_cap THEN RAISE EXCEPTION 'COMMERCE_TIP_LIMIT_EXCEEDED';END IF;
 tax_base:=discounted_food+CASE WHEN(input->'taxPolicy'->>'taxableDelivery')::boolean THEN delivery ELSE 0 END+CASE WHEN(input->'taxPolicy'->>'taxableService')::boolean THEN service ELSE 0 END;tax:=floor(tax_base*tax_rate/10000);
 payable:=discounted_food+delivery+service+tax+tip;merchant:=food-merchant_discount+merchant_fee+CASE WHEN tip_party='MERCHANT'THEN tip ELSE 0 END;driver:=driver_fee+CASE WHEN tip_party='DRIVER'THEN tip ELSE 0 END;platform:=platform_fee+CASE WHEN tip_party='PLATFORM'THEN tip ELSE 0 END;
 IF payable+subsidy<>merchant+driver+platform+tax THEN RAISE EXCEPTION 'COMMERCE_FUNDING_IMBALANCE';END IF;
 PERFORM coupon096_money(food,currency,decimals);PERFORM coupon096_money(delivery+service,currency,decimals);PERFORM coupon096_money(payable+subsidy,currency,decimals);
 RETURN jsonb_build_object('pricingVersion','commerce-pricing-v1','couponVersionId',input->'coupon'->'versionId','taxPolicyId',input->'taxPolicy'->'id','tipPolicyId',input->'tipPolicy'->'id',
 'food',coupon096_money(food,currency,decimals),'couponDiscount',coupon096_money(CASE WHEN cp IS NULL THEN 0 ELSE(cp->>'discountMinor')::numeric END,currency,decimals),'foodAfterDiscount',coupon096_money(discounted_food,currency,decimals),
 'deliveryFee',coupon096_money(delivery,currency,decimals),'serviceFee',coupon096_money(service,currency,decimals),'taxableBase',coupon096_money(tax_base,currency,decimals),'tax',coupon096_money(tax,currency,decimals),'tip',coupon096_money(tip,currency,decimals),'tipCap',coupon096_money(tip_cap,currency,decimals),'total',coupon096_money(payable,currency,decimals),'requiresPayment',payable>0,
 'platformContribution',coupon096_money(subsidy,currency,decimals),'receivables',jsonb_build_object('merchant',coupon096_money(merchant,currency,decimals),'driver',coupon096_money(driver,currency,decimals),'platform',coupon096_money(platform,currency,decimals),'tax',coupon096_money(tax,currency,decimals)),'coupon',cp);
END $$;
REVOKE ALL ON FUNCTION coupon096_identifier(jsonb),coupon096_rate(jsonb),coupon096_money(numeric,text,integer),coupon096_commerce(jsonb)FROM PUBLIC,bitpos_app;
