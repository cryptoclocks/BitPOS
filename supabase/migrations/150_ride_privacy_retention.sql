-- Local candidate: erase free text after 30 days, keep immutable incident/review facts.
SET search_path TO bitpos,extensions,public;
ALTER TABLE passenger_trip_incidents ADD COLUMN text_redacted_at timestamptz;
ALTER TABLE passenger_trip_incident_reviews ADD COLUMN text_redacted_at timestamptz;
CREATE FUNCTION ride_incident_text_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE field text:=CASE WHEN TG_TABLE_NAME='passenger_trip_incidents' THEN 'body' ELSE 'note' END;
 time_field text:=CASE WHEN TG_TABLE_NAME='passenger_trip_incidents' THEN 'created_at' ELSE 'reviewed_at' END;
BEGIN
 IF TG_OP='UPDATE' AND current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
  AND OLD.text_redacted_at IS NULL AND NEW.text_redacted_at IS NOT NULL
  AND (to_jsonb(OLD)->>time_field)::timestamptz<=clock_timestamp()-interval '30 days'
  AND to_jsonb(NEW)->>field='[expired]'
  AND (to_jsonb(NEW)-field-'text_redacted_at')=(to_jsonb(OLD)-field-'text_redacted_at') THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'IMMUTABLE_AUTHORITY_ROW';
END $$;
DROP TRIGGER passenger_trip_incidents_immutable ON passenger_trip_incidents;
DROP TRIGGER passenger_incident_reviews_immutable ON passenger_trip_incident_reviews;
CREATE TRIGGER passenger_trip_incidents_immutable BEFORE UPDATE OR DELETE ON passenger_trip_incidents FOR EACH ROW EXECUTE FUNCTION ride_incident_text_guard();
CREATE TRIGGER passenger_incident_reviews_immutable BEFORE UPDATE OR DELETE ON passenger_trip_incident_reviews FOR EACH ROW EXECUTE FUNCTION ride_incident_text_guard();
CREATE FUNCTION ride_privacy_purge() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE n bigint;m bigint;
BEGIN
 n:=ride_location_purge();
 UPDATE passenger_trip_incidents SET body='[expired]',text_redacted_at=clock_timestamp() WHERE text_redacted_at IS NULL AND created_at<=clock_timestamp()-interval '30 days';
 GET DIAGNOSTICS m=ROW_COUNT;n:=n+m;
 UPDATE passenger_trip_incident_reviews SET note='[expired]',text_redacted_at=clock_timestamp() WHERE text_redacted_at IS NULL AND reviewed_at<=clock_timestamp()-interval '30 days';
 GET DIAGNOSTICS m=ROW_COUNT;RETURN n+m;
END $$;
-- It can erase only already-expired text/location, with no caller-provided cutoff or identifiers.
REVOKE ALL ON FUNCTION ride_incident_text_guard(),ride_privacy_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ride_privacy_purge() TO bitpos_app;
CREATE OR REPLACE FUNCTION ride_incident_queue(max_rows int) RETURNS TABLE(id uuid,trip_id uuid,kind text,body text,reporter_role text,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 PERFORM ride_incident_staff();
 RETURN QUERY SELECT i.id,i.trip_id,i.kind,
 CASE WHEN i.created_at<=clock_timestamp()-interval '30 days' THEN '[expired]' ELSE i.body END,
 CASE WHEN i.reporter_account_id=t.rider_account_id THEN 'RIDER' ELSE 'DRIVER' END,i.created_at
 FROM passenger_trip_incidents i JOIN passenger_trips t ON t.id=i.trip_id
 WHERE NOT EXISTS(SELECT 1 FROM passenger_trip_incident_reviews r WHERE r.incident_id=i.id) ORDER BY i.created_at,i.id LIMIT least(greatest(max_rows,1),100);
END $$;
