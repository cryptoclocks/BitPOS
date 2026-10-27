-- Additive correction before mobile admission. Keep token/session audit on rollback.
SET search_path TO bitpos,public;
ALTER TABLE mobile_sessions DROP CONSTRAINT mobile_sessions_check;
ALTER TABLE mobile_sessions ADD CONSTRAINT mobile_access_within_refresh CHECK(access_expires_at<=refresh_expires_at);
-- Immutable token→session mapping exists before a token can be presented.
-- NULL consumption marks the current token; old mappings remain for replay fences.
ALTER TABLE mobile_refresh_history ALTER COLUMN consumed_at DROP NOT NULL;
ALTER TABLE mobile_refresh_history ALTER COLUMN consumed_at DROP DEFAULT;
INSERT INTO mobile_refresh_history(token_hash,session_id,consumed_at)
 SELECT refresh_hash,id,NULL FROM mobile_sessions ON CONFLICT DO NOTHING;
GRANT UPDATE(consumed_at) ON mobile_refresh_history TO bitpos_app;
