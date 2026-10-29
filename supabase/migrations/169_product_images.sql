-- Merchant-uploaded product photos (demo-grade). Bytes live in this table; products.image_url keeps the stable public
-- path /images/products/<id>. The database itself enforces the limits (<=1 MiB, JPEG/PNG/WebP, matching magic bytes,
-- sha256 equals the stored bytes) so a bug in the API cannot store something else. Rows are immutable and deduplicated
-- per merchant by content hash. Public reads go through one SECURITY DEFINER lookup by the unguessable id.
SET search_path TO bitpos,extensions,public;
CREATE TABLE product_images(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 content_sha256 text NOT NULL CHECK(content_sha256~'^[0-9a-f]{64}$'),
 mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
 bytes bytea NOT NULL,
 size integer NOT NULL CHECK(size BETWEEN 1 AND 1048576),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 UNIQUE(id),
 UNIQUE(merchant_id,content_sha256),
 CHECK(octet_length(bytes)=size),
 CHECK(content_sha256=encode(sha256(bytes),'hex')),
 CHECK(
  (mime='image/jpeg' AND substring(bytes FROM 1 FOR 3)='\xffd8ff'::bytea)
  OR (mime='image/png' AND substring(bytes FROM 1 FOR 8)='\x89504e470d0a1a0a'::bytea)
  OR (mime='image/webp' AND substring(bytes FROM 1 FOR 4)='\x52494646'::bytea AND substring(bytes FROM 9 FOR 4)='\x57454250'::bytea))
);
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON product_images FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON product_images TO bitpos_app;
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON product_images FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION product_image_public(p_id uuid) RETURNS TABLE(mime text,bytes bytea,content_sha256 text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$ SELECT i.mime,i.bytes,i.content_sha256 FROM bitpos.product_images i WHERE i.id=p_id $$;
REVOKE ALL ON FUNCTION product_image_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION product_image_public(uuid) TO bitpos_app;
