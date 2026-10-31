-- DS45: customer discovery exposes openNow/nextOpenAt derived from the existing
-- merchant_opening_hours row. Computed on the server clock in the hours zone;
-- null means hours are not configured (unknown, never "closed"). Orders are not
-- refused by this change. Rollback: restore the 091 function body and drop the helper.
SET search_path=bitpos,public;
CREATE FUNCTION branch_open_state(p_merchant uuid,p_at timestamptz,OUT open_now boolean,OUT next_open timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE tz text;wk jsonb;loc timestamp;dow integer;mins integer;d integer;w jsonb;o integer;c integer;
BEGIN
 SELECT h.time_zone,h.week INTO tz,wk FROM merchant_opening_hours h WHERE h.merchant_id=p_merchant;
 IF NOT FOUND THEN RETURN; END IF;
 loc:=p_at AT TIME ZONE tz;dow:=extract(dow FROM loc)::integer;mins:=extract(hour FROM loc)::integer*60+extract(minute FROM loc)::integer;
 open_now:=false;
 FOR d IN 0..7 LOOP
  FOR w IN SELECT e FROM jsonb_array_elements(coalesce(wk->(((dow+d)%7)::text),'[]'::jsonb)) e ORDER BY e->>'opens' LOOP
   o:=substr(w->>'opens',1,2)::integer*60+substr(w->>'opens',4,2)::integer;c:=substr(w->>'closes',1,2)::integer*60+substr(w->>'closes',4,2)::integer;
   IF d=0 AND o<=mins AND mins<c THEN open_now:=true;RETURN; END IF;
   IF d>0 OR o>mins THEN next_open:=(date_trunc('day',loc)+make_interval(days=>d,mins=>o)) AT TIME ZONE tz;RETURN; END IF;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION branch_open_state(uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION branch_open_state(uuid,timestamptz) TO bitpos_app;
CREATE OR REPLACE FUNCTION mobile_public_branches(p_branch uuid,p_after uuid,p_limit integer,p_search text,p_serving text)
RETURNS TABLE(merchant_id uuid,profile jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 31 OR p_search IS NULL OR char_length(p_search)>100 OR p_serving IS NULL OR p_serving NOT IN('all','pickup','delivery') THEN
  RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='22023';
 END IF;
 RETURN QUERY SELECT b.merchant_id,jsonb_build_object('id',b.id,'merchantId',b.merchant_id,'merchantName',m.name,
 'name',b.name,'nameEn',coalesce(b.name_en,''),'addressLabel',coalesce(b.address_label,''),
 'pickupEnabled',b.pickup_enabled,'deliveryEnabled',b.delivery_enabled,'version',b.version,
 'openNow',s.open_now,'nextOpenAt',CASE WHEN s.open_now IS NOT TRUE THEN to_char(s.next_open AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') END)
 FROM marketplace_branches b JOIN merchants m ON m.id=b.merchant_id
 CROSS JOIN LATERAL branch_open_state(b.merchant_id,clock_timestamp()) s
 WHERE b.enabled AND (p_branch IS NULL OR b.id=p_branch) AND (p_after IS NULL OR b.id>p_after)
 AND (p_serving='all' OR p_serving='pickup' AND b.pickup_enabled OR p_serving='delivery' AND b.delivery_enabled)
 AND (p_search='' OR strpos(lower(b.name),lower(p_search))>0 OR strpos(lower(coalesce(b.name_en,'')),lower(p_search))>0
 OR strpos(lower(m.name),lower(p_search))>0 OR strpos(lower(coalesce(b.address_label,'')),lower(p_search))>0)
 ORDER BY b.id LIMIT p_limit;
END $$;
