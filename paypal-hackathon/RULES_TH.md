# เงื่อนไข PayPal AI Hackathon สำหรับ BitPOS

ตรวจเมื่อ 12 ตุลาคม 2026 จาก [Official Rules](https://paypalaihackathon.devpost.com/rules), [Overview](https://paypalaihackathon.devpost.com/) และ [FAQ](https://paypalaihackathon.devpost.com/details/faqs) เอกสารนี้เป็นสรุปเพื่อวางแผน ไม่ใช่คำแปลครบทุกข้อหรือการรับรอง eligibility กติกาทางการมีผลเหนือข้อความประชาสัมพันธ์และอาจเปลี่ยนได้

## เวลา

| รายการ | Pacific ตามกติกา | เวลาไทย Asia/Bangkok |
|---|---|---|
| เปิดรับ | 1 ต.ค. 2026 09:15 PDT | 1 ต.ค. 2026 23:15 |
| ปิดรับ | 12 พ.ย. 2026 12:00 PST | **13 พ.ย. 2026 03:00** |
| เริ่มตัดสิน | 1 ธ.ค. 2026 14:00 PST | 2 ธ.ค. 2026 05:00 |
| จบตัดสิน | 15 ธ.ค. 2026 08:00 PST | **15 ธ.ค. 2026 23:00** |
| ประกาศผู้ชนะโดยประมาณ | 21 ธ.ค. 2026 14:00 PST | 22 ธ.ค. 2026 05:00 |

แปลงด้วยเขตเวลา `America/Los_Angeles` → `Asia/Bangkok` ซึ่งคำนึงถึง daylight saving ไม่บวกจำนวนชั่วโมงเดียวตลอดช่วงแข่งขัน [Rules §1](https://paypalaihackathon.devpost.com/rules)

## สิ่งที่กระทบการส่งของเรา

| เงื่อนไข | ผลต่อ BitPOS / สิ่งที่ต้องทำ |
|---|---|
| PayPal developer platform บน sandbox และ AI ต้องใช้จริง; PayPal เป็นส่วนสำคัญ | เพิ่ม server-side Orders/capture พร้อม AI ใน product flow; การใช้ AI เขียนโค้ดอย่างเดียวไม่ใช่เป้าหมายที่เสนอ |
| โครงการเดิมส่งได้เมื่อปรับปรุงอย่างมีนัยสำคัญในช่วงรับผลงาน | เปิดเผยฐานเดิม พร้อม diff/commit/evidence ของ PayPal และ AI; ผู้จัดเป็นผู้ตัดสินว่าเปลี่ยนมากพอหรือไม่ |
| ต้องมี functional demo | hosted demo หรือ setup/run instructions ที่กรรมการทำตามได้; static mockup ใช้แทนไม่ได้ |
| public open-source repository พร้อม license | ใช้ `cryptoclocks/BitPOS` และ Apache-2.0 เดิม ตรวจ license visibility ใน GitHub About และ third-party notices อีกครั้ง |
| วิดีโอสั้นกว่า 3 นาที แสดงการทำงานบนแพลตฟอร์มเป้าหมาย | ทำคลิปใหม่ 2:50 นาทีเป็นภาษาอังกฤษ โชว์ AI → PayPal → paid → ผลลัพธ์; ลง YouTube แบบ publicly visible |
| ข้อความ วิดีโอ คู่มือทดสอบ และเอกสารที่ส่งต้องมีภาษาอังกฤษ/คำแปลอังกฤษ | เอกสารไทยในโฟลเดอร์นี้เป็นแผนภายใน ก่อนส่งต้องทำ English judge packet ครบตามที่ใช้จริง |
| ให้กรรมการเข้าถึงฟรีจนจบ judging | รักษา demo/test access จน 15 ธ.ค. 23:00 ไทย; มี test accounts และวิธีรับ access ที่ชัดเจน |
| hardware เฉพาะอาจถูกขอเข้าถึงจริง | มี browser terminal ที่ทำงานกับ backend จริงเป็นเส้นทางทดสอบหลัก และเตรียมการเข้าถึง BitPOS Mini หากผู้จัดร้องขอ |
| หนึ่งผู้เข้าแข่งขันส่งหลายงานได้ แต่งานในรายการนี้ต้องต่างกันอย่างมีนัยสำคัญ | เสนอเพียงหนึ่ง PayPal submission ของ BitPOS; ไม่สร้างรายการซ้ำเปลี่ยนชื่อ |

อ้างอิง [Rules §4–5](https://paypalaihackathon.devpost.com/rules) และรายละเอียด tools disclosure ใน [Overview — What to Submit](https://paypalaihackathon.devpost.com/)

## Eligibility และการส่งอีกการแข่งขัน

- บุคคลต้องบรรลุนิติภาวะตามถิ่นที่อยู่ ทีมและองค์กรสมัครได้ ต้องมีตัวแทนที่ได้รับมอบอำนาจ กติกาไม่ได้กำหนดขนาดทีมสูงสุดตาม [FAQ](https://paypalaihackathon.devpost.com/details/faqs)
- ไทยไม่อยู่ในรายชื่อพื้นที่ที่ยกตัวอย่างว่าห้าม แต่ยังต้องตรวจสถานะสมาชิกทุกคน กฎหมายที่เกี่ยวข้อง sanctions และผลประโยชน์ทับซ้อน ไม่อนุมานสิทธิ์จากการกด Join ได้
- การเปิด PayPal account กับ eligibility ของการแข่งขันเป็นคนละเรื่อง ต้องตรวจ Developer/Sandbox access ของทีมจริง; หากสมัครไม่ได้ FAQ ให้สอบถามทีม PayPal
- ต้องตรวจเงื่อนไขผลประโยชน์ทับซ้อนและ financial/preferential support จาก PayPal/Devpost ตาม §3–4 ด้วย ยังไม่ได้ยืนยันประวัติของทีมในรอบนี้
- PayPal ยอมให้ต่อยอด existing project แต่ไม่ได้แปลว่าผู้จัดการแข่งขันก่อนหน้ารับรองการส่งซ้ำข้ามรายการแล้ว ต้องตรวจข้อตกลง Crypto World's Fair/ทุน/รางวัล/ทีมที่ผู้ใช้ยอมรับจริงก่อนส่ง โดยเปิดเผยประวัติทั้งสองรายการ
- ถ้าเงื่อนไข significant update หรือ cross-competition ยังคลุมเครือ ให้ขอคำชี้แจงเป็นลายลักษณ์อักษรจากผู้จัดก่อน deadline ตาม §11.6; รอบนี้ยังไม่ได้ส่งข้อความถึงใคร

ร่างประเด็นสอบถาม: “We plan to extend our existing BitPOS project, also prepared for Crypto World's Fair, with a new PayPal Sandbox checkout and an in-product AI campaign workflow during your submission period. We will disclose prior work and the new changes. Are there additional cross-competition or disclosure requirements we should follow?”

## วิธีให้คะแนนและเป้ารางวัล

ด่านแรกตรวจ theme/API viability แบบผ่าน/ไม่ผ่าน จากนั้น **5 เกณฑ์น้ำหนักเท่ากัน**: Technological Implementation, Design, Potential Impact, Innovation/Idea, Presentation; กรณีคะแนนเสมอพิจารณาตามลำดับเกณฑ์ [Rules §6](https://paypalaihackathon.devpost.com/rules)

| เป้าหมายที่เสนอ | เหตุผล / เงื่อนไข |
|---|---|
| Overall: อันดับ 1 $12,000 / 2 $8,000 / 3 $5,000 | ทำ core flow ให้ครบและทดสอบได้ |
| Best Use of PayPal + AI — $5,000 | ตรงกับวงจร AI offer → PayPal settlement → campaign outcome |
| Most Impactful / Best Demo Delivery — อย่างละ $5,000 | ใช้หลักฐานร้านกาแฟและคลิปที่เข้าใจง่าย ไม่อ้างยอดขายเพิ่มโดยไม่มีข้อมูล |
| Best Use of Agentic Commerce — $5,000, เป้ารอง | ต้องมี agent workflow ที่ลงมือผ่าน tools และ approval จริงก่อนใช้คำนี้; AI text generator อย่างเดียวไม่เพียงพอสำหรับคำกล่าวอ้างของเรา |
| Sponsor prize เช่น AG Grid / APIMatic | optional เท่านั้น เลือกเมื่อช่วย product จริง; ไม่เพิ่ม dependency หรือย้าย hosting เพื่อหวังรางวัลอย่างเดียว |

การเลือกเป้าเป็นกลยุทธ์ของทีม ไม่ใช่ official tracks หรือการรับรองโอกาสชนะ หนึ่งโครงการชนะได้สูงสุด **Grand Prize หนึ่ง + Sponsor Prize หนึ่ง หรือ Honorable Mention หนึ่ง + Sponsor Prize หนึ่ง** ไม่สะสม Grand และ Honorable เข้าด้วยกัน [Rules §8](https://paypalaihackathon.devpost.com/rules) ตัวเลขเงินรางวัลรวมบน overview มีหลายรูปแบบ จึงใช้จำนวนรายรางวัลในกติกาแทนยอดรวมเพื่อวางแผน

## สิทธิ์ การเปิดเผย และส่งผลงาน

ต้องเป็นงานที่ทีมมีสิทธิ์ ใช้ OSS/SDK/assets ตาม license และเปิดเผยฐานเดิม สิทธิ์ใน project ยังเป็นของผู้พัฒนา แต่มี license สำหรับ judging และสิทธิ์ประชาสัมพันธ์ตาม §7/§10 รวมถึงชื่อ ภาพ และเสียง ตรวจสิทธิ์คนในคลิป เพลง ภาพร้าน และแบรนด์ก่อนส่ง ไม่ถือว่า root Apache-2.0 ครอบคลุมทุก artwork

การส่งถือเป็นการยอมรับกติกา รวมข้อ release/liability/dispute/ข้อมูลส่วนบุคคลและ [Devpost Terms](https://info.devpost.com/terms) ที่อ้างรวมในกติกา ผู้ชนะต้องยืนยันตัวตน/คุณสมบัติและส่งเอกสารที่ขอภายใน 10 วันทำการ พร้อมรับผิดชอบภาษี/ค่ารับเงินที่เกี่ยวข้อง [Rules §8–15](https://paypalaihackathon.devpost.com/rules)

เก็บ sandbox client secret, AI keys, database keys และรหัสบัญชีส่วนตัวนอก repo แม้กติกาจะขอ access สำหรับทดสอบ ให้ใช้บัญชี evaluator ที่จำกัดสิทธิ์และช่องทางรับข้อมูลเฉพาะกรรมการ หรือ BYO sandbox พร้อมขั้นตอนครบ แทนการเผยแพร่ secret ใน README ต้องลอง fresh setup จริงก่อนเลือกวิธีนี้เป็นเส้นทางส่ง
