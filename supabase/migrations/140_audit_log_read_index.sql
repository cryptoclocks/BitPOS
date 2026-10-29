-- Read path for the merchant activity history (newest first, keyset). Rollback: drop the index.
SET search_path TO bitpos,extensions,public;
CREATE INDEX IF NOT EXISTS audit_logs_recent ON audit_logs(merchant_id,created_at DESC,id DESC);
