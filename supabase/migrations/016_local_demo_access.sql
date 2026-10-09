SET search_path TO bitpos,public;
-- Only a finite allowlisted-origin/loopback keyspace; no password, IP or session token stored here.
CREATE TABLE demo_login_buckets(bucket text PRIMARY KEY CHECK(bucket ~ '^[0-9a-f]{64}$'),window_start timestamptz NOT NULL,hits integer NOT NULL CHECK(hits BETWEEN 1 AND 12));
GRANT SELECT,INSERT,UPDATE ON demo_login_buckets TO bitpos_app;
