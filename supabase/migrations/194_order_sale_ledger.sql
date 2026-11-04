-- Stock-ledger rows for counter/table/online ORDER sales. Until now a paid order took stock inside bitpos.settle_verified_attempt (stock=stock-qty,
-- reserved=reserved-qty, then the order becomes PAID) without a stock_movements row, so the ledger and products.stock could not be reconciled for these sales.
-- The routine is patched IN PLACE from its stored source: exactly one statement is added right after its product UPDATE, in the same transaction and under the
-- same product row locks, and only when the sale really takes stock (not v_late; a late settlement becomes RECOVERY and takes none). stock_after is read back from
-- the product row just updated, stock_before = stock_after + qty. One row per (order, product), idempotent through the ledger's unique key. A trigger on orders
-- was tried first and rejected: it makes marking an order PAID read the products table, which the device test suite forbids (payment must not wait on catalog
-- locks). Orders paid BEFORE this migration have no sale rows (history is not back-filled). The migration aborts if the expected statement is not found.
-- Rollback: re-apply the previous routine body (migration 055) and keep the ledger rows.
SET search_path=bitpos,public;

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_kind_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind_check CHECK(kind IN('RECEIVE','ADJUST','CHANNEL_SALE','CASH_SALE','CASH_VOID_RETURN','ORDER_SALE'));
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_order_sale_direction CHECK(kind<>'ORDER_SALE' OR delta<0);

DO $patch$
DECLARE
 v_oid oid:='bitpos.settle_verified_attempt(uuid,uuid,uuid,boolean)'::regprocedure;
 v_def text:=pg_get_functiondef(v_oid);
 v_old text:='   WHERE p.merchant_id=p_merchant AND i.merchant_id=p_merchant
     AND i.order_id=p_order AND p.id=i.product_id;
  END IF;
  UPDATE bitpos.payment_attempts a SET status=''FINALIZED''';
 v_new text:='   WHERE p.merchant_id=p_merchant AND i.merchant_id=p_merchant
     AND i.order_id=p_order AND p.id=i.product_id;
   IF NOT v_late THEN
    INSERT INTO bitpos.stock_movements(merchant_id,product_id,kind,delta,stock_before,stock_after,reason,reference,actor,idempotency_key,request_hash)
    SELECT p_merchant,i.product_id,''ORDER_SALE'',-i.qty,p.stock+i.qty,p.stock,''order sale'',''order:''||p_order::text,''system:settlement'',
           ''order:''||p_order::text||'':''||i.product_id::text||'':sale'',md5(p_order::text||'':''||i.product_id::text||'':''||i.qty::text)
    FROM bitpos.order_items i JOIN bitpos.products p ON p.merchant_id=i.merchant_id AND p.id=i.product_id
    WHERE i.merchant_id=p_merchant AND i.order_id=p_order
    ON CONFLICT(merchant_id,idempotency_key) DO NOTHING;
   END IF;
  END IF;
  UPDATE bitpos.payment_attempts a SET status=''FINALIZED''';
BEGIN
 IF position(v_old IN v_def)=0 THEN RAISE EXCEPTION 'settle_verified_attempt does not contain the expected product update; ledger patch not applied'; END IF;
 IF position('ORDER_SALE' IN v_def)>0 THEN RETURN; END IF;
 EXECUTE replace(v_def,v_old,v_new);
END
$patch$;
