-- Local candidate only. Retain historical missing estimates; never infer a ready promise.
SET search_path=bitpos,public;
ALTER TABLE online_food_orders
 ADD COLUMN preparation_minutes integer,
 ADD COLUMN preparation_recorded_at timestamptz,
 ADD CONSTRAINT online_preparation_estimate_shape CHECK(
  (preparation_minutes IS NULL AND preparation_recorded_at IS NULL)
  OR (acceptance_status='ACCEPTED' AND preparation_minutes IS NOT NULL AND preparation_minutes BETWEEN 1 AND 1440 AND preparation_recorded_at IS NOT NULL)
 );

CREATE FUNCTION guard_online_preparation_estimate() RETURNS trigger
LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.preparation_minutes IS NOT NULL OR NEW.preparation_recorded_at IS NOT NULL THEN
   RAISE EXCEPTION 'preparation estimate requires merchant acceptance' USING ERRCODE='23514';
  END IF;
 ELSIF OLD.acceptance_status='PENDING' AND NEW.acceptance_status='ACCEPTED' THEN
  IF NEW.preparation_minutes IS NULL OR NEW.preparation_minutes NOT BETWEEN 1 AND 1440 THEN
   RAISE EXCEPTION 'preparation estimate required' USING ERRCODE='23514';
  END IF;
  -- The command supplies duration only; the database owns the recorded instant.
  NEW.preparation_recorded_at:=clock_timestamp();
 ELSIF (NEW.preparation_minutes,NEW.preparation_recorded_at)
 IS DISTINCT FROM (OLD.preparation_minutes,OLD.preparation_recorded_at) THEN
  RAISE EXCEPTION 'immutable acceptance preparation estimate' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_online_preparation_estimate BEFORE INSERT OR UPDATE ON online_food_orders
 FOR EACH ROW EXECUTE FUNCTION guard_online_preparation_estimate();
