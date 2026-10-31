-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
-- Café Copilot trace: what the owner asked, which model ran, every tool call and its validated result. Kept so the
-- merchant (and judges) can see exactly how a draft was produced. No customer data and no prompt bodies are stored.
SET search_path TO bitpos,extensions,public;

CREATE TABLE paypal_agent_runs(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 200),
 intent text NOT NULL CHECK(char_length(intent) BETWEEN 3 AND 600),
 language text NOT NULL CHECK(language IN ('th','en')),
 kind text NOT NULL CHECK(kind IN ('model','rules_baseline')),
 provider text CHECK(length(provider)<=200),
 model text CHECK(length(model)<=120),
 state text NOT NULL DEFAULT 'RUNNING' CHECK(state IN ('RUNNING','DRAFTED','NEEDS_INPUT','FAILED')),
 failure text CHECK(length(failure)<=120),
 question text CHECK(char_length(question)<=400),
 steps integer NOT NULL DEFAULT 0 CHECK(steps BETWEEN 0 AND 12),
 envelope_id uuid,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,envelope_id) REFERENCES paypal_campaign_envelopes(merchant_id,id)
);
CREATE INDEX paypal_agent_runs_recent ON paypal_agent_runs(merchant_id,started_at DESC);
ALTER TABLE paypal_campaign_envelopes ADD FOREIGN KEY(merchant_id,agent_run_id) REFERENCES paypal_agent_runs(merchant_id,id);

CREATE TABLE paypal_agent_steps(
 merchant_id uuid NOT NULL,
 run_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 24),
 kind text NOT NULL CHECK(kind IN ('model_call','tool_call','final')),
 tool text CHECK(tool IS NULL OR tool ~ '^[a-z_]{3,40}$'),
 args jsonb,
 result jsonb,
 violations text[],
 provider_request_id text CHECK(length(provider_request_id)<=200),
 latency_ms integer CHECK(latency_ms>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,run_id,seq),
 FOREIGN KEY(merchant_id,run_id) REFERENCES paypal_agent_runs(merchant_id,id)
);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['paypal_agent_runs','paypal_agent_steps'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON paypal_agent_runs TO bitpos_app;
GRANT SELECT,INSERT ON paypal_agent_steps TO bitpos_app;
