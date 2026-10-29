-- Staff review of passenger incidents. Platform support/administrator grants list unreviewed
-- incidents and record one append-only review per incident. A review is a note, never a refund,
-- fare change or penalty: any money consequence needs its own admitted workflow.
SET search_path TO bitpos,extensions,public;
CREATE TABLE passenger_trip_incident_reviews(
 incident_id uuid PRIMARY KEY REFERENCES passenger_trip_incidents,reviewer_account_id uuid NOT NULL REFERENCES mobile_accounts,
 outcome text NOT NULL CHECK(outcome IN('NO_ACTION','FOLLOW_UP','ESCALATED')),note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 500),
 reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER passenger_incident_reviews_immutable BEFORE UPDATE OR DELETE ON passenger_trip_incident_reviews FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
REVOKE ALL ON passenger_trip_incident_reviews FROM PUBLIC,bitpos_app;
CREATE FUNCTION ride_incident_staff() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid:=nullif(current_setting('bitpos.mobile_account',true),'')::uuid;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM platform_staff_role_grants WHERE account_id=actor AND role IN('support','administrator') AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'ROLE_REQUIRED'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION ride_incident_queue(max_rows int) RETURNS TABLE(id uuid,trip_id uuid,kind text,body text,reporter_role text,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 PERFORM ride_incident_staff();
 RETURN QUERY SELECT i.id,i.trip_id,i.kind,i.body,CASE WHEN i.reporter_account_id=t.rider_account_id THEN 'RIDER' ELSE 'DRIVER' END,i.created_at
  FROM passenger_trip_incidents i JOIN passenger_trips t ON t.id=i.trip_id
  WHERE NOT EXISTS(SELECT 1 FROM passenger_trip_incident_reviews r WHERE r.incident_id=i.id) ORDER BY i.created_at,i.id LIMIT least(greatest(max_rows,1),100);
END $$;
CREATE FUNCTION ride_incident_review(incident uuid,result text,review_note text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid:=ride_incident_staff();at timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM passenger_trip_incidents WHERE id=incident) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND'; END IF;
 INSERT INTO passenger_trip_incident_reviews(incident_id,reviewer_account_id,outcome,note) VALUES(incident,actor,result,review_note) ON CONFLICT DO NOTHING RETURNING reviewed_at INTO at;
 IF at IS NULL THEN RAISE EXCEPTION 'ALREADY_REVIEWED'; END IF;
 RETURN at;
END $$;
REVOKE ALL ON FUNCTION ride_incident_staff(),ride_incident_queue(int),ride_incident_review(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ride_incident_queue(int),ride_incident_review(uuid,text,text) TO bitpos_app;
