-- Shop cover photo for the customer app branch page: a path of a file shipped with the web build (/images/cover/<slug>.jpg).
-- NULL means "no cover" (the app shows the neutral storefront placeholder). Rollback: ALTER TABLE bitpos.marketplace_branches DROP COLUMN cover_url;
SET search_path TO bitpos,extensions,public;
ALTER TABLE marketplace_branches ADD COLUMN cover_url text CHECK(cover_url IS NULL OR cover_url~'^/images/cover/[a-z0-9-]{1,60}\.jpg$');
