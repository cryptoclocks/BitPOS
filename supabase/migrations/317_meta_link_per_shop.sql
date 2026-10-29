-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Consent is per shop. When a Messenger Page moved to another shop (migration 312), a customer's active link with
-- the previous shop blocked a new consent: the unique index spanned all shops, so the insert was skipped and the new
-- shop (row-level security) could not see the old row. One active link per shop, Page and customer.
SET search_path TO bitpos,extensions,public;
DROP INDEX meta_customer_link_active;
CREATE UNIQUE INDEX meta_customer_link_active ON meta_customer_links(merchant_id,page_id,psid) WHERE revoked_at IS NULL;
