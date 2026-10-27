-- Native SDK 2.28 exact devnet USDC evidence; historical financial rows unchanged.
SET search_path=bitpos,public;
CREATE TABLE x402_attempt_bindings(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,attempt_id uuid NOT NULL,quote_id uuid NOT NULL,binding jsonb NOT NULL,
 PRIMARY KEY(merchant_id,attempt_id),UNIQUE(attempt_id),
 FOREIGN KEY(attempt_id) REFERENCES payment_attempts(id),
 FOREIGN KEY(merchant_id,order_id,quote_id) REFERENCES payment_quotes(merchant_id,order_id,id),
 CHECK(binding->>'kind'='x402'),CHECK(binding->>'merchantId'=merchant_id::text),
 CHECK(binding->>'orderId'=order_id::text),CHECK(binding->>'attemptId'=attempt_id::text),CHECK(binding->>'quoteId'=quote_id::text),
 CHECK(binding ?& ARRAY['kind','merchantId','orderId','attemptId','quoteId','owner','transferAuthority','resource','memo','feePayer','blockhash','lastValidHeight','requirements']),
 CHECK((binding ? 'grantId')=(binding ? 'holdId')),
 CHECK(binding->>'transferAuthority'=binding->>'owner' OR binding ?& ARRAY['grantId','holdId']),
 CHECK(binding->'requirements'->>'network'='solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
 CHECK(binding->'requirements'->>'scheme'='exact'),CHECK(binding->'requirements'->>'asset'='4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
 CHECK(octet_length(binding->>'memo') BETWEEN 1 AND 256)
);
CREATE FUNCTION check_x402_binding() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE a payment_attempts%ROWTYPE;s payment_attempt_assets%ROWTYPE;BEGIN
 SELECT * INTO a FROM payment_attempts WHERE merchant_id=NEW.merchant_id AND order_id=NEW.order_id AND id=NEW.attempt_id FOR UPDATE;
 SELECT * INTO s FROM payment_attempt_assets WHERE merchant_id=NEW.merchant_id AND order_id=NEW.order_id AND attempt_id=NEW.attempt_id;
 IF a.id IS NULL OR s.attempt_id IS NULL OR s.quote_id<>NEW.quote_id OR NEW.binding->>'owner' IS DISTINCT FROM a.payer OR NEW.binding->'requirements'->>'amount' IS DISTINCT FROM a.amount_minor::text OR NEW.binding->'requirements'->>'payTo' IS DISTINCT FROM a.recipient OR NEW.binding->>'feePayer' IS DISTINCT FROM NEW.binding->'requirements'->'extra'->>'feePayer' OR NEW.binding->>'memo' IS DISTINCT FROM NEW.binding->'requirements'->'extra'->>'memo' OR NEW.binding->>'blockhash' IS DISTINCT FROM NEW.binding->'requirements'->'extra'->>'recentBlockhash' OR NEW.binding->>'lastValidHeight' IS DISTINCT FROM NEW.binding->'requirements'->'extra'->>'lastValidBlockHeight' THEN RAISE EXCEPTION 'X402_BINDING_MISMATCH' USING ERRCODE='23514';END IF;
 RETURN NEW;END $$;
CREATE TRIGGER validate_x402_binding BEFORE INSERT ON x402_attempt_bindings FOR EACH ROW EXECUTE FUNCTION check_x402_binding();
CREATE TRIGGER immutable_x402_binding BEFORE UPDATE OR DELETE ON x402_attempt_bindings FOR EACH ROW EXECUTE FUNCTION immutable_payment_sidecar();
CREATE TABLE x402_pending_settlements(
 merchant_id uuid NOT NULL,attempt_id uuid NOT NULL,message_hash text NOT NULL,signature text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,attempt_id,message_hash),UNIQUE(signature),
 FOREIGN KEY(merchant_id,attempt_id) REFERENCES x402_attempt_bindings(merchant_id,attempt_id)
);
CREATE FUNCTION check_x402_pending() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_attempts WHERE merchant_id=NEW.merchant_id AND id=NEW.attempt_id AND signature=NEW.signature AND signed_base64 IS NOT NULL) THEN RAISE EXCEPTION 'X402_UNJOURNALED_SETTLEMENT' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER validate_x402_pending BEFORE INSERT ON x402_pending_settlements FOR EACH ROW EXECUTE FUNCTION check_x402_pending();
CREATE TRIGGER immutable_x402_pending BEFORE UPDATE ON x402_pending_settlements FOR EACH ROW EXECUTE FUNCTION immutable_payment_sidecar();
ALTER TABLE x402_attempt_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE x402_pending_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON x402_attempt_bindings TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY tenant_access ON x402_pending_settlements TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON x402_attempt_bindings TO bitpos_app;
GRANT SELECT,INSERT,DELETE ON x402_pending_settlements TO bitpos_app;
