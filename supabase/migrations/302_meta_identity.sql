-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Customer identity through Messenger: a customer becomes known to a shop only after accepting the
-- consent prompt in the shop's Messenger thread. Identity is the page-scoped id (PSID) Meta gives the
-- shop's Page; no profile, social graph or face data is stored. Tokens are stored only as SHA-256.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_messenger_pages(
 page_id text PRIMARY KEY CHECK(page_id ~ '^[0-9]{5,25}$'),
 merchant_id uuid NOT NULL REFERENCES merchants,
 page_username text NOT NULL CHECK(page_username ~ '^[A-Za-z0-9.]{5,50}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 retired_at timestamptz,
 UNIQUE(merchant_id,page_id)
);
CREATE UNIQUE INDEX meta_messenger_page_current ON meta_messenger_pages(merchant_id) WHERE retired_at IS NULL;

CREATE TABLE meta_customer_links(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 page_id text NOT NULL,
 psid text NOT NULL CHECK(psid ~ '^[0-9]{5,25}$'),
 consent_version text NOT NULL CHECK(consent_version='bitpos-meta-offers-v1'),
 consented_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,page_id) REFERENCES meta_messenger_pages(merchant_id,page_id),
 CHECK(revoked_at IS NULL OR revoked_at>=consented_at)
);
CREATE UNIQUE INDEX meta_customer_link_active ON meta_customer_links(page_id,psid) WHERE revoked_at IS NULL;

-- One-time `ref` carried by the m.me link from a verified tap to the Messenger webhook.
CREATE TABLE meta_messenger_refs(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 tap_session_id uuid NOT NULL,
 ref_sha256 bytea NOT NULL UNIQUE CHECK(octet_length(ref_sha256)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 consumed_psid text CHECK(consumed_psid ~ '^[0-9]{5,25}$'),
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,tap_session_id),
 FOREIGN KEY(merchant_id,tap_session_id) REFERENCES meta_tap_sessions(merchant_id,id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes'),
 CHECK((consumed_at IS NULL)=(consumed_psid IS NULL))
);

CREATE TABLE meta_consent_requests(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 page_id text NOT NULL,
 psid text NOT NULL CHECK(psid ~ '^[0-9]{5,25}$'),
 tap_session_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 decided_at timestamptz,
 decision text CHECK(decision IN ('ACCEPTED','DECLINED')),
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,page_id) REFERENCES meta_messenger_pages(merchant_id,page_id),
 FOREIGN KEY(merchant_id,tap_session_id) REFERENCES meta_tap_sessions(merchant_id,id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes'),
 CHECK((decided_at IS NULL)=(decision IS NULL))
);

-- Single-use link sent in Messenger that signs the customer in on the web page (sets the cookie).
CREATE TABLE meta_magic_links(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 link_id uuid NOT NULL,
 tap_session_id uuid,
 token_sha256 bytea NOT NULL UNIQUE CHECK(octet_length(token_sha256)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,link_id) REFERENCES meta_customer_links(merchant_id,id),
 FOREIGN KEY(merchant_id,tap_session_id) REFERENCES meta_tap_sessions(merchant_id,id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes'),
 CHECK(consumed_at IS NULL OR (consumed_at>=created_at AND consumed_at<expires_at))
);

CREATE TABLE meta_customer_sessions(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 link_id uuid NOT NULL,
 token_sha256 bytea NOT NULL UNIQUE CHECK(octet_length(token_sha256)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,link_id) REFERENCES meta_customer_links(merchant_id,id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days')
);

-- Webhook deliveries are retried by Meta; each event takes effect once.
CREATE TABLE meta_messenger_events(
 merchant_id uuid NOT NULL,
 event_sha256 bytea NOT NULL CHECK(octet_length(event_sha256)=32),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,event_sha256)
);

-- A verified tap becomes "who tapped" once a consented customer is bound to it.
ALTER TABLE meta_tap_sessions ADD COLUMN link_id uuid,ADD COLUMN bound_at timestamptz,
 ADD FOREIGN KEY(merchant_id,link_id) REFERENCES meta_customer_links(merchant_id,id),
 ADD CHECK((link_id IS NULL)=(bound_at IS NULL)),
 ADD CHECK(bound_at IS NULL OR (bound_at>=created_at AND bound_at<=created_at+interval '15 minutes'));

ALTER TABLE meta_messenger_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_customer_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_messenger_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_consent_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_magic_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_customer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_messenger_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_page_tenant ON meta_messenger_pages USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_link_tenant ON meta_customer_links USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_ref_tenant ON meta_messenger_refs USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_consent_tenant ON meta_consent_requests USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_magic_tenant ON meta_magic_links USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_customer_session_tenant ON meta_customer_sessions USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_event_tenant ON meta_messenger_events USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));

GRANT SELECT ON meta_messenger_pages TO bitpos_app;
GRANT SELECT,INSERT ON meta_customer_links,meta_messenger_refs,meta_consent_requests,meta_magic_links,meta_customer_sessions,meta_messenger_events TO bitpos_app;
GRANT UPDATE(revoked_at) ON meta_customer_links,meta_customer_sessions TO bitpos_app;
GRANT UPDATE(consumed_at,consumed_psid) ON meta_messenger_refs TO bitpos_app;
GRANT UPDATE(decided_at,decision) ON meta_consent_requests TO bitpos_app;
GRANT UPDATE(consumed_at) ON meta_magic_links TO bitpos_app;
GRANT UPDATE(link_id,bound_at,claimed_at) ON meta_tap_sessions TO bitpos_app;

-- Unauthenticated entry points (webhook, magic link, cookie) only learn which tenant a random token or
-- page belongs to; every check and write then happens inside that tenant's RLS transaction.
CREATE FUNCTION bitpos.meta_page_merchant(p_page_id text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT merchant_id FROM meta_messenger_pages WHERE page_id=p_page_id AND retired_at IS NULL $$;
CREATE FUNCTION bitpos.meta_ref_merchant(p_ref_sha256 bytea) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT merchant_id FROM meta_messenger_refs WHERE ref_sha256=p_ref_sha256 $$;
CREATE FUNCTION bitpos.meta_magic_merchant(p_token_sha256 bytea) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT merchant_id FROM meta_magic_links WHERE token_sha256=p_token_sha256 $$;
CREATE FUNCTION bitpos.meta_session_merchant(p_token_sha256 bytea) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT merchant_id FROM meta_customer_sessions WHERE token_sha256=p_token_sha256 $$;
REVOKE ALL ON FUNCTION bitpos.meta_page_merchant(text),bitpos.meta_ref_merchant(bytea),bitpos.meta_magic_merchant(bytea),bitpos.meta_session_merchant(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_page_merchant(text),bitpos.meta_ref_merchant(bytea),bitpos.meta_magic_merchant(bytea),bitpos.meta_session_merchant(bytea) TO bitpos_app;
