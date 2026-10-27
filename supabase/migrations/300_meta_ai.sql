-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- 300-399 is reserved for Meta hackathon migrations. No inherited table is altered:
-- promotions, offers, orders and fulfillment stay authoritative; these tables only
-- record what Meta models observed/proposed and which inherited command acted on it.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_agent_policies(
 merchant_id uuid NOT NULL REFERENCES merchants,
 version int NOT NULL CHECK(version>0),
 mode text NOT NULL CHECK(mode IN ('supervised','leashed')),
 max_discount_percent int NOT NULL CHECK(max_discount_percent BETWEEN 1 AND 50),
 auto_approve_max_percent int NOT NULL CHECK(auto_approve_max_percent BETWEEN 0 AND max_discount_percent),
 min_confidence_bp int NOT NULL CHECK(min_confidence_bp BETWEEN 5000 AND 10000),
 min_surplus_units int NOT NULL CHECK(min_surplus_units BETWEEN 1 AND 500),
 window_minutes int NOT NULL CHECK(window_minutes BETWEEN 15 AND 240),
 daily_auto_limit int NOT NULL CHECK(daily_auto_limit BETWEEN 0 AND 20),
 approved_by uuid NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 retired_at timestamptz,
 PRIMARY KEY(merchant_id,version),
 CHECK(mode='leashed' OR auto_approve_max_percent=0)
);
CREATE UNIQUE INDEX meta_agent_policy_current ON meta_agent_policies(merchant_id) WHERE retired_at IS NULL;

CREATE TABLE meta_vision_observations(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('counter_scan','tray_check')),
 camera_id text NOT NULL CHECK(camera_id ~ '^[a-z0-9-]{1,40}$'),
 frame_sha256 text NOT NULL CHECK(frame_sha256 ~ '^[a-f0-9]{64}$'),
 order_id uuid,
 -- [{"label":"croissant","productId":uuid|null,"count":7,"confidenceBp":9100}] computed from masks in code.
 counts jsonb NOT NULL CHECK(jsonb_typeof(counts)='array' AND pg_column_size(counts)<=16384),
 verdict text CHECK(verdict IN ('MATCH_CONFIRMED','MISMATCH','UNCERTAIN')),
 staff_override_by uuid,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 -- Raw frames are never stored here; evidence crops live in private storage until this time.
 evidence_expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '14 days',
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,kind,camera_id,frame_sha256),
 CHECK((kind='tray_check')=(order_id IS NOT NULL)),
 CHECK((kind='tray_check')=(verdict IS NOT NULL)),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id)
);
CREATE INDEX meta_vision_recent ON meta_vision_observations(merchant_id,kind,observed_at DESC);

CREATE TABLE meta_agent_runs(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 observation_id uuid NOT NULL,
 product_id uuid NOT NULL,
 policy_version int NOT NULL,
 state text NOT NULL CHECK(state IN ('PLANNED','AWAITING_APPROVAL','AUTO_APPROVED','PROMOTION_REQUESTED','PUBLISHED','RENDERED','REJECTED','STALE','FAILED')),
 discount_percent int CHECK(discount_percent BETWEEN 1 AND 50),
 approval_kind text CHECK(approval_kind IN ('merchant','policy')),
 approved_by uuid,
 promotion_job_id uuid,
 campaign_id uuid,
 failure text CHECK(failure ~ '^[A-Z_]{2,60}$'),
 version int NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,observation_id) REFERENCES meta_vision_observations(merchant_id,id),
 FOREIGN KEY(merchant_id,policy_version) REFERENCES meta_agent_policies(merchant_id,version),
 CHECK(state NOT IN ('AUTO_APPROVED','PROMOTION_REQUESTED','PUBLISHED','RENDERED') OR (approval_kind IS NOT NULL AND approved_by IS NOT NULL AND discount_percent IS NOT NULL)),
 CHECK(state<>'FAILED' OR failure IS NOT NULL)
);
-- Never stack two live flash-sale runs on one product (duplicate scans, worker restarts).
CREATE UNIQUE INDEX meta_agent_run_open ON meta_agent_runs(merchant_id,product_id) WHERE state IN ('PLANNED','AWAITING_APPROVAL','AUTO_APPROVED','PROMOTION_REQUESTED','PUBLISHED');

CREATE TABLE meta_ai_invocations(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL,
 run_id uuid,
 task text NOT NULL CHECK(task ~ '^[a-z_]{1,40}$'),
 provider text NOT NULL CHECK(provider IN ('meta_api','baseten','modal','local_mac','local_v100')),
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
 weights text NOT NULL CHECK(weights IN ('closed','open')),
 location text NOT NULL CHECK(location IN ('cloud','self_hosted')),
 outcome text NOT NULL CHECK(outcome ~ '^[A-Z_]{2,40}$'),
 latency_ms int NOT NULL CHECK(latency_ms>=0),
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 output_sha256 text CHECK(output_sha256 ~ '^[a-f0-9]{64}$'),
 output jsonb CHECK(output IS NULL OR pg_column_size(output)<=65536),
 prompt_tokens int CHECK(prompt_tokens>=0),
 completion_tokens int CHECK(completion_tokens>=0),
 reasoning_tokens int CHECK(reasoning_tokens>=0),
 started_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 CHECK((outcome='OK')=(output_sha256 IS NOT NULL)),
 FOREIGN KEY(merchant_id,run_id) REFERENCES meta_agent_runs(merchant_id,id)
);
CREATE INDEX meta_ai_invocation_recent ON meta_ai_invocations(merchant_id,started_at DESC);

ALTER TABLE meta_agent_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_vision_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_ai_invocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_policy_tenant ON meta_agent_policies USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_observation_tenant ON meta_vision_observations USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_run_tenant ON meta_agent_runs USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_invocation_tenant ON meta_ai_invocations USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
-- Evidence is append-only for the app role; policies retire instead of being edited.
GRANT SELECT,INSERT ON meta_ai_invocations,meta_vision_observations,meta_agent_policies TO bitpos_app;
GRANT UPDATE(retired_at) ON meta_agent_policies TO bitpos_app;
GRANT UPDATE(verdict,staff_override_by) ON meta_vision_observations TO bitpos_app;
GRANT SELECT,INSERT,UPDATE ON meta_agent_runs TO bitpos_app;
