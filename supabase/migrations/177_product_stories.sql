-- Product story shown on the customer product page: a short loop video (5 s, no text in the video), the shop's own story,
-- ingredients and benefits as TEXT in Thai and English. One mutable row per product; owner/manager edit it through the API.
-- video_url is a path of a file shipped with the web build (/videos/menu/<slug>.mp4); there is no upload path yet.
-- Rollback: DROP TABLE bitpos.product_stories;
SET search_path TO bitpos,extensions,public;
CREATE TABLE product_stories(
 merchant_id uuid NOT NULL,
 product_id uuid NOT NULL,
 story text NOT NULL DEFAULT '' CHECK(char_length(story)<=600),
 story_en text NOT NULL DEFAULT '' CHECK(char_length(story_en)<=600),
 ingredients text NOT NULL DEFAULT '' CHECK(char_length(ingredients)<=300),
 ingredients_en text NOT NULL DEFAULT '' CHECK(char_length(ingredients_en)<=300),
 benefits text NOT NULL DEFAULT '' CHECK(char_length(benefits)<=300),
 benefits_en text NOT NULL DEFAULT '' CHECK(char_length(benefits_en)<=300),
 video_url text NOT NULL DEFAULT '' CHECK(video_url='' OR video_url~'^/videos/menu/[a-z0-9-]{1,40}\.mp4$'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,product_id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id)
);
ALTER TABLE product_stories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON product_stories FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE ON product_stories TO bitpos_app;
