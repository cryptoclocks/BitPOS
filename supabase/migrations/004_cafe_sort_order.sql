SET search_path TO bitpos, public;
ALTER TABLE products ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
