# ขอบเขตหลักฐานประวัติไรเดอร์ที่ยังเปิด

- API local SQL/HTTP ใช้ existing closed assignment ของแต่ละ driver จำนวนน้อย ยังไม่พิสูจน์31รายการ/driver หรือ load/index plan ขนาดจริง ต้องทำ disposable clone lifecycle fixture ที่ผ่านข้อบังคับเดิม ห้าม disable trigger เพื่อให้ผ่าน
- AVDรอบแรก11170ไม่พบ labelรายการ แม้ preflight APIมีข้อมูล;ไม่มีภาพหรือการเปลี่ยนงานใดเกิดขึ้น และ finallyเพิกถอน fresh sessionแล้ว
- รอบวินิจฉัย85422ผ่านโดยเพิ่มเฉพาะข้อความแสดง labelในintegration runner ไม่เปลี่ยน auth/data admission จึงยังไม่อ้างว่าแก้ root cause ของครั้งแรกแล้ว ต้องคงข้อสังเกต intermittent native loading/lifecycle และเพิ่มrepeated cold-start proofที่จำเป็นก่อนปิด acceptance
- หลักฐาน native ล่าสุด50144 ครอบคลุม root→history→earnings→account→workidle→history→logout พร้อม selected tabs; ไม่พิสูจน์ full R06/R15pixel, physicalGPS/custody หรือ data boundary31รายการ ดูreceiptล่าสุดไม่ใช้standaloneรอบเก่า
- ภาพ finalจำเป็น1ภาพเท่านั้น ไม่มีscratch ห้ามเรียก screenshotว่าส่งอาหาร/โอนเงินจริงสำเร็จ
- Full platform scopeคงเดิม: rider navigation/historydetail/filters/support/chat/safety, customerremainingpages, POS/Paydesktop/mobile, coupons/privacyexecution/scheduling/ridesและreview

Cold-root diagnostic2026-10-20: actualHTTPprofile200/TSschema and currentfixture Dartdecode pass. Warmed native11673help+SQLcase passed, but preflight invalidates cold claim. Candidate harness cause is pumpAndSettle running fake-clock timeout while realHTTP pending; new97573 removes BOTH profile/history preflight and uses finitepump/runAsync polling until actual rootprofile exists. Read terminal/receipt before closing diagnostic; no producttimeoutincrease or authorityrelaxation allowed. Product now separately prevents unknownprofile masqueradingasnewapplication (mountedregressionPASS).

Resolved diagnostic scope:97573passed no profile/historypreflight after finiteframe/runAsync readiness. Evidence supports harness fake-clock settle timeout interaction; no API/runtime timeoutchange. Receipt has coldRoot details. This closes need for blind warm/cold repeats; future failures require actual new evidence. Fullvisual/load/currentreview remainopen.
