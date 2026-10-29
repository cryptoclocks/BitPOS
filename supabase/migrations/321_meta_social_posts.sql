-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Facebook Page post drafts for an offer: Muse Image makes the picture from the shop's own menu photo, Muse Spark
-- writes the words, and the server adds price, discount and end time. Nothing is published until an owner or manager
-- presses Post; the Graph API result (post id or error code) is kept.
SET search_path TO bitpos,extensions,public;
CREATE TABLE meta_social_posts(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 draft_id uuid NOT NULL,
 caption text NOT NULL CHECK(char_length(caption) BETWEEN 1 AND 2200),
 mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
 image bytea NOT NULL CHECK(octet_length(image) BETWEEN 100 AND 8000000),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','POSTED','FAILED','DISCARDED')),
 fb_post_id text CHECK(fb_post_id ~ '^[0-9_]{1,80}$'),
 failure text CHECK(char_length(failure)<=200),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 decided_by uuid,
 decided_at timestamptz,
 PRIMARY KEY(merchant_id,id)
);
ALTER TABLE meta_social_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_social_post_tenant ON meta_social_posts USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_social_posts TO bitpos_app;
GRANT UPDATE(state,fb_post_id,failure,decided_by,decided_at,caption) ON meta_social_posts TO bitpos_app;
