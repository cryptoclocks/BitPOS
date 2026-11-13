-- NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
-- Café CFO: an AI suggestion for the split recipe, kept reviewable. The model only picks one of the options the
-- server built and writes a short reason; a person (owner or manager) approves before anything changes.
-- `proof` records what was checked about the answer (request/response hashes, signer, signature result).
SET search_path TO bitpos,extensions,public;
CREATE TABLE near_cfo_runs(
 merchant_id uuid NOT NULL REFERENCES near_merchant_settings(merchant_id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 status text NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','APPROVED','DISMISSED')),
 mode text NOT NULL CHECK(mode IN ('near_ai','sample')),
 model text CHECK(length(model)<=120),
 option_id text NOT NULL CHECK(option_id ~ '^[a-z_]{2,24}$'),
 tax_bps integer NOT NULL CHECK(tax_bps BETWEEN 0 AND 3000),
 tips_bps integer NOT NULL CHECK(tips_bps BETWEEN 0 AND 3000),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 400),
 options jsonb NOT NULL,
 facts jsonb NOT NULL,
 proof jsonb NOT NULL,
 created_by text NOT NULL CHECK(length(created_by) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 decided_by text CHECK(length(decided_by) BETWEEN 1 AND 200),
 decided_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 CHECK((status='PROPOSED')=(decided_at IS NULL))
);
CREATE INDEX near_cfo_runs_recent ON near_cfo_runs(merchant_id,created_at DESC);
ALTER TABLE near_cfo_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON near_cfo_runs FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON near_cfo_runs TO bitpos_app;
GRANT UPDATE(status,decided_by,decided_at) ON near_cfo_runs TO bitpos_app;
