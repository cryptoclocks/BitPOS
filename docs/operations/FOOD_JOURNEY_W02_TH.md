# W02 — current food journey acceptance

21 ตุลาคม2026; Codexทำเอง/OMPหยุด. ใช้W01named disposable bitpos_w01_fixture55446/API3046/auth55447. ไม่มีactual-usemigration/providerpayment/fieldtest.

## ชุด API/SQL ที่ทำซ้ำได้

หลังfixture:upและก่อนscenarioseedอื่น ใช้:

```sh
pnpm exec tsx tools/runtime/fixture/food-suite.ts
```

Suite8scenarios: pickup,delivery,pickup-before-withdrawal,withdrawal-before-pickup,cancellationreview-before/afterpickup,incident-afterpickup,withdrawalrecovery. Each createsisolatedsyntheticmerchant/customer/driver/role data; no reusedactualmerchant. StatementguardsตรวจconnectedDBname+loopbackserverportจริง. Side effectsจริงเป็นAPI/committedSQL; settlementเป็นexplicitSQLfixtureที่ใช้canonicalpaymentselection ไม่ใช่chainproviderproof.

Pickup: canonical270,clienttotalfieldrejected,8replays→1order,foreignmerchant404,unpaidkitchenrefusedทั้งก่อน/หลังacceptance,4acceptreplays→1receipt,settlesameattempttwice→1payment/stockeffect,concurrentkitchentransitionssingleeffect,customerPAID/COLLECTED,0shipment/0Mini notice. Last4availableunitsมี2ordersแย่ง→1winner; rejectionผ่านmerchantAPIปิดunpaidorder/releasereservationโดยstockยัง4.

Delivery: canonical390,concurrentorder/offer/claim,owntracking/locationdedup/generationguards,pickupsecretprivacy/wrongproofreplay,separatecustomerproof→DELIVERED/kitchenCOLLECTED/leaseRELEASED/exact100minorbalancedearning. ไม่ใช่payout.

Cancellationreview/incidentเป็นauthority+review/dispositionที่ไม่อ้างว่าcancel/refund/custodyexecutionจริง; receiptsระบุข้อจำกัดเดิมครบ. Raceทดสอบactual2HTTPrequestsที่รอrootlockและตรวจcommittedwinner/loser. Cleanupตรวจ0livegrants/0onlinedrivers/0livesessions; currentcohortsปิดสาขา/ลบsyntheticmerchantmembership/disableaccountsเพิ่มเติม. Retainimmutableorder/payment/ledger/audit.

Latestaggregate: evidence/w02-food-api-sql-suite-20261021.json; individualpickup-current-http-sql-20261021.json. Receiptsourcehashesต้องตรงsourceที่กำลังอ้าง.

## Current acceptance matrix

| Requirement | สถานะ |
|---|---|
| PickupAPI→accept→fixturepaid→kitchen→collected→SQL | PASScurrent |
| DeliveryAPI→offer/claim→pickup→deliveryproof→earningSQL | PASScurrent |
| Exactretry,foreignmerchant/customer,priceauthority,stockrace | PASSscopedcases |
| Pickupvswithdrawal2orderings | PASScurrent |
| Cancelreviewbefore/afterpickup,incidentafterpickup,recovery | PASSscopedauthority; actualrefund/cancelfulfillmentไม่ได้อ้าง |
| CurrentCustomer/Rider/POS/Pay UI joined flowทั้งเที่ยว | เปิด; currentCustomerdispatchprogressAVDผ่าน assigned→withdrawn→matching→manual; fullnativejourneyยังเปิด |
| No-driver/provider-unavailable→real60s deadline | PASScurrent: each3restrictedworkerprocesses, originalwindow/budget,0offers/assignments/earnings |
| Replacement delivery | PASScurrentHTTP/SQL: distinctsecondDriver→highergeneration→delivery→oneearning; olddrivercommands/proofsrefused |
| Delivery issue | DedicatedpostpickupRiderbutton/reportimplemented;CUSTODYreportpause/ACK/scopedresumeHTTP+SQLPASS. Terminalfailure/return/refunddecisionยังเปิด |
| Worker/API/PostgreSQL orderlyrestart | PASSscoped: restrictedworker3processes and committedpickup/deliveryrecords unchanged afteractualservice restart |
| Lostresponse/recovery | Pickupactualcommit→responseproxyabort→8exactretryPASS; fullmobilejournal/midtransactioncrashjourneysยังเปิด |
| Actualpaymentprovider/chainverification | แยกproviderconfig/financialacceptance; SQLfixtureไม่แทน |
| PhysicalGPS/fieldtest | deferredตามผู้ใช้;implementationยังต้องครบ |

W02ยังไม่ปิดทั้งชุด. W03–W18คงลำดับตามIMPLEMENTATION_WORK_PACKAGES_TH_20261021.md.

## Observation during continuation

พบW01controllerprocessไม่อยู่แล้วแต่DB/APIchildrenยังlive: ตรวจactualcommand/cwd/postmasterpathแล้วใช้existingAPIต่อ ไม่มีrestartเพราะstatusผิด. ปรับfixture:statusให้แสดงcontrollerแยกlistenersและorphanedServicesNeedOwnershipReview. ไม่resumeOMP/killhistoricalPIDs; ต้องจัดownedcontrollerrecoveryหลังinflightnativeเสร็จ. นี่เป็นlifecyclehardeningfollow-upของW01 ไม่ใช่เหตุให้หยุดW02หรือสร้างwriterซ้อน.

Nativeรอบล่าสุดPASSและภาพmatching/manualตรวจด้วยมือแล้ว: customerอ่านSSEจากAPI3046จริง,SQLassignment/leaseRELEASED,shipmentREADY_FOR_DISPATCH,searchMANUALv2,kitchenREADY,stock4,refund/earnings0. ภาพพบtechnicalenumและtimestampละเอียดเกินไปในprimaryUI; ต้องเก็บต่อในชุดUIโดยคงข้อมูลdiagnosticsเข้าถึงได้ ไม่ถือว่าผ่านpixelacceptance.

### Search boundary เพิ่มเติม

Suite source เพิ่ม `search-no-driver` และ `search-provider-unavailable` (รวม12scenarios ใน source ล่าสุด เมื่อรวม replacement-delivery และ delivery-issue-report). เลือกเฉพาะกรณีได้ด้วย `--only=search-no-driver,search-provider-unavailable`; selected aggregateใช้คนละชื่อจากfullsuite. ไม่อ้างว่าfull10ผ่านจากหลักฐาน8เดิม.

แต่ละกรณีใช้policy60วินาทีจริง,3restrictedworkerprocessesที่เริ่มและจบแยกกัน, no provider request และยืนยัน originalbudget/window, paidbill/kitchenREADY/refunds0/0offers/0assignments/0earnings. Storedshipmentstateอาจยังเป็นWAITING_MERCHANTจนสร้างoffer; เทียบstateกับbaselineและตรวจverifiedsale+actualpayment/kitchenแทนการสร้างREADYปลอม. ข้อบกพร่องด้านการนำstoredstateไปแสดงprimaryUIยังเปิด. Orderlyworkerrestartไม่ใช่midtransactioncrash/lostresponseproof.

CurrentW01orphanrecoveryสำเร็จแล้วหลังalltestsจบ: actualidentitypreflight→gracefulAPI+Postgresstop→detachedownedcontrollerup; statuscontroller/serviceshealthyและdoctorPASS schema102/hash/generatedcontracts. Restartreceipt w02-process-restart-20261021.json. No reset/businessdatadeletion. Lostresponsepickupรอบใหม่อยู่pickup-current-http-sql-20261021.jsonและselectedsuiteaggregate; priorfull8receiptยังเป็นprior8 ไม่ใช่currentfull10claim.

Replacementreceipt: w02-replacement-delivery-20261021.json. Reportreceipt: w02-delivery-issue-report-20261021.json. NewUIwidget/realtime24PASS; noerror/warninginchangedDart(19brace-styleinfos). Failed-deliveryรายงานให้staffช่วยไม่ใช่terminalFAILED/refund/returncompletion. Nativeevidenceบันทึกในcheckpointหลังrunnersจบจริง.

FinalnativeRiderdeliveryissuePASS: postpickuprealFoodWorkPagebutton→CUSTODYreport→restrictedretainedduty; persistedassignmentPICKED_UP/leaseACTIVE/kitchenCOLLECTED/blocksDutytrue/earnings0/refunds0. Receipt w02-delivery-issue-avd-20261021.json andonefinalreviewedPNG. ภาพมีdiagnosticIDsและรายละเอียดมากในrestrictedcardซึ่งยังต้องเก็บในUIbatch ไม่อ้างfullparity.

Return108evidencecandidateเพิ่มแล้วและผ่านfullschemaSQLrollback; no liveadmission/API/UI/custodyrelease/financialeffects. รายละเอียดและremainingterminalworkflowอยู่FOOD_FAILED_DELIVERY_RETURN_TH.md; W02ยังเปิด.

Return108 guard+privateNodeadaptersผ่านแล้ว: returncaseบล็อกresumeทั่วไป,originalfunctionOID/authoritydelegatepreserved;actual2contendersบนprivatecloneทั้ง2orderingsให้onewinnerและ0financeeffects. No livecandidateadmission;terminalcustody/finance/APIUIยังเปิด.

Return108 operationalclosure now implemented/testedprivately: receipt+allACK→RETURNED/leaseRELEASED/shipmentFAILED,immutablefinancialreviewPENDINGonly,0refund/earnings/restock. ActualcommittedconcurrentresolutiononceandstrictSQL→DTOhistoryprojectionsPASS. Riderhistory/incident/realtime30PASS; no publicreturnroute/admission/fullUIjourneyyet.

EnabledreturnHTTPonisolatedclonePASSrequest→merchantreceive→ACK→resolveplusrole/CAS/replaydenials. SourceW01stillcandidateabsent/default-off. RunbookFOOD_FAILED_DELIVERY_RETURN_TH.md;receiptw02-return108-enabled-http-20261021.json. FullUI/durablejournal/financialexecutionstillopen.

### Current full12 run —21 October2026

Fresh current-source `pnpm fixture:food` completed all12 named scenarios, including replacementdelivery/deliveryissue and two actual60s searchboundaries. Aggregate w02-food-api-sql-suite-20261021.json now12receiptchecks, cleanup0livegrants/0onlinedrivers/0livemobilesessions. Source/API doctor and existingauthrevoke checksPASS after ownedfixture restart (no reset). This supersedes earlier full8-only coverage statement for coreHTTP/SQL, not native/provider/fullW02acceptance. Returnfinancecandidate proofs are independent; keep original scopes/remainingwork.
