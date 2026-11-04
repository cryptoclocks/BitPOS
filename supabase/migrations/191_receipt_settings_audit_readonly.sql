-- M09: (1) receipt appearance stored on the server so every till prints the same shop name / footer / paper size, (2) the audit log becomes
-- insert-only for the application role (a viewer that says "read-only" must not sit on a table the API could rewrite), (3) indexes for the
-- audit viewer's actor/action filters. Receipt settings change only how a receipt LOOKS; amounts, lines and tax wording still come from the order
-- or cash sale. Rollback = stop reading the table; keep it.
SET search_path=bitpos,public;

CREATE TABLE receipt_settings(
 merchant_id uuid PRIMARY KEY REFERENCES merchants(id),
 shop_name text NOT NULL DEFAULT '' CHECK(char_length(shop_name)<=80),
 shop_name_en text NOT NULL DEFAULT '' CHECK(char_length(shop_name_en)<=80),
 footer text NOT NULL DEFAULT '' CHECK(char_length(footer)<=160),
 footer_en text NOT NULL DEFAULT '' CHECK(char_length(footer_en)<=160),
 default_lang text NOT NULL DEFAULT 'th' CHECK(default_lang IN('th','en','both')),
 paper_mm smallint NOT NULL DEFAULT 80 CHECK(paper_mm IN(58,80)),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE receipt_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON receipt_settings FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE ON receipt_settings TO bitpos_app;

-- The application role may only add audit rows (and read its own shop's through RLS); it can no longer edit or delete history.
REVOKE UPDATE,DELETE,TRUNCATE ON audit_logs FROM bitpos_app;

CREATE INDEX audit_logs_by_actor ON audit_logs(merchant_id,actor,created_at DESC,id DESC);
CREATE INDEX audit_logs_by_action ON audit_logs(merchant_id,action text_pattern_ops,created_at DESC,id DESC);
