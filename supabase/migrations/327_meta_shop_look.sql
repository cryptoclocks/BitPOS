-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Shop look for the customer pages (meta-pay): a cover photo, a logo, a one-line tagline and a theme colour, set by
-- an owner or manager in meta-pos. Images are checked by the API (type by magic bytes, size) and served from
-- /meta/look/<merchant>/<kind>-<revision>.<ext>; the colour must keep white text readable (checked by the API).
SET search_path TO bitpos,extensions,public;
CREATE TABLE meta_shop_look(
 merchant_id uuid PRIMARY KEY REFERENCES merchants,
 tagline text NOT NULL DEFAULT '' CHECK(length(tagline)<=120),
 accent text NOT NULL DEFAULT '#0866FF' CHECK(accent ~ '^#[0-9A-F]{6}$'),
 cover bytea CHECK(octet_length(cover) BETWEEN 100 AND 3000000),
 cover_mime text CHECK(cover_mime IN ('image/jpeg','image/png','image/webp')),
 logo bytea CHECK(octet_length(logo) BETWEEN 100 AND 1000000),
 logo_mime text CHECK(logo_mime IN ('image/jpeg','image/png','image/webp')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by uuid,
 CHECK((cover IS NULL)=(cover_mime IS NULL)),
 CHECK((logo IS NULL)=(logo_mime IS NULL))
);
ALTER TABLE meta_shop_look ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON meta_shop_look FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE ON meta_shop_look TO bitpos_app;
