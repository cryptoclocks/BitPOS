# Coupon/commerce pricing —096 implementation checkpoint

## Implemented

`packages/domain/src/coupon-pricing.ts` และ restricted SQL `096_coupon_pricing.sql` คำนวณ FIXED/BASIS_POINTS ด้วยจำนวนเต็ม floor/cap/minimum แยกเงินที่ร้าน/platformรับผิดชอบตามสูตรเดิมของ commerce072 draft และกระจายส่วนลดบน line TOTAL ด้วย largest remainder/ASCII tie-break ไม่แก้ราคาต่อหน่วยหรือ qty ของ canonical stock/options

`packages/domain/src/commerce-pricing.ts` และ SQL coupon096_commerce รวมอาหารหลังคูปอง, ค่าส่ง/บริการ, ภาษีตาม versioned policy และทิปที่จำกัดด้วยยอด/อัตรา ตรวจ fee allocationและ receivables รวมทุกminor unit ส่วน platform contribution เป็นแหล่งทุนที่ต้องยืนยันเพิ่มเติม ไม่ใช่หลักฐานว่ามีเงินแล้ว ภาษี/ค่าธรรมเนียม/ทิปจะไม่เปิดใช้ด้วย helperนี้ลำพัง

ขอบเขต amountตรง configured-foodปัจจุบัน:0..999999999999999999 minor units ใช้ USD2/4,USDG6,THB2ตาม denomination ที่ระบบมีอยู่ ไม่ได้เปิดasset/chainใหม่ ทั้งสองengineแสดง zero payableได้โดย requiresPayment=false ไม่ได้สร้างpaid statusหรือเรียกprovider

หลักฐาน: coupon096-pricing-direct-20261019.json —59coupon parity cases +20commerce parity cases, actual restricted-role execute denied, invalid/overflow/duplicate/funding inputs rejected, DDLทั้งหมดrollback. Node pricing tests9PASS และ TypeScriptตรวจแยกในcheckpoint

096ยังไม่ติดตั้งลงlocal/actual-useและไม่ให้ app execute primitiveโดยตรง ไม่มีcampaign/reservation/quoteถูกสร้างจากงานชุดนี้ ไม่มีการปรับยอดcheckoutหรือประกาศว่าคูปองพร้อมใช้

## Exact integration work still required

1. Port versioned campaign/global-account quota/funding reservationจาก draft commerce072/077 ให้เข้ากับ runtimeปัจจุบัน เก็บ full scopeของguest/membership/parent checkoutไว้ด้วย อย่า execute activate-runtime.NOT-EXECUTED.sql แบบรวดเดียว เพราะ draftมี38replacementและอ้าง predecessorเก่า
2. ทำ replacement quoteจาก canonical original quote ห้ามแก้ frozen original: `catalog.captureQuote`, `configured-food.validateConfiguredQuote`, SQL057/060 configured/delivery/order guards ต้องยืนยัน food/coupon/tax/tip/fee/settlement snapshotและrequest hashชุดเดียวกัน Existingconfigured snapshotยังไม่รองรับ coupon adjustment การลดเฉพาะclienttotalหรือหารส่วนลดเข้าunitpriceเป็นทางลัดที่ผิด
3. Hold quota/fundingผูก owner/quote/version/lease; create order/verified payment/expired unpaid/ambiguous post-bill/late receipt/refund ต้องมี transitionและreconciliationครบ ห้ามคืนquotaในขณะที่เงินยังอาจสำเร็จ
4. Persist per-line discount/funding/tax/tip allocationsในorderเพื่อ partial refundและworker restart ห้ามเชื่อว่าการคำนวณ platform subsidyเท่ากับ budget reservationที่มีfundingจริง Zero-orderต้องมี authorized completion pathของตัวเอง ไม่ส่ง settlement(0)เข้าpositive-payment path
5. เพิ่ม typed commerce quote/command contracts และ durable customer command recovery; coupon/cart/UIต้องแสดงผลจาก replacement quoteที่ยืนยันแล้ว POS campaign configใช้server roleและขอบเขตร้าน; platform-funded campaignต้องผ่านfunding authorityที่แยกจากmerchant configuration ไม่ใช่สิทธิ์ใช้เงินจริงเพิ่มจากงานนี้
6. Joined SQL concurrency/HTTP/AVD/POS+Pay Desktop-Mobile acceptance และ source-bound independent review; full192screen fidelityและfullP3-P6ยังไม่ปิด Physical testsยัง deferred_by_user_2026-10-16

## Source seams already inspected

- `catalog.ts` lines/configuration→settlement→request hash→immutable order_quotes
- `configured-food.ts` reconstructs current configured snapshot and compares full document
- SQL057 expected_configured_food/assert_configured_quote/guard_configured_order_complete enforce totals
- SQL060/063 delivery snapshots and custody-ledger boundaries
- draft commerce072/quote.sql, quota.sql and commerce077 root protocol establish original/replacement identities, reservation lifetime and late-payment compensation; bounded historicalreview is not current runtime admission

##097 internal holds implemented

`097_coupon_holds.sql` เพิ่ม campaign/version แบบ immutable, quotaรวม/ต่อบัญชี/งบส่วนลด, exact source quote binding, command journal, HELD→RELEASED/EXPIRED/RECONCILE และ bounded expiry primitive มี root lockที่ policy version, บังคับ READ COMMITTED และตรวจ canonical configured quote ผ่าน SQLguardเดิมก่อนรับ hold สูตรส่วนลดมาจาก096และsource line totalsเท่านั้น

Merchant-funded10000bpsใช้งบส่วนลดที่กำหนดไว้ (รายรับที่ร้านยอมลด ไม่ใช่การโอนเงิน) Platform-funded versionยังถูกปฏิเสธ COUPON_PLATFORM_FUNDING_REQUIRED จนกว่า actual funding adapterจะเสร็จ ไม่ลด scopeส่วนplatformfundingออก

Replayใช้ account/command hashและคืน holdสถานะปัจจุบัน ไม่สร้าง/ต่ออายุสิทธิ์ใหม่ โควต้าจาก RELEASED/EXPIREDกลับมาได้ แต่ source quoteเดิมไม่ถูกนำกลับมาreserveซ้ำ ภายหลังมี billต้อง RECONCILE แทนการคืนโควต้า สถานะนี้ยังต้องเชื่อม discounted replacement quote/order/payment/refund ใหม่ให้ครบก่อน admission

097ยังไม่มี public/app execute grants, receiptระบุcheckoutReady=false และยังไม่ได้ติดตั้งที่fixtureDBต้นฉบับหรือactual-use ไม่มีAPI/UIคูปองที่เปิดใช้จาก primitiveนี้

หลักฐาน:
- coupon097-holds-direct-20261019.json: actualSQLrollback owner/foreignaccount/global/account/budget/replay/release/expiry/immutable/revoke; fresh testquoteผ่าน deferred configured guards
- coupon097-concurrency-direct-20261019.json: committed disposable clone,12-wayแย่งเพดานglobal/account/budgetได้1winnerต่อกรณี,12samecommandได้1hold/1command, committedreleaseเปิดให้ผู้จองรายใหม่ได้1ราย,2expiry workersเปลี่ยนสถานะครั้งเดียว,REPEATABLE READถูกปฏิเสธ, cloneลบแล้ว=true และมีSQLsourcehash

ใช้ `python3 tools/runtime/coupon097-clone-probe.py` สำหรับ isolatedconcurrency; Node runnerรับเฉพาะชื่อbitpos_coupon_probe_<12hex> ไม่ยอมใช้fixtureDBต้นฉบับ การทดสอบไม่แตะfunds/provider/production และไม่มีOMP writerใหม่

##098 replacement quote evidence and candidate adapter —2026-10-20

เพิ่ม `098_coupon_quotes.sql`: สร้าง canonical order_quotesใบใหม่และ configured snapshotที่สะท้อนส่วนลด/ยอดชำระจริง พร้อม immutable source/hold/command mapping; ไม่แก้ original quote/cart/qty/options/authority/quotedAt และไม่ต่อlease เก็บrequest hash namespaceที่ผูก source request,hold/version/pricing/lease คัดลอกdeliveryและpromotion evidenceที่เกี่ยวข้อง และปรับ USDG atomsจาก denominationเดิมอย่างถูกต้อง

060 legacy configured validatorถูกคัดลอกแบบตรงตัวเปลี่ยนเฉพาะชื่อให้ wrapperเรียก Non-coupon pathยังใช้ checksเดิม; existing triggersเรียก wrapperเดิมผ่านOID ส่วนcoupon flagต้องมีprivate metadataที่ตรงกัน โครงสร้างปลอมที่มีราคา/settlementดูถูกต้องแต่ขาดbindingถูกปฏิเสธ

แยก `coupon098_assert_snapshot` (หลักฐานประวัติ immutable ไม่เช็กactive options pointerในวันนี้ซ้ำ) กับ `coupon098_validate_live` (current authenticated owner/tenant, HELDlease, current price revision/treasury/branch/option checks) เปลี่ยนoptions/price revisionแล้วประวัติยังตรวจได้ แต่liveไม่ผ่าน หลังreleaseก็อ่านประวัติได้แต่ใช้ต่อไม่ได้

`apps/api/src/coupon-quote-candidate.ts` เป็น internal Node adapterที่ทดสอบกับPostgresจริง รับmerchant transaction contextที่ถูกต้องและตรวจreference/row/settlementreceipt ไม่ได้ลงทะเบียน public routeและไม่ได้สร้างpayment

หลักฐาน:
- coupon098-quotes-direct-20261020.json: rollback pickup+delivery quotes, amount/atoms/snapshot/unchanged original/fee-party-address preservation, staleoptions/pricing, private metadata, role/RLS and tenant checks; actual order_authority insertionถูกปฏิเสธด้วยCOUPON_CHECKOUT_NOT_ADMITTED
- coupon098-concurrency-direct-20261020.json: committed disposable clone ผ่านactualNodeadapter,12samecommandได้1quote/1command,12distinctcommandแย่งsourceเดียวมี1winner, parent097quota regressionsผ่านด้วย, cloneลบแล้ว=true มีhashของ096/097/098,adapterและrunner

096–098ยังไม่ติดตั้งที่fixtureDBต้นฉบับหรือactual-use ไม่มีcoupon API/UIเปิดใช้; `checkoutReady=false` และ explicit bill triggerยังปิดการสร้างบิลcouponไว้จน order/payment/closure/refund lifecycleครบ ไม่ใช่หลักฐานfull checkout/E2E รวมzero-payable ordersยังต้องauthorized completionแยก และhistorical scoped/daily/personal promotion sidecarsยังต้องbehavioraljoinedproof
