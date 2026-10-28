-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- A Messenger Page can move to another shop: the Meta demo moves from the shared Purple Cafe to its own demo shop
-- (Muse Café) while Purple Cafe's earlier customer links stay intact. The old row is retired, never deleted; only
-- one shop holds a Page at a time. Lookups already read only rows where retired_at IS NULL.
SET search_path TO bitpos,extensions,public;

ALTER TABLE meta_messenger_pages DROP CONSTRAINT meta_messenger_pages_pkey;
ALTER TABLE meta_messenger_pages ADD PRIMARY KEY(merchant_id,page_id);
CREATE UNIQUE INDEX meta_messenger_page_holder ON meta_messenger_pages(page_id) WHERE retired_at IS NULL;
