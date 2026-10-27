-- Apply after 035--038 with new personal quote writers in one transaction.
-- Before COMMIT: ROLLBACK. Afterwards disable new personal issuance and roll forward;
-- retain proof/recipient/quote/bill history and never restore or reprice financial rows.
SET search_path TO bitpos,extensions,public;
CREATE TABLE table_occupancy_recipients(
 merchant_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),occupancy_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,id),UNIQUE(merchant_id,id,occupancy_id),
 FOREIGN KEY(merchant_id,occupancy_id) REFERENCES table_occupancies(merchant_id,id)
);
CREATE TABLE table_visit_recipient_proofs(
 merchant_id uuid NOT NULL,visit_id uuid NOT NULL,source_visit_hash text,customer_auth_session_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,visit_id),
 FOREIGN KEY(merchant_id,visit_id) REFERENCES table_visits(merchant_id,id),
 FOREIGN KEY(merchant_id,customer_auth_session_id) REFERENCES customer_auth_sessions(merchant_id,id),
 CHECK(source_visit_hash IS NULL OR source_visit_hash ~ '^[0-9a-f]{64}$'),CHECK(source_visit_hash IS NOT NULL OR customer_auth_session_id IS NOT NULL)
);
CREATE TABLE table_visit_recipients(
 merchant_id uuid NOT NULL,visit_id uuid NOT NULL,recipient_id uuid NOT NULL,occupancy_id uuid NOT NULL,
 PRIMARY KEY(merchant_id,visit_id),UNIQUE(merchant_id,visit_id,recipient_id,occupancy_id),
 FOREIGN KEY(merchant_id,recipient_id,occupancy_id) REFERENCES table_occupancy_recipients(merchant_id,id,occupancy_id),
 FOREIGN KEY(merchant_id,visit_id) REFERENCES table_occupancy_visits(merchant_id,visit_id)
);
CREATE TABLE table_recipient_profiles(
 merchant_id uuid NOT NULL,recipient_id uuid NOT NULL,customer_id uuid NOT NULL,
 basis text NOT NULL CHECK(basis IN ('staff_recognition','verified_wallet_consent')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,recipient_id),UNIQUE(merchant_id,recipient_id,customer_id),
 FOREIGN KEY(merchant_id,recipient_id) REFERENCES table_occupancy_recipients(merchant_id,id),
 FOREIGN KEY(merchant_id,customer_id) REFERENCES customers(merchant_id,id)
);
CREATE TABLE table_recipient_auth_sessions(
 merchant_id uuid NOT NULL,recipient_id uuid NOT NULL,customer_auth_session_id uuid NOT NULL,
 PRIMARY KEY(merchant_id,recipient_id,customer_auth_session_id),
 FOREIGN KEY(merchant_id,recipient_id) REFERENCES table_occupancy_recipients(merchant_id,id),
 FOREIGN KEY(merchant_id,customer_auth_session_id) REFERENCES customer_auth_sessions(merchant_id,id)
);
CREATE TABLE order_customer_profiles(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,customer_id uuid NOT NULL,customer_auth_session_id uuid NOT NULL,
 recipient_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_id,order_id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id),
 FOREIGN KEY(merchant_id,customer_id) REFERENCES customers(merchant_id,id),
 FOREIGN KEY(merchant_id,customer_auth_session_id) REFERENCES customer_auth_sessions(merchant_id,id),
 FOREIGN KEY(merchant_id,recipient_id,customer_id) REFERENCES table_recipient_profiles(merchant_id,recipient_id,customer_id)
);
CREATE TABLE personal_promotion_job_bindings(
 merchant_id uuid NOT NULL,job_id uuid NOT NULL,table_id uuid NOT NULL,occupancy_id uuid NOT NULL,occupancy_generation bigint NOT NULL,
 recipient_id uuid NOT NULL,recipient_visit_id uuid NOT NULL,target_device_id uuid NOT NULL,assignment_generation bigint NOT NULL,auth_generation bigint NOT NULL,
 customer_id uuid,customer_auth_session_id uuid,source_order_id uuid,
 origin_basis text NOT NULL CHECK(origin_basis IN ('staff_recognition','verified_wallet_consent','private_paid_visit')),
 excluded_product_ids uuid[] NOT NULL DEFAULT '{}',PRIMARY KEY(merchant_id,job_id),
 FOREIGN KEY(merchant_id,job_id) REFERENCES ai_generation_jobs(merchant_id,id),
 FOREIGN KEY(merchant_id,occupancy_id,table_id,occupancy_generation) REFERENCES table_occupancies(merchant_id,id,table_id,generation),
 FOREIGN KEY(merchant_id,recipient_visit_id,recipient_id,occupancy_id) REFERENCES table_visit_recipients(merchant_id,visit_id,recipient_id,occupancy_id),
 FOREIGN KEY(merchant_id,target_device_id) REFERENCES devices(merchant_id,id),
 FOREIGN KEY(merchant_id,customer_id) REFERENCES customers(merchant_id,id),
 FOREIGN KEY(merchant_id,customer_auth_session_id) REFERENCES customer_auth_sessions(merchant_id,id),
 FOREIGN KEY(merchant_id,source_order_id) REFERENCES orders(merchant_id,id),
 CHECK(assignment_generation>0 AND auth_generation>0),CHECK(cardinality(excluded_product_ids)<=50),
 CHECK((origin_basis='verified_wallet_consent')=(customer_auth_session_id IS NOT NULL)),
 CHECK(origin_basis<>'staff_recognition' OR customer_id IS NOT NULL),CHECK(origin_basis='staff_recognition' OR source_order_id IS NOT NULL)
);
ALTER TABLE promotion_playlist_targets ADD FOREIGN KEY(merchant_id,recipient_id,occupancy_id) REFERENCES table_occupancy_recipients(merchant_id,id,occupancy_id);
CREATE TABLE personal_quote_promotions(
 merchant_id uuid NOT NULL,quote_id uuid NOT NULL,product_id uuid NOT NULL,target_id uuid NOT NULL,campaign_id uuid NOT NULL,campaign_version integer NOT NULL,
 recipient_id uuid NOT NULL,evidence jsonb NOT NULL,PRIMARY KEY(merchant_id,quote_id,product_id),
 FOREIGN KEY(merchant_id,quote_id) REFERENCES order_quotes(merchant_id,id),FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 FOREIGN KEY(merchant_id,target_id) REFERENCES promotion_playlist_targets(merchant_id,id),
 FOREIGN KEY(merchant_id,campaign_id,campaign_version) REFERENCES promotion_revisions(merchant_id,campaign_id,version),
 FOREIGN KEY(merchant_id,recipient_id) REFERENCES table_occupancy_recipients(merchant_id,id)
);
CREATE TABLE personal_order_promotions(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,product_id uuid NOT NULL,quote_id uuid NOT NULL,target_id uuid NOT NULL,
 campaign_id uuid NOT NULL,campaign_version integer NOT NULL,recipient_id uuid NOT NULL,evidence jsonb NOT NULL,
 PRIMARY KEY(merchant_id,order_id,product_id),UNIQUE(merchant_id,campaign_id,campaign_version,recipient_id),
 FOREIGN KEY(merchant_id,order_id,product_id) REFERENCES order_line_prices(merchant_id,order_id,product_id),
 FOREIGN KEY(merchant_id,quote_id,product_id) REFERENCES personal_quote_promotions(merchant_id,quote_id,product_id),
 FOREIGN KEY(merchant_id,target_id) REFERENCES promotion_playlist_targets(merchant_id,id),
 FOREIGN KEY(merchant_id,campaign_id,campaign_version) REFERENCES promotion_revisions(merchant_id,campaign_id,version),
 FOREIGN KEY(merchant_id,recipient_id) REFERENCES table_occupancy_recipients(merchant_id,id)
);
CREATE FUNCTION customer_personal_auth_current(p_merchant uuid,p_session uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM customer_auth_sessions s JOIN customer_wallets w ON w.merchant_id=s.merchant_id AND w.customer_id=s.customer_id AND w.address=s.wallet_address AND w.chain=s.chain
 WHERE s.merchant_id=p_merchant AND s.id=p_session AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.consent_profile AND s.consent_purchase_history AND s.consent_version='bitpos-personal-offers-v1')
$$;
CREATE FUNCTION personal_order_verified_paid(p_merchant uuid,p_order uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM orders o JOIN payments p ON p.merchant_id=o.merchant_id AND p.order_id=o.id
 JOIN payment_attempts a ON a.merchant_id=p.merchant_id AND a.id=p.attempt_id AND a.order_id=p.order_id
 WHERE o.merchant_id=p_merchant AND o.id=p_order AND o.status='PAID' AND p.state='SETTLED' AND a.status='FINALIZED')
$$;
CREATE INDEX table_visit_private_proof_hash ON table_visits(merchant_id,(encode(digest(access_token,'sha256'),'hex')));
CREATE FUNCTION personal_source_recipient(p_merchant uuid,p_visit uuid,p_hash text) RETURNS uuid LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,extensions,public,pg_temp AS $$
 SELECT r.recipient_id FROM table_visits source JOIN table_visit_recipients r ON r.merchant_id=source.merchant_id AND r.visit_id=source.id
 JOIN table_visit_epochs prior ON prior.merchant_id=source.merchant_id AND prior.visit_id=source.id
 JOIN table_visit_epochs next ON next.merchant_id=source.merchant_id AND next.visit_id=p_visit
 JOIN table_entries source_entry ON source_entry.merchant_id=source.merchant_id AND source_entry.id=source.entry_id
 JOIN table_visits visit ON visit.merchant_id=next.merchant_id AND visit.id=next.visit_id
 JOIN table_entries next_entry ON next_entry.merchant_id=visit.merchant_id AND next_entry.id=visit.entry_id
 JOIN table_occupancies o ON o.merchant_id=r.merchant_id AND o.id=r.occupancy_id
 JOIN merchant_tables t ON t.merchant_id=o.merchant_id AND t.id=o.table_id
 JOIN order_table_occupancies bill ON bill.merchant_id=source.merchant_id AND bill.order_id=source.order_id AND bill.occupancy_id=r.occupancy_id
 WHERE source.merchant_id=p_merchant AND encode(digest(source.access_token,'sha256'),'hex')=p_hash
 AND personal_order_verified_paid(source.merchant_id,source.order_id) AND o.closed_at IS NULL AND t.retired_at IS NULL
 AND o.generation=t.occupancy_generation AND prior.generation=o.generation AND next.generation=o.generation
 AND next.table_id=o.table_id AND prior.table_id=o.table_id AND source_entry.table_id=next_entry.table_id AND next_entry.table_id=o.table_id
$$;
CREATE FUNCTION guard_visit_recipient_proof() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM table_visit_recipients WHERE merchant_id=NEW.merchant_id AND visit_id=NEW.visit_id)
 OR NOT EXISTS(SELECT 1 FROM table_visit_epochs e JOIN merchant_tables t ON t.merchant_id=e.merchant_id AND t.id=e.table_id WHERE e.merchant_id=NEW.merchant_id AND e.visit_id=NEW.visit_id AND e.generation=t.occupancy_generation AND t.retired_at IS NULL)
 OR NEW.source_visit_hash IS NOT NULL AND personal_source_recipient(NEW.merchant_id,NEW.visit_id,NEW.source_visit_hash) IS NULL
 OR NEW.customer_auth_session_id IS NOT NULL AND NOT customer_personal_auth_current(NEW.merchant_id,NEW.customer_auth_session_id)
 OR NEW.customer_auth_session_id IS NOT NULL AND NEW.source_visit_hash IS NOT NULL AND EXISTS(
 SELECT 1 FROM table_recipient_profiles p JOIN customer_auth_sessions a ON a.merchant_id=p.merchant_id AND a.id=NEW.customer_auth_session_id
 WHERE p.merchant_id=NEW.merchant_id AND p.recipient_id=personal_source_recipient(NEW.merchant_id,NEW.visit_id,NEW.source_visit_hash) AND p.customer_id<>a.customer_id)
 THEN RAISE EXCEPTION 'TABLE_OCCUPANCY_CHANGED' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER private_visit_proof BEFORE INSERT ON table_visit_recipient_proofs FOR EACH ROW EXECUTE FUNCTION guard_visit_recipient_proof();
CREATE FUNCTION bind_visit_recipient(p_merchant uuid,p_visit uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE member table_occupancy_visits;occupied table_occupancies;proof table_visit_recipient_proofs;recipient uuid;authenticated customer_auth_sessions;profile table_recipient_profiles;
BEGIN
 PERFORM 1 FROM merchants WHERE id=p_merchant FOR NO KEY UPDATE;
 SELECT * INTO member FROM table_occupancy_visits WHERE merchant_id=p_merchant AND visit_id=p_visit;
 IF member.visit_id IS NULL THEN RETURN false;END IF;
 SELECT o.* INTO occupied FROM table_occupancies o JOIN merchant_tables t ON t.merchant_id=o.merchant_id AND t.id=o.table_id
 JOIN table_visit_epochs e ON e.merchant_id=o.merchant_id AND e.visit_id=p_visit AND e.table_id=o.table_id AND e.generation=o.generation
 WHERE o.merchant_id=p_merchant AND o.id=member.occupancy_id AND o.closed_at IS NULL AND t.retired_at IS NULL AND t.occupancy_generation=o.generation;
 IF occupied.id IS NULL THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM table_visit_recipients WHERE merchant_id=p_merchant AND visit_id=p_visit) THEN RETURN true;END IF;
 SELECT * INTO proof FROM table_visit_recipient_proofs WHERE merchant_id=p_merchant AND visit_id=p_visit;
 IF proof.customer_auth_session_id IS NOT NULL THEN
  SELECT * INTO authenticated FROM customer_auth_sessions WHERE merchant_id=p_merchant AND id=proof.customer_auth_session_id FOR SHARE;
  IF NOT customer_personal_auth_current(p_merchant,authenticated.id) THEN RETURN false;END IF;
 END IF;
 IF proof.source_visit_hash IS NOT NULL THEN
  recipient:=personal_source_recipient(p_merchant,p_visit,proof.source_visit_hash);
  IF recipient IS NULL OR NOT EXISTS(SELECT 1 FROM table_occupancy_recipients WHERE merchant_id=p_merchant AND id=recipient AND occupancy_id=occupied.id) THEN RETURN false;END IF;
  SELECT * INTO profile FROM table_recipient_profiles WHERE merchant_id=p_merchant AND recipient_id=recipient;
  IF authenticated.id IS NOT NULL AND profile.customer_id IS NOT NULL AND profile.customer_id<>authenticated.customer_id THEN RETURN false;END IF;
 ELSIF authenticated.id IS NOT NULL THEN
  SELECT r.id INTO recipient FROM table_occupancy_recipients r JOIN table_recipient_profiles p ON p.merchant_id=r.merchant_id AND p.recipient_id=r.id
  WHERE r.merchant_id=p_merchant AND r.occupancy_id=occupied.id AND p.customer_id=authenticated.customer_id ORDER BY r.created_at,r.id LIMIT 1;
 END IF;
 IF recipient IS NULL THEN INSERT INTO table_occupancy_recipients(merchant_id,occupancy_id) VALUES(p_merchant,occupied.id) RETURNING id INTO recipient;END IF;
 IF authenticated.id IS NOT NULL THEN
  INSERT INTO table_recipient_profiles(merchant_id,recipient_id,customer_id,basis) VALUES(p_merchant,recipient,authenticated.customer_id,'verified_wallet_consent') ON CONFLICT DO NOTHING;
  INSERT INTO table_recipient_auth_sessions VALUES(p_merchant,recipient,authenticated.id) ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO table_visit_recipients VALUES(p_merchant,p_visit,recipient,occupied.id);
 RETURN true;
END $$;
CREATE FUNCTION bind_order_recipient_customer(p_merchant uuid,p_order uuid,p_auth uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE recipient uuid;profile uuid;authenticated customer_auth_sessions;old order_customer_profiles;requires_recipient boolean;
BEGIN
 PERFORM 1 FROM merchants WHERE id=p_merchant FOR NO KEY UPDATE;
 SELECT * INTO authenticated FROM customer_auth_sessions WHERE merchant_id=p_merchant AND id=p_auth FOR SHARE;
 IF NOT customer_personal_auth_current(p_merchant,p_auth) OR NOT EXISTS(SELECT 1 FROM orders WHERE merchant_id=p_merchant AND id=p_order) THEN RETURN false;END IF;
 SELECT * INTO old FROM order_customer_profiles WHERE merchant_id=p_merchant AND order_id=p_order;
 IF old.order_id IS NOT NULL AND old.customer_id<>authenticated.customer_id THEN RETURN false;END IF;
 SELECT s.public_visit_id IS NOT NULL INTO requires_recipient FROM order_authority a JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id
 LEFT JOIN device_sessions s ON s.merchant_id=q.merchant_id AND s.id=q.session_id WHERE a.merchant_id=p_merchant AND a.order_id=p_order;
 SELECT r.recipient_id INTO recipient FROM order_authority a JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id
 JOIN device_sessions s ON s.merchant_id=q.merchant_id AND s.id=q.session_id JOIN table_visit_recipients r ON r.merchant_id=s.merchant_id AND r.visit_id=s.public_visit_id
 JOIN order_table_occupancies o ON o.merchant_id=a.merchant_id AND o.order_id=a.order_id AND o.occupancy_id=r.occupancy_id
 WHERE a.merchant_id=p_merchant AND a.order_id=p_order;
 IF requires_recipient AND recipient IS NULL THEN RETURN false;END IF;
 IF recipient IS NOT NULL THEN
  SELECT customer_id INTO profile FROM table_recipient_profiles WHERE merchant_id=p_merchant AND recipient_id=recipient;
  IF profile IS NOT NULL AND profile<>authenticated.customer_id THEN RETURN false;END IF;
  INSERT INTO table_recipient_profiles(merchant_id,recipient_id,customer_id,basis) VALUES(p_merchant,recipient,authenticated.customer_id,'verified_wallet_consent') ON CONFLICT DO NOTHING;
  INSERT INTO table_recipient_auth_sessions VALUES(p_merchant,recipient,p_auth) ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO order_customer_profiles(merchant_id,order_id,customer_id,customer_auth_session_id,recipient_id) VALUES(p_merchant,p_order,authenticated.customer_id,p_auth,recipient) ON CONFLICT DO NOTHING;
 RETURN true;
END $$;
CREATE FUNCTION guard_recipient_membership() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 IF NOT EXISTS(SELECT 1 FROM table_occupancy_visits m JOIN table_occupancies o ON o.merchant_id=m.merchant_id AND o.id=m.occupancy_id
 JOIN merchant_tables t ON t.merchant_id=o.merchant_id AND t.id=o.table_id JOIN table_visit_epochs e ON e.merchant_id=m.merchant_id AND e.visit_id=m.visit_id
 WHERE m.merchant_id=NEW.merchant_id AND m.visit_id=NEW.visit_id AND m.occupancy_id=NEW.occupancy_id AND o.closed_at IS NULL AND t.retired_at IS NULL
 AND o.generation=t.occupancy_generation AND e.generation=o.generation AND e.table_id=o.table_id)
 OR EXISTS(SELECT 1 FROM table_visit_recipients previous WHERE previous.merchant_id=NEW.merchant_id AND previous.recipient_id=NEW.recipient_id)
 AND NOT EXISTS(SELECT 1 FROM table_visit_recipient_proofs proof WHERE proof.merchant_id=NEW.merchant_id AND proof.visit_id=NEW.visit_id AND
 (proof.source_visit_hash IS NOT NULL AND personal_source_recipient(NEW.merchant_id,NEW.visit_id,proof.source_visit_hash)=NEW.recipient_id
 OR proof.source_visit_hash IS NULL AND proof.customer_auth_session_id IS NOT NULL AND customer_personal_auth_current(proof.merchant_id,proof.customer_auth_session_id)
 AND EXISTS(SELECT 1 FROM customer_auth_sessions a JOIN table_recipient_profiles p ON p.merchant_id=a.merchant_id AND p.customer_id=a.customer_id WHERE a.merchant_id=proof.merchant_id AND a.id=proof.customer_auth_session_id AND p.recipient_id=NEW.recipient_id)))
 THEN RAISE EXCEPTION 'TABLE_OCCUPANCY_CHANGED' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER recipient_membership BEFORE INSERT ON table_visit_recipients FOR EACH ROW EXECUTE FUNCTION guard_recipient_membership();
CREATE FUNCTION guard_recipient_acquisition() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 IF NOT EXISTS(SELECT 1 FROM table_occupancies o JOIN merchant_tables t ON t.merchant_id=o.merchant_id AND t.id=o.table_id
 JOIN table_occupancy_visits v ON v.merchant_id=o.merchant_id AND v.occupancy_id=o.id
 WHERE o.merchant_id=NEW.merchant_id AND o.id=NEW.occupancy_id AND o.closed_at IS NULL AND o.generation=t.occupancy_generation AND t.retired_at IS NULL)
 THEN RAISE EXCEPTION 'recipient requires acquired quote membership' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER recipient_acquisition BEFORE INSERT ON table_occupancy_recipients FOR EACH ROW EXECUTE FUNCTION guard_recipient_acquisition();
CREATE FUNCTION guard_recipient_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF TG_TABLE_NAME='table_occupancy_recipients' THEN
  IF NOT EXISTS(SELECT 1 FROM table_visit_recipients r WHERE r.merchant_id=NEW.merchant_id AND r.recipient_id=NEW.id AND r.occupancy_id=NEW.occupancy_id) THEN RAISE EXCEPTION 'recipient requires actual visit' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM table_visit_recipients r WHERE r.merchant_id=NEW.merchant_id AND r.visit_id=NEW.visit_id AND r.occupancy_id=NEW.occupancy_id) THEN RAISE EXCEPTION 'acquired visit requires recipient' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER recipient_complete AFTER INSERT ON table_occupancy_recipients DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_recipient_complete();
CREATE CONSTRAINT TRIGGER acquired_visit_recipient_complete AFTER INSERT ON table_occupancy_visits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_recipient_complete();
CREATE FUNCTION guard_recipient_auth_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 PERFORM 1 FROM customer_auth_sessions WHERE merchant_id=NEW.merchant_id AND id=NEW.customer_auth_session_id FOR SHARE;
 IF NOT customer_personal_auth_current(NEW.merchant_id,NEW.customer_auth_session_id) OR NOT EXISTS(SELECT 1 FROM customer_auth_sessions a JOIN table_recipient_profiles p ON p.merchant_id=a.merchant_id AND p.customer_id=a.customer_id WHERE a.merchant_id=NEW.merchant_id AND a.id=NEW.customer_auth_session_id AND p.recipient_id=NEW.recipient_id)
 THEN RAISE EXCEPTION 'recipient customer mismatch' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER recipient_verified_auth BEFORE INSERT ON table_recipient_auth_sessions FOR EACH ROW EXECUTE FUNCTION guard_recipient_auth_binding();
CREATE FUNCTION guard_verified_profile_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NEW.basis='verified_wallet_consent' AND NOT EXISTS(SELECT 1 FROM table_recipient_auth_sessions link JOIN customer_auth_sessions a ON a.merchant_id=link.merchant_id AND a.id=link.customer_auth_session_id
 WHERE link.merchant_id=NEW.merchant_id AND link.recipient_id=NEW.recipient_id AND a.customer_id=NEW.customer_id)
 THEN RAISE EXCEPTION 'verified profile requires authentication evidence' USING ERRCODE='23514';END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER verified_profile_complete AFTER INSERT ON table_recipient_profiles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_verified_profile_complete();
CREATE FUNCTION guard_order_customer_profile() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 PERFORM 1 FROM customer_auth_sessions WHERE merchant_id=NEW.merchant_id AND id=NEW.customer_auth_session_id FOR SHARE;
 IF NOT customer_personal_auth_current(NEW.merchant_id,NEW.customer_auth_session_id) OR NOT EXISTS(SELECT 1 FROM customer_auth_sessions a WHERE a.merchant_id=NEW.merchant_id AND a.id=NEW.customer_auth_session_id AND a.customer_id=NEW.customer_id)
 OR NEW.recipient_id IS DISTINCT FROM (SELECT r.recipient_id FROM order_authority a JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id JOIN device_sessions s ON s.merchant_id=q.merchant_id AND s.id=q.session_id JOIN table_visit_recipients r ON r.merchant_id=s.merchant_id AND r.visit_id=s.public_visit_id JOIN order_table_occupancies o ON o.merchant_id=a.merchant_id AND o.order_id=a.order_id AND o.occupancy_id=r.occupancy_id WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.order_id)
 OR NEW.recipient_id IS NULL AND EXISTS(SELECT 1 FROM order_authority a JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id JOIN device_sessions s ON s.merchant_id=q.merchant_id AND s.id=q.session_id
 WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.order_id AND s.public_visit_id IS NOT NULL)
 THEN RAISE EXCEPTION 'order customer evidence mismatch' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER order_verified_profile BEFORE INSERT ON order_customer_profiles FOR EACH ROW EXECUTE FUNCTION guard_order_customer_profile();
CREATE FUNCTION personal_job_binding_current(p_merchant uuid,p_job uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM personal_promotion_job_bindings b JOIN table_occupancies o ON o.merchant_id=b.merchant_id AND o.id=b.occupancy_id
 JOIN merchant_tables t ON t.merchant_id=b.merchant_id AND t.id=b.table_id JOIN devices d ON d.merchant_id=b.merchant_id AND d.id=b.target_device_id
 JOIN table_visits visit ON visit.merchant_id=b.merchant_id AND visit.id=b.recipient_visit_id JOIN table_entries e ON e.merchant_id=visit.merchant_id AND e.id=visit.entry_id
 WHERE b.merchant_id=p_merchant AND b.job_id=p_job AND o.closed_at IS NULL AND t.retired_at IS NULL AND t.occupancy_generation=b.occupancy_generation AND o.generation=b.occupancy_generation
 AND d.revoked_at IS NULL AND d.table_id=b.table_id AND d.assignment_generation=b.assignment_generation AND d.auth_generation=b.auth_generation
 AND e.device_id=d.id AND e.table_id=b.table_id AND e.assignment_generation=b.assignment_generation AND e.auth_generation=b.auth_generation
 AND (b.customer_id IS NULL OR EXISTS(SELECT 1 FROM table_recipient_profiles p WHERE p.merchant_id=b.merchant_id AND p.recipient_id=b.recipient_id AND p.customer_id=b.customer_id))
 AND (b.customer_auth_session_id IS NULL OR customer_personal_auth_current(b.merchant_id,b.customer_auth_session_id))
 AND (b.source_order_id IS NULL OR personal_order_verified_paid(b.merchant_id,b.source_order_id)))
$$;
CREATE FUNCTION guard_personal_job_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NEW.customer_auth_session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM table_recipient_auth_sessions a JOIN customer_auth_sessions s ON s.merchant_id=a.merchant_id AND s.id=a.customer_auth_session_id WHERE a.merchant_id=NEW.merchant_id AND a.recipient_id=NEW.recipient_id AND a.customer_auth_session_id=NEW.customer_auth_session_id AND s.customer_id=NEW.customer_id AND customer_personal_auth_current(s.merchant_id,s.id))
 OR NEW.source_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM order_authority a JOIN order_table_occupancies o ON o.merchant_id=a.merchant_id AND o.order_id=a.order_id JOIN quote_table_occupancies q ON q.merchant_id=o.merchant_id AND q.quote_id=o.quote_id
 JOIN order_quotes review ON review.merchant_id=q.merchant_id AND review.id=q.quote_id JOIN device_sessions session ON session.merchant_id=review.merchant_id AND session.id=review.session_id JOIN table_visit_recipients r ON r.merchant_id=session.merchant_id AND r.visit_id=session.public_visit_id
 WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.source_order_id AND personal_order_verified_paid(a.merchant_id,a.order_id) AND o.occupancy_id=NEW.occupancy_id AND r.recipient_id=NEW.recipient_id AND r.occupancy_id=NEW.occupancy_id
 AND a.target_device_id=NEW.target_device_id AND a.target_assignment_generation=NEW.assignment_generation AND a.serving_table_id=NEW.table_id AND q.auth_generation=NEW.auth_generation AND q.generation=NEW.occupancy_generation)
 OR NEW.excluded_product_ids IS DISTINCT FROM ARRAY(SELECT product_id FROM order_items WHERE merchant_id=NEW.merchant_id AND order_id=NEW.source_order_id ORDER BY product_id)
 THEN RAISE EXCEPTION 'personal source binding mismatch' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER personal_job_source BEFORE INSERT ON personal_promotion_job_bindings FOR EACH ROW EXECUTE FUNCTION guard_personal_job_binding();
CREATE FUNCTION guard_personal_job_current() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NOT personal_job_binding_current(NEW.merchant_id,NEW.job_id) THEN RAISE EXCEPTION 'TABLE_OCCUPANCY_CHANGED' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER personal_job_current AFTER INSERT ON personal_promotion_job_bindings FOR EACH ROW EXECUTE FUNCTION guard_personal_job_current();
CREATE FUNCTION personal_promotion_eligible(p_merchant uuid,p_target uuid,p_session uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM promotion_playlist_targets target JOIN promotion_campaigns c ON c.merchant_id=target.merchant_id AND c.id=target.campaign_id
 JOIN personal_promotion_job_bindings b ON b.merchant_id=c.merchant_id AND b.job_id=c.job_id
 JOIN device_sessions s ON s.merchant_id=target.merchant_id AND s.id=p_session JOIN table_visit_recipients r ON r.merchant_id=s.merchant_id AND r.visit_id=s.public_visit_id
 JOIN device_screen_state screen ON screen.merchant_id=s.merchant_id AND screen.device_id=s.device_id
 WHERE target.merchant_id=p_merchant AND target.id=p_target AND target.audience='personal' AND target.state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED')
 AND playlist_target_current(target.merchant_id,target.id) AND personal_job_binding_current(b.merchant_id,b.job_id)
 AND target.recipient_id=b.recipient_id AND target.occupancy_id=b.occupancy_id AND target.occupancy_generation=b.occupancy_generation AND target.table_id=b.table_id
 AND target.target_device_id=b.target_device_id AND target.assignment_generation=b.assignment_generation AND target.auth_generation=b.auth_generation
 AND NOT c.product_id=ANY(b.excluded_product_ids)
 AND c.starts_at<=clock_timestamp() AND target.expires_at<=c.expires_at
 AND s.ended_at IS NULL AND s.device_id=target.target_device_id AND s.assignment_generation=target.assignment_generation AND r.recipient_id=target.recipient_id AND r.occupancy_id=target.occupancy_id
 AND screen.kind='cart' AND screen.session_id=s.id AND screen.lease_until>clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM personal_order_promotions used WHERE used.merchant_id=target.merchant_id AND used.campaign_id=target.campaign_id AND used.campaign_version=target.campaign_version AND used.recipient_id=target.recipient_id))
$$;
-- Extend the existing final-send/ACK predicate, not just the menu query. No render ACK grants eligibility.
ALTER FUNCTION playlist_target_current(uuid,uuid) RENAME TO playlist_target_current_pre_personal;
CREATE FUNCTION playlist_target_current(p_merchant uuid,p_target uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE target promotion_playlist_targets;campaign promotion_campaigns;binding personal_promotion_job_bindings;
BEGIN
 IF NOT playlist_target_current_pre_personal(p_merchant,p_target) THEN RETURN false;END IF;
 SELECT * INTO target FROM promotion_playlist_targets WHERE merchant_id=p_merchant AND id=p_target;
 IF target.state NOT IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED') THEN RETURN false;END IF;
 IF target.audience='daily' THEN RETURN true;END IF;
 SELECT * INTO campaign FROM promotion_campaigns WHERE merchant_id=p_merchant AND id=target.campaign_id;
 SELECT * INTO binding FROM personal_promotion_job_bindings WHERE merchant_id=p_merchant AND job_id=campaign.job_id;
 IF binding.customer_auth_session_id IS NOT NULL THEN
  PERFORM 1 FROM customer_auth_sessions WHERE merchant_id=p_merchant AND id=binding.customer_auth_session_id FOR SHARE;
 END IF;
 RETURN binding.job_id IS NOT NULL AND personal_job_binding_current(p_merchant,binding.job_id) AND campaign.starts_at<=clock_timestamp()
 AND target.expires_at<=campaign.expires_at AND target.recipient_id=binding.recipient_id AND target.occupancy_id=binding.occupancy_id
 AND target.occupancy_generation=binding.occupancy_generation AND target.table_id=binding.table_id AND target.target_device_id=binding.target_device_id
 AND target.assignment_generation=binding.assignment_generation AND target.auth_generation=binding.auth_generation AND NOT campaign.product_id=ANY(binding.excluded_product_ids)
 AND NOT EXISTS(SELECT 1 FROM personal_order_promotions used WHERE used.merchant_id=p_merchant AND used.campaign_id=target.campaign_id AND used.campaign_version=target.campaign_version AND used.recipient_id=target.recipient_id);
END $$;
REVOKE ALL ON FUNCTION playlist_target_current_pre_personal(uuid,uuid),playlist_target_current(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION playlist_target_current_pre_personal(uuid,uuid),playlist_target_current(uuid,uuid) TO bitpos_app;
CREATE FUNCTION guard_personal_playlist_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NEW.audience='personal' AND NOT EXISTS(SELECT 1 FROM promotion_campaigns c JOIN personal_promotion_job_bindings b ON b.merchant_id=c.merchant_id AND b.job_id=c.job_id
 WHERE c.merchant_id=NEW.merchant_id AND c.id=NEW.campaign_id AND b.recipient_id=NEW.recipient_id AND b.table_id=NEW.table_id AND b.occupancy_id=NEW.occupancy_id AND b.occupancy_generation=NEW.occupancy_generation
 AND b.target_device_id=NEW.target_device_id AND b.assignment_generation=NEW.assignment_generation AND b.auth_generation=NEW.auth_generation AND personal_job_binding_current(b.merchant_id,b.job_id) AND NEW.expires_at<=c.expires_at AND NOT c.product_id=ANY(b.excluded_product_ids))
 THEN RAISE EXCEPTION 'personal publication binding mismatch' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER personal_playlist_binding BEFORE INSERT ON promotion_playlist_targets FOR EACH ROW EXECUTE FUNCTION guard_personal_playlist_binding();
CREATE FUNCTION guard_personal_quote_line() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE line jsonb;target promotion_playlist_targets;campaign promotion_campaigns;revision promotion_revisions;scope promotion_scopes;base bigint;price bigint;public_price bigint;offer versioned_product_offers;daily_price bigint;
BEGIN
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 FOR line IN SELECT value FROM jsonb_array_elements(NEW.lines) WHERE value ? 'personalPromotion' LOOP
  SELECT * INTO STRICT target FROM promotion_playlist_targets WHERE merchant_id=NEW.merchant_id AND id=(line->'personalPromotion'->>'targetId')::uuid;
  SELECT * INTO STRICT campaign FROM promotion_campaigns WHERE merchant_id=NEW.merchant_id AND id=target.campaign_id;
  PERFORM 1 FROM customer_auth_sessions a JOIN personal_promotion_job_bindings b ON b.merchant_id=a.merchant_id AND b.customer_auth_session_id=a.id
  WHERE b.merchant_id=NEW.merchant_id AND b.job_id=campaign.job_id FOR SHARE OF a;
  SELECT * INTO STRICT revision FROM promotion_revisions WHERE merchant_id=NEW.merchant_id AND campaign_id=campaign.id AND version=target.campaign_version;
  SELECT * INTO STRICT scope FROM promotion_scopes WHERE merchant_id=NEW.merchant_id AND campaign_id=campaign.id AND audience IN ('customer','from_order');
  SELECT cp.unit_minor INTO STRICT base FROM catalog_prices cp JOIN merchant_pricing m ON m.merchant_id=cp.merchant_id AND m.active_price_version_id=cp.price_version_id WHERE cp.merchant_id=NEW.merchant_id AND cp.price_version_id=NEW.price_version_id AND cp.product_id=campaign.product_id;
  public_price:=base;
  SELECT * INTO offer FROM versioned_product_offers WHERE merchant_id=NEW.merchant_id AND price_version_id=NEW.price_version_id AND product_id=campaign.product_id ORDER BY revision DESC LIMIT 1;
  IF offer.enabled AND offer.expires_at>clock_timestamp() THEN public_price:=offer.current_minor;END IF;
  SELECT min(base-floor(base::numeric*(r.content->>'discountPercent')::integer/100)::bigint) INTO daily_price FROM promotion_campaigns c
   JOIN promotion_scopes s ON s.merchant_id=c.merchant_id AND s.campaign_id=c.id AND s.audience='daily'
   JOIN promotion_revisions r ON r.merchant_id=c.merchant_id AND r.campaign_id=c.id AND r.version=c.approved_version
   WHERE c.merchant_id=NEW.merchant_id AND c.product_id=campaign.product_id AND c.state='APPROVED' AND c.starts_at<=clock_timestamp() AND c.expires_at>clock_timestamp()
   AND r.content->'snapshot'->>'priceVersion'=NEW.price_version_id::text AND (r.content->'snapshot'->'basePrice'->>'amountMinor')::bigint=base
   AND r.content->'snapshot'->>'imageUrl' IS NOT DISTINCT FROM (SELECT image_url FROM products WHERE merchant_id=NEW.merchant_id AND id=c.product_id)
   AND base-floor(base::numeric*(r.content->>'discountPercent')::integer/100)::bigint>=s.minimum_unit_minor;
  public_price:=least(public_price,coalesce(daily_price,public_price));price:=base-floor(base::numeric*(revision.content->>'discountPercent')::integer/100)::bigint;
  IF NOT personal_promotion_eligible(NEW.merchant_id,target.id,NEW.session_id) OR NEW.origin_kind<>'device' OR NEW.source_device_id IS DISTINCT FROM target.target_device_id
   OR (NEW.authority->'target'->>'deviceId')::uuid IS DISTINCT FROM target.target_device_id OR (NEW.authority->'serving'->>'tableId')::uuid IS DISTINCT FROM target.table_id
   OR (line->>'qty')::integer IS DISTINCT FROM 1 OR line->>'productId' IS DISTINCT FROM campaign.product_id::text OR line->'promotion' IS DISTINCT FROM 'null'::jsonb OR line ? 'dailyPromotion' OR line ? 'scopedPromotion'
   OR line->'personalPromotion' IS DISTINCT FROM jsonb_build_object('targetId',target.id::text,'campaignId',target.campaign_id::text,'campaignVersion',target.campaign_version,'recipientId',target.recipient_id::text,'occupancyId',target.occupancy_id::text,'occupancyGeneration',target.occupancy_generation::text,'sessionId',NEW.session_id::text,'discountPercent',(revision.content->>'discountPercent')::integer,'expiresAt',line->'personalPromotion'->>'expiresAt')
   OR (line->'personalPromotion'->>'expiresAt')::timestamptz IS DISTINCT FROM target.expires_at OR NEW.valid_until>target.expires_at
   OR revision.content->'snapshot'->>'priceVersion' IS DISTINCT FROM NEW.price_version_id::text OR (revision.content->'snapshot'->'basePrice'->>'amountMinor')::bigint IS DISTINCT FROM base
   OR revision.content->'snapshot'->>'imageUrl' IS DISTINCT FROM (SELECT image_url FROM products WHERE merchant_id=NEW.merchant_id AND id=campaign.product_id)
   OR price<scope.minimum_unit_minor OR price>=public_price OR (line->'basePrice'->>'amountMinor')::bigint IS DISTINCT FROM base OR (line->'unitPrice'->>'amountMinor')::bigint IS DISTINCT FROM price
   OR line->'basePrice'->>'currency' IS DISTINCT FROM line->'unitPrice'->>'currency' OR line->'basePrice'->>'decimals' IS DISTINCT FROM line->'unitPrice'->>'decimals'
   OR NOT EXISTS(SELECT 1 FROM products WHERE merchant_id=NEW.merchant_id AND id=campaign.product_id AND stock-reserved>=1)
  THEN RAISE EXCEPTION 'invalid personal quote authority' USING ERRCODE='23514';END IF;
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER personal_quote_authority BEFORE INSERT ON order_quotes FOR EACH ROW EXECUTE FUNCTION guard_personal_quote_line();
CREATE FUNCTION guard_personal_quote_sidecar() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM order_quotes q CROSS JOIN LATERAL jsonb_array_elements(q.lines) l WHERE q.merchant_id=NEW.merchant_id AND q.id=NEW.quote_id
 AND l->>'productId'=NEW.product_id::text AND l->'personalPromotion'=NEW.evidence AND NEW.evidence->>'targetId'=NEW.target_id::text
 AND NEW.evidence->>'campaignId'=NEW.campaign_id::text AND (NEW.evidence->>'campaignVersion')::integer=NEW.campaign_version AND NEW.evidence->>'recipientId'=NEW.recipient_id::text)
 THEN RAISE EXCEPTION 'personal quote evidence mismatch' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER personal_quote_sidecar BEFORE INSERT ON personal_quote_promotions FOR EACH ROW EXECUTE FUNCTION guard_personal_quote_sidecar();
CREATE FUNCTION guard_personal_order_sidecar() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 PERFORM 1 FROM merchants WHERE id=NEW.merchant_id FOR NO KEY UPDATE;
 IF NOT EXISTS(SELECT 1 FROM order_authority a JOIN personal_quote_promotions q ON q.merchant_id=a.merchant_id AND q.quote_id=a.quote_id
 JOIN order_quotes review ON review.merchant_id=q.merchant_id AND review.id=q.quote_id JOIN device_sessions s ON s.merchant_id=review.merchant_id AND s.id=review.session_id
 JOIN table_visit_recipients r ON r.merchant_id=s.merchant_id AND r.visit_id=s.public_visit_id JOIN order_table_occupancies o ON o.merchant_id=a.merchant_id AND o.order_id=a.order_id AND o.occupancy_id=r.occupancy_id
 WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.order_id AND q.quote_id=NEW.quote_id AND q.product_id=NEW.product_id AND q.target_id=NEW.target_id
 AND q.campaign_id=NEW.campaign_id AND q.campaign_version=NEW.campaign_version AND q.recipient_id=NEW.recipient_id AND q.evidence=NEW.evidence
 AND r.recipient_id=NEW.recipient_id AND personal_promotion_eligible(NEW.merchant_id,NEW.target_id,review.session_id))
 THEN RAISE EXCEPTION 'personal bill evidence mismatch' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER personal_order_sidecar BEFORE INSERT ON personal_order_promotions FOR EACH ROW EXECUTE FUNCTION guard_personal_order_sidecar();
CREATE FUNCTION guard_personal_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF TG_TABLE_NAME='order_quotes' THEN
  IF (SELECT count(*) FROM jsonb_array_elements(NEW.lines) l WHERE l ? 'personalPromotion')<>(SELECT count(*) FROM personal_quote_promotions p WHERE p.merchant_id=NEW.merchant_id AND p.quote_id=NEW.id) THEN RAISE EXCEPTION 'missing personal quote evidence' USING ERRCODE='23514';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM order_authority a JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id WHERE a.merchant_id=NEW.merchant_id AND a.order_id=NEW.id AND (SELECT count(*) FROM jsonb_array_elements(q.lines) l WHERE l ? 'personalPromotion')<>(SELECT count(*) FROM personal_order_promotions p WHERE p.merchant_id=NEW.merchant_id AND p.order_id=NEW.id)) THEN RAISE EXCEPTION 'missing personal bill evidence' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER personal_quote_complete AFTER INSERT ON order_quotes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_personal_complete();
CREATE CONSTRAINT TRIGGER personal_bill_complete AFTER INSERT ON orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_personal_complete();
CREATE FUNCTION guard_personal_context_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$ BEGIN
 IF NEW.audience IN ('customer','from_order') AND NOT EXISTS(SELECT 1 FROM personal_promotion_job_bindings b WHERE b.merchant_id=NEW.merchant_id AND b.job_id=NEW.job_id)
 THEN RAISE EXCEPTION 'personal context requires private binding' USING ERRCODE='23514';END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER personal_context_complete AFTER INSERT ON promotion_job_contexts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_personal_context_complete();
DO $$ DECLARE relation text;BEGIN
 FOREACH relation IN ARRAY ARRAY['table_occupancy_recipients','table_visit_recipient_proofs','table_visit_recipients','table_recipient_profiles','table_recipient_auth_sessions','order_customer_profiles','personal_promotion_job_bindings','personal_quote_promotions','personal_order_promotions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',relation);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO bitpos_app',relation);
  EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_authority_row()',relation);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION customer_personal_auth_current(uuid,uuid),personal_order_verified_paid(uuid,uuid),personal_source_recipient(uuid,uuid,text),bind_visit_recipient(uuid,uuid),bind_order_recipient_customer(uuid,uuid,uuid),personal_job_binding_current(uuid,uuid),personal_promotion_eligible(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_personal_auth_current(uuid,uuid),personal_order_verified_paid(uuid,uuid),personal_source_recipient(uuid,uuid,text),bind_visit_recipient(uuid,uuid),bind_order_recipient_customer(uuid,uuid,uuid),personal_job_binding_current(uuid,uuid),personal_promotion_eligible(uuid,uuid,uuid) TO bitpos_app;
