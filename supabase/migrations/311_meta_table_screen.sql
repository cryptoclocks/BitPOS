-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Table screen: a tablet or phone standing at a booked table shows the booking countdown (free / reserved from
-- HH:MM / check-in window counting down / seated). The screen URL carries the tag id and a key derived from the
-- tap master key, so tables cannot be enumerated. This function only maps an active tag to its shop and device,
-- like meta_record_tap does before tenant context exists; everything else runs under the shop's tenant setting.
SET search_path TO bitpos,extensions,public;

CREATE FUNCTION bitpos.meta_tag_device(p_tag_id text) RETURNS TABLE(merchant_id uuid,device_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT t.merchant_id,t.device_id FROM meta_ntag_tags t WHERE t.tag_id=p_tag_id AND t.retired_at IS NULL $$;
REVOKE ALL ON FUNCTION bitpos.meta_tag_device(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_tag_device(text) TO bitpos_app;
