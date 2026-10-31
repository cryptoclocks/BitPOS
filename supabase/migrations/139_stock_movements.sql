-- Append-only stock ledger for manual receive/adjust (legacy POS receive/adjust/movement).
-- The products row remains the live quantity; every manual change writes one immutable
-- movement in the same transaction. Rollback: stop the inventory routes; keep the ledger.
SET search_path TO bitpos,extensions,public;
CREATE TABLE stock_movements(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('RECEIVE','ADJUST')),
 delta integer NOT NULL CHECK(delta<>0 AND delta BETWEEN -100000 AND 100000),
 stock_before integer NOT NULL CHECK(stock_before>=0),
 stock_after integer NOT NULL CHECK(stock_after>=0 AND stock_after=stock_before+delta),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),
 reference text NOT NULL DEFAULT '' CHECK(length(reference)<=80),
 actor text NOT NULL,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,idempotency_key),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 CHECK(kind<>'RECEIVE' OR delta>0)
);
CREATE INDEX stock_movements_product ON stock_movements(merchant_id,product_id,created_at DESC,id DESC);
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON stock_movements FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON stock_movements TO bitpos_app;
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
