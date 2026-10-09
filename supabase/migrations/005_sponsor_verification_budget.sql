SET search_path TO bitpos, public;
-- Existing funded sponsor has >99M lamports. Earlier attempts + fresh physical
-- verification series remain bounded to60M/day;1M/order and payer rate unchanged.
ALTER TABLE sponsor_days DROP CONSTRAINT sponsor_days_reserved_lamports_check;
ALTER TABLE sponsor_days ADD CONSTRAINT sponsor_days_reserved_lamports_check CHECK(reserved_lamports BETWEEN 0 AND 60000000);
