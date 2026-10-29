-- Private candidate115. Finalized observed fee costs; unused allocation remains
-- held until explicit reconciliation. No SOL/token conversion or automatic release.
SET search_path=bitpos,public;
CREATE TABLE food_refund115_costs(
 attempt_id uuid PRIMARY KEY REFERENCES food_refund113_claims,
 receipt_id uuid NOT NULL UNIQUE REFERENCES food_refund112_receipts,
 reserved_lamports bigint NOT NULL CHECK(reserved_lamports>0),
 fee_lamports bigint NOT NULL CHECK(fee_lamports>=0),
 rent_lamports bigint NOT NULL CHECK(rent_lamports>=0),
 held_remainder_lamports bigint NOT NULL CHECK(held_remainder_lamports>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(fee_lamports+rent_lamports+held_remainder_lamports=reserved_lamports)
);
ALTER TABLE food_refund115_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON food_refund115_costs FROM PUBLIC,bitpos_app,bitpos_refund_worker;
CREATE TRIGGER immutable_refund115_cost BEFORE UPDATE OR DELETE ON food_refund115_costs FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION food_refund115_cost(receipt uuid)RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE r food_refund112_receipts;a food_refund110_attempts;b food_refund110_bindings;claim food_refund113_claims;fee numeric;rent numeric;
BEGIN
 SELECT * INTO STRICT r FROM food_refund112_receipts WHERE id=receipt;
 -- A contradictory late success has no refund ledger posting; retain all funds
 -- for manual reconciliation rather than infer consumed/released capacity.
 IF r.outcome<>'FINALIZED'OR r.posting_id IS NULL THEN RETURN;END IF;
 SELECT * INTO STRICT a FROM food_refund110_attempts WHERE id=r.attempt_id;
 SELECT * INTO STRICT b FROM food_refund110_bindings WHERE id=a.binding_id;
 SELECT * INTO claim FROM food_refund113_claims WHERE attempt_id=a.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_FEE_RESERVATION_REQUIRED';END IF;
 IF coalesce(r.evidence->>'feeLamports','')!~'^(0|[1-9][0-9]{0,6})$'OR coalesce(a.prepared->>'rentLamports','')!~'^(0|[1-9][0-9]{0,7})$'
 THEN RAISE EXCEPTION 'REFUND_FEE_EVIDENCE_CONFLICT';END IF;
 fee:=(r.evidence->>'feeLamports')::numeric;rent:=(a.prepared->>'rentLamports')::numeric;
 IF fee>b.max_fee_lamports OR fee+rent>claim.amount_lamports OR claim.amount_lamports<>b.max_total_lamports
 OR(rent>0 AND a.prepared->>'createRecipientAccount' IS DISTINCT FROM 'true')
 THEN RAISE EXCEPTION 'REFUND_FEE_EVIDENCE_CONFLICT';END IF;
 INSERT INTO food_refund115_costs(attempt_id,receipt_id,reserved_lamports,fee_lamports,rent_lamports,held_remainder_lamports)
 VALUES(a.id,r.id,claim.amount_lamports,fee::bigint,rent::bigint,claim.amount_lamports-fee::bigint-rent::bigint);
END$$;
CREATE FUNCTION food_refund115_cost_event()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN PERFORM food_refund115_cost(NEW.id);RETURN NEW;END$$;
CREATE TRIGGER refund115_receipt_cost AFTER INSERT ON food_refund112_receipts FOR EACH ROW EXECUTE FUNCTION food_refund115_cost_event();
DO $$DECLARE row record;BEGIN FOR row IN SELECT id FROM food_refund112_receipts WHERE outcome='FINALIZED'AND posting_id IS NOT NULL ORDER BY id LOOP PERFORM food_refund115_cost(row.id);END LOOP;END$$;
REVOKE ALL ON FUNCTION food_refund115_cost(uuid),food_refund115_cost_event()FROM PUBLIC,bitpos_app,bitpos_refund_worker;
