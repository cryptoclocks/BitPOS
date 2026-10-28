-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Ordering by chat: a consented Messenger customer's quotes and orders carry their link, and pay through a
-- hosted Stripe Checkout (test mode). CONFIRMED still comes only from a signed webhook or a server-side
-- Stripe lookup matched to the row (source 'lookup'), never from the customer's return redirect.
SET search_path TO bitpos,extensions,public;

ALTER TABLE meta_quotes ADD COLUMN link_id uuid,
 ADD FOREIGN KEY(merchant_id,link_id) REFERENCES meta_customer_links(merchant_id,id),
 ADD CHECK((channel='messenger')=(link_id IS NOT NULL));

ALTER TABLE meta_agent_orders ADD COLUMN link_id uuid,
 ADD COLUMN stripe_checkout_id text UNIQUE CHECK(stripe_checkout_id ~ '^cs_test_[A-Za-z0-9]{1,200}$'),
 ADD COLUMN checkout_url text CHECK(checkout_url ~ '^https://checkout\.stripe\.com/'),
 ADD FOREIGN KEY(merchant_id,link_id) REFERENCES meta_customer_links(merchant_id,id),
 ADD CHECK((stripe_checkout_id IS NULL)=(checkout_url IS NULL)),
 DROP CONSTRAINT meta_agent_orders_confirmed_source_check,
 ADD CONSTRAINT meta_agent_orders_confirmed_source_check CHECK(confirmed_source IN ('charge','webhook','lookup'));

GRANT UPDATE(stripe_checkout_id,checkout_url) ON meta_agent_orders TO bitpos_app;
