-- Local preparation only; no actual-use activation. Search is literal text,
-- never a claim of proximity, opening-hours availability or delivery coverage.
SET search_path=bitpos,public;
DROP FUNCTION mobile_public_branches(uuid,uuid,integer);
CREATE FUNCTION mobile_public_branches(p_branch uuid,p_after uuid,p_limit integer,p_search text,p_serving text)
RETURNS TABLE(merchant_id uuid,profile jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 31 OR p_search IS NULL OR char_length(p_search)>100 OR p_serving IS NULL OR p_serving NOT IN('all','pickup','delivery') THEN
  RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='22023';
 END IF;
 RETURN QUERY SELECT b.merchant_id,jsonb_build_object('id',b.id,'merchantId',b.merchant_id,'merchantName',m.name,
 'name',b.name,'nameEn',coalesce(b.name_en,''),'addressLabel',coalesce(b.address_label,''),
 'pickupEnabled',b.pickup_enabled,'deliveryEnabled',b.delivery_enabled,'version',b.version)
 FROM marketplace_branches b JOIN merchants m ON m.id=b.merchant_id
 WHERE b.enabled AND (p_branch IS NULL OR b.id=p_branch) AND (p_after IS NULL OR b.id>p_after)
 AND (p_serving='all' OR p_serving='pickup' AND b.pickup_enabled OR p_serving='delivery' AND b.delivery_enabled)
 AND (p_search='' OR strpos(lower(b.name),lower(p_search))>0 OR strpos(lower(coalesce(b.name_en,'')),lower(p_search))>0
 OR strpos(lower(m.name),lower(p_search))>0 OR strpos(lower(coalesce(b.address_label,'')),lower(p_search))>0)
 ORDER BY b.id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION mobile_public_branches(uuid,uuid,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mobile_public_branches(uuid,uuid,integer,text,text) TO bitpos_app;
