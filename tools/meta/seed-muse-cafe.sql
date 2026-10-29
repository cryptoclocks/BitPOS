-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- The Meta demo shop "Muse Café", separate from the shared Purple Cafe: menu with USD cent prices (Stripe), three
-- tables each with a BitPOS Mini device and a simulated NTAG tag, and the Messenger Page moved over from Purple
-- Cafe (its row is retired, not deleted). Idempotent: fixed ids, ON CONFLICT DO NOTHING. Run as the database owner
-- after migration 312. Staff accounts are created separately (tools/meta/create-demo-staff.sh); no secrets here.
-- Usage: psql -v ON_ERROR_STOP=1 -1 -v page_id=<Messenger page id> -f tools/meta/seed-muse-cafe.sql
SET search_path TO bitpos,extensions,public;

INSERT INTO merchants(id,name,treasury) SELECT '33333333-3333-4333-8333-333333333333','Muse Café',treasury FROM merchants WHERE id='11111111-1111-4111-8111-111111111111'
 ON CONFLICT DO NOTHING;

INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock,image_url,category,description,catalog_key,sort_order) VALUES
 ('33333333-3333-4333-8333-333333333333','33333333-0001-4000-8000-000000000001','ลาเต้','Latte','🥛',500,60,'/images/menu/latte.jpg','Coffee','เอสเปรสโซช็อตคู่ นมสด ฟองนุ่ม','muse.latte',0),
 ('33333333-3333-4333-8333-333333333333','33333333-0001-4000-8000-000000000002','ลาเต้เย็น','Iced latte','🧊',550,60,'/images/menu/iced-latte.jpg','Coffee','ลาเต้เย็น นมสด','muse.iced-latte',1),
 ('33333333-3333-4333-8333-333333333333','33333333-0001-4000-8000-000000000003','เอสเปรสโซ','Espresso','☕',350,60,'/images/menu/espresso.jpg','Coffee','ช็อตคู่ เข้ม','muse.espresso',2),
 ('33333333-3333-4333-8333-333333333333','33333333-0001-4000-8000-000000000004','คาปูชิโน','Cappuccino','☕',500,60,'/images/menu/cappuccino.jpg','Coffee','ฟองนมหนา','muse.cappuccino',3),
 ('33333333-3333-4333-8333-333333333333','33333333-0001-4000-8000-000000000005','มัทฉะลาเต้','Matcha latte','🍵',550,60,'/images/menu/matcha.jpg','Tea & Chocolate','มัทฉะ นมสด','muse.matcha',4),
 ('33333333-3333-4333-8333-333333333333','33333333-0001-4000-8000-000000000006','ช็อกโกแลตร้อน','Hot chocolate','🍫',500,60,'/images/menu/hot-chocolate.jpg','Tea & Chocolate','โกโก้เข้ม','muse.hot-chocolate',5),
 ('33333333-3333-4333-8333-333333333333','33333333-0001-4000-8000-000000000007','ครัวซองต์','Croissant','🥐',400,40,'/images/menu/croissant.jpg','Bakery','อบใหม่ทุกเช้า','muse.croissant',6),
 ('33333333-3333-4333-8333-333333333333','33333333-0001-4000-8000-000000000008','มัฟฟินบลูเบอร์รี','Blueberry muffin','🫐',375,40,'/images/menu/blueberry-muffin.jpg','Bakery','บลูเบอร์รีเต็มคำ','muse.muffin',7),
 ('33333333-3333-4333-8333-333333333333','33333333-0001-4000-8000-000000000009','ชีสเค้ก','Cheesecake','🍰',650,20,'/images/menu/cheesecake.jpg','Desserts','นิวยอร์กชีสเค้ก','muse.cheesecake',8)
 ON CONFLICT DO NOTHING;

-- Prices in USD cents, the server's canonical amounts for Stripe.
INSERT INTO catalog_price_versions(merchant_id,id,currency,decimals,provenance,quote_policy) VALUES
 ('33333333-3333-4333-8333-333333333333','33333333-0002-4000-8000-000000000001','USD',2,'owner_configured','USD_CENTS_TO_USDG_1_TO_1') ON CONFLICT DO NOTHING;
INSERT INTO catalog_prices(merchant_id,price_version_id,product_id,unit_minor)
 SELECT merchant_id,'33333333-0002-4000-8000-000000000001',id,price_minor FROM products WHERE merchant_id='33333333-3333-4333-8333-333333333333' ON CONFLICT DO NOTHING;
INSERT INTO merchant_pricing(merchant_id,active_price_version_id,revision) VALUES('33333333-3333-4333-8333-333333333333','33333333-0002-4000-8000-000000000001',1) ON CONFLICT DO NOTHING;

INSERT INTO merchant_tables(merchant_id,id,label) VALUES
 ('33333333-3333-4333-8333-333333333333','33333333-0003-4000-8000-000000000001','Table 1'),
 ('33333333-3333-4333-8333-333333333333','33333333-0003-4000-8000-000000000002','Table 2'),
 ('33333333-3333-4333-8333-333333333333','33333333-0003-4000-8000-000000000003','Table 3') ON CONFLICT DO NOTHING;
INSERT INTO devices(merchant_id,id,label,table_id) VALUES
 ('33333333-3333-4333-8333-333333333333','33333333-0004-4000-8000-000000000001','Muse Mini · Table 1','33333333-0003-4000-8000-000000000001'),
 ('33333333-3333-4333-8333-333333333333','33333333-0004-4000-8000-000000000002','Muse Mini · Table 2','33333333-0003-4000-8000-000000000002'),
 ('33333333-3333-4333-8333-333333333333','33333333-0004-4000-8000-000000000003','Muse Mini · Table 3','33333333-0003-4000-8000-000000000003') ON CONFLICT DO NOTHING;
-- Simulated tags (tools/meta/sim-tap.ts) until physical NTAG 424 stickers are written. UIDs are fixture values.
INSERT INTO meta_ntag_tags(tag_id,merchant_id,device_id,uid) VALUES
 ('muse-t1','33333333-3333-4333-8333-333333333333','33333333-0004-4000-8000-000000000001','04A10000000001'),
 ('muse-t2','33333333-3333-4333-8333-333333333333','33333333-0004-4000-8000-000000000002','04A10000000002'),
 ('muse-t3','33333333-3333-4333-8333-333333333333','33333333-0004-4000-8000-000000000003','04A10000000003') ON CONFLICT DO NOTHING;

-- The Messenger Page moves to Muse Café; Purple Cafe's row and links stay as history.
UPDATE meta_messenger_pages SET retired_at=clock_timestamp() WHERE page_id=:'page_id' AND merchant_id<>'33333333-3333-4333-8333-333333333333' AND retired_at IS NULL;
INSERT INTO meta_messenger_pages(page_id,merchant_id,page_username)
 SELECT :'page_id','33333333-3333-4333-8333-333333333333',page_username FROM meta_messenger_pages WHERE page_id=:'page_id' ORDER BY created_at LIMIT 1
 ON CONFLICT DO NOTHING;

-- meta-pos (the POS screens, Meta edition) needs a register for its cart; the counter sale is paid by Stripe, so it
-- is not paired with a POSClock.
INSERT INTO registers(merchant_id,id,label) VALUES('33333333-3333-4333-8333-333333333333','33333333-0005-4000-8000-000000000001','Counter')
 ON CONFLICT DO NOTHING;
