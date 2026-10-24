# ส่งอาหารไม่ได้ → คืนอาหาร → ปิดเคส

สถานะ21ตุลาคม2026: implementationกำลังทำ; ไม่ใช่ฟีเจอร์ที่เปิดใช้ครบแล้ว. OMPหยุด/Codexทำเอง.

## ที่มีและตรวจแล้ว

1. ไรเดอร์หลังรับอาหารใช้ Cannot deliver → requiredreason → existing durableCUSTODYreport. ActualAVD/API/SQLผ่าน: pausework/retaincustody,ไม่คืนเงิน/ไม่ยืนยันส่งสำเร็จ.
2. Privatecandidate108เพิ่ม immutable returncase ที่dispatcher/administratorมีscopeร้านร้องขอได้ เฉพาะactivepostpickupassignmentที่มีblockingincident. CAS/generation/leasefencesและaccountcommandjournalกันซ้ำ. เก็บactor/session/grant/reason/timeฝั่งserver; eventสาธารณะไม่ใส่private reason.
3. ร้านowner/managerยืนยันรับคืนผ่านlive merchant session+currentmembership;เก็บSEALED/OPENED/DAMAGEDและเหตุผล. Wrongtenant/role/session, revokedstaff/sessionแม้exactreplayถูกปฏิเสธ. Request/receipt historyแก้หรือลบไม่ได้.

ActualfullschemaSQL rollbacktestผ่านโดยใช้actualauth/rootlock/helpersบนnamedlocalfixture ไม่ใช้authdoubles. Source108และfixtureactors/DDL/DMLทั้งหมดrollback ไม่มีcandidateติดตั้งค้าง ไม่มีapp/publicgrants/API/UIสำหรับขั้นคืนอาหาร. Receipt: w02-return108-rollback-20261021.json.

## ขอบเขตที่ยังต้อง implement ก่อนเปิดใช้

- Candidate108 เชื่อม blocking-duty/resume gate แล้วใน private schema: original resume OID/grants คงเดิม, delegateเดิมถูกคัดลอกแบบตรงตัวและปิดapp access, source definitionต้องตรง SHAที่reviewแล้ว. เมื่อมีreturncase คำสั่งresumeทั่วไปถูกปฏิเสธทั้งก่อน/หลังร้านรับคืน. ยังไม่admitลงruntime/actual-use.
- Role-specificAPI/DTO/SDK และ durable journal สำหรับplatformrequest/merchantreceive;หน้าสั่งคืน/รับคืน/POSกับrider/customertimeline.
- Verify merchant receipt against exactcase/assignment and current duty; typed explicitattestation ไม่อ้างphysicalproofจากคลิกทดสอบ.
- Private operational resolution implemented: after merchant receipt and ACK of all blockers, scoped staff resolves RETURNED assignment/RELEASED lease/FAILED shipment and immutable RETURNED_TO_MERCHANT incident history. Exact replay once and graph constraints verified. Pending public API/SDK/UI and admission; REQUEST/RECEIVE receipts alone never release custody.
- Separate financialdecision/reconciliation: canonicalperline/fee/tax/subsidyrefundallocations,late/duplicatepayment,drivercompensationpolicy,merchant/platformreceivablesและdurableoutbox. ไม่สร้างrefundsuccessจากoperatorclick.
- ไม่คืนอาหารที่รับกลับเข้าsellablestockอัตโนมัติ; inventorydispositionต้องแยกตามสิทธิ์/เหตุผล.
- Admissionหลังactualschema/concurrency/HTTP/native/POS+Payreview;real-devicefieldtestsยังdeferredตามผู้ใช้.

108receiptจงใจระบุcustodyReleased=falseและfinancialResolutionReady=falseทั้งREQUEST/RECEIVE. มันเป็นหลักฐานขั้นรับคืน ไม่ใช่terminalFAILED/refundcompletion และยังไม่ผ่านadmission. W02ยังเปิดจนปิด workflowและcurrentjourneysครบ.

## วิธีตรวจซ้ำ

หลังW01fixtureพร้อมและมีcurrentpostpickupCUSTODYfixtureจากnativeflow:

```sh
pnpm exec tsx tools/runtime/food-return108-sql-smoke.ts
pnpm fixture:doctor
```

คำสั่งแรกtransactionrollbackเสมอ ตรวจauthority/replay/revocation/immutability/privateeventและunchangedmoney/custody. คำสั่งหลังยังต้องเห็น102appliedruntimeและ5candidateแยกไว้ ไม่ติดตั้ง108เข้าสู่actual-use.

Current private Node adapters: apps/api/src/food-return-candidate.ts ตรวจstrictrequest/receipt,UUID/positiveint64version,merchantSessionHash,exactreceiptidentityและliteralfalse custody/financialadmission. Errorboundaryใช้existingtypedcodesพร้อมreasonCode;ยังไม่มีHTTPregistration/OpenAPI/FlutterSDKroute. Fullschema rollbackผ่านactualadapters+authoritynegatives;raceบนprivateclonesผ่านrequest-firstและresume-first(2rootcontendersแต่ละกรณี),clones/dumpลบแล้ว. Resume-firstต้องใช้driverที่verifiedจริงในclone; originalfixtureaccountที่cleanupdisabledไม่ถูกปลุกในsource.


## Current operational closure and read models

`food_return108_resolve` requires live scoped management, canonical version, merchant receipt, unchanged picked-up assignment/generations/active lease and every unresolved blocker acknowledged. It emits one return resolution and one durable immutable financial-review item containing canonical original quote/currency/precision/total; no discount/refund/earning amount is invented. Paid bill and COLLECTED kitchen stay unchanged; returned food is not automatically resold/restocked. New deferred graph ties closed-at, resolution time, lease and FAILED shipment. Existing immutable assignment predicate widened only for RETURNED using pinned original definition; later earning insertion for RETURNED is refused.

Private Node `readFoodReturnCandidate` serves current staff or live owner/manager merchant snapshot without private reasons. State is REQUESTED/RECORDED/RESOLVED and financialReview PENDING only after operational closure; this is not financial execution. Public command routes still absent.

Additive OpenAPI/generated TS/Dart support RETURNED history and RETURNED_TO_MERCHANT incident resolution. Rider history and incident history and platform incident labels distinguish return from delivery and same-custody resume. Existing API route inventory is unchanged. Strict generated schemas parse actual SQL customerFAILED/CLOSED, driverRETURNED history and staff review. Focused Rider history/incident/realtime30tests PASS; scoped analyzer0errors/warnings with17existingbraceinfos.

Actual committed two-contender resolution on a private complete-schema clone gives identical receipts and exactly1resolution/1financialreview/1event/0refunds/earnings. Both request-vs-resume orderings retained. Clones/dump removed; fullschema rollback suite also checks all deferred constraints, terminal history immutability, earning refusal, unchanged stock and canonicalreviewfacts. No candidate remains installed in sourcefixture/actual-use.

Still required: public typed command/read contracts and role routes, durable client journal and POS/platform/Rider/customer UI join, migration admission review, canonical financial decision/refund/driver compensation execution/reconciliation, exact UI acceptance. No new physical tests required by this work; user-deferred remains.

## Gated API source and generated DTOs

Added current strict request/receive/resolve commands, stage/resolution receipts and safe snapshot models to OpenAPI→TypeScript/Dart. Added platform `/api/mobile/v1/platform/food/assignments/:id/return` GET/POST and `/api/mobile/v1/platform/food/returns/:case/resolve` POST; merchant `/api/food/assignments/:id/return` GET and `/api/food/returns/:case/receive` POST. Handlers use existing mobile principal/bearer hash/dispatch transaction and tenant-authenticated merchant session; candidate SQL rechecks scoped roles and current CAS. All require explicit `BITPOS_FOOD_RETURNS_ENABLED=1`, default off; normal fixture does not admit108 or app grants. Merely setting the switch is not sufficient schema admission.

Actual API3046 default-off check passed 401 unauthenticated,503 authenticated disabled,405 invalidmethod,422 unexpectedquery. Strictcontract2tests reject extra monetary fields and any resolution receipt claiming transferredmoney/restockedfood. CandidateSQLrollback remainsPASS. EnabledHTTPsuccess, privateclonegrant/admission proof, OpenAPIoperation paths/SDKmethods, durableUIjournal and role-specificscreens remain required; this is not a claim the live return flow is ready.


## Enabled HTTP integration on isolated clone —21 October2026

`pnpm exec tsx tools/runtime/food-return108-http-smoke.ts` creates one regex-named local clone from the already-synthetic W01 fixture, installs108 and grants only four entry functions to bitpos_app inside that clone. A dedicated actual API3048 process uses explicit enabled admission and clone-only configuration; original API3046/database remain untouched and unadmitted.

Actual HTTP checks PASS: authenticated scoped staff snapshot/request; unauth401/foreignactor403/invalidmethod405/query422;4exactrequests→1case; merchantowner receive twice→1receipt/staffmerchant403; resolvebeforeACK409; real incidentACK endpoint then2exactresolve→1resolution; revokingstaffgrantdeniesexactretry403. MerchantcurrentreadreportsRETURN_RESOLVED withoutprivate reason. SQL RETURNED/RELEASED/FAILED with1case/receipt/resolution/review and0refunds/earnings. Allmoneyfactsfixture-only. Dedicated APIprocessstopped, clone/dumpremoved; independently verified0cloneDBs/0API3048listeners/sourcecandidateabsent. Receipt w02-return108-enabled-http-20261021.json.

OpenAPI platformoperations nowdocument currentdefault-off routes/admission metadata. GeneratedDTOs unchangedbyoperationpublication; TypeScriptandstrictcontract2testsPASS. Browser/Flutterrole-specificreturnUI,durableclientjournal,merchantoperationdocumentation/SDKandfinancialdecision/executionremainopen. PassingAPIintegrationdoesnotadmit108tolocalmainfixtureoractual-use.

## Financial decision candidate109 —21 October2026

109_food_return_financial_decisions.sql is a private candidate dependent on108. It records one immutable FULL_REFUND or NO_REFUND decision after operational closure. Live scoped administrator authority is mandatory (dispatcher alone denied); exact idempotency replay rechecks authority before returning, and canonical shipment version is checked for new commands. FULL_REFUND allocations copy every existing verified-payment amount, asset descriptor, settlement and payer; no client amount/currency/beneficiary input. Payment identity unique, canonical allocation trigger and immutable records prevent divergent/repeated allocations. Existing refund obligations or missing payment provenance require reconciliation rather than duplication. NO_REFUND creates no allocations. Both outcomes record fundsTransferred=false,stockRestored=false. There is no transfer/provider execution, financial ledger posting, partial-refund decision or driver compensation implementation in109 yet; all remain required work. Late/second-payment reconciliation remains open and decisions do not claim future payments resolved.

App grants and RLS table access remain closed. No HTTP/UI/SDK admission yet. Test: pnpm exec tsx tools/runtime/food-return108-sql-smoke.ts --finance installs108+109 only inside a rolled-back full-schema transaction; checks operational prerequisites, role/tenant/session gates, stale/client-money denial, NO_REFUND zeroallocation, FULL_REFUND exactpaymentfacts, replay/tamper/seconddecision/revocation/immutability, zero actual refunds. This is not concurrency/crash/provider proof. Candidate manifest now102runtime+6excluded candidates; doctor checks source/schema/generated contracts. Source W01 and actual-use contain neither108 nor109.

Financial109 now has safe administrator snapshot and strict default-off GET/POST `/api/mobile/v1/platform/food/returns/:caseId/financial-review`. Requires both return and finance flags plus reviewed108/109 grants; clone-only test `pnpm exec tsx tools/runtime/food-return108-http-smoke.ts --finance` proves actual API authority/replay/concurrent exact decisions/revocation. Generated original catalogTotal labels quote value, not settlement/refund amount. No admin UI or money execution is established by this milestone.

Candidate110 adds private durable attempt journal and immutable binding/observations. Test `pnpm exec tsx tools/runtime/food-return108-sql-smoke.ts --finance --journal` exercises restricted session-user role and CAS/byte invariants inside rollback. It intentionally reports fundingAvailable=false. A funding_verification_hash row alone is not verified liquidity/exclusive reservation. No submission/finalization grants/lane exist until funding verification, SQL repository, crypto attestation, receipts/ledger and concurrency/restart proof are implemented. Candidate manifest now102runtime+7excluded.

Candidate111 introduces global deposit identity across existing088 payout funding and refund credits, policies defaultOFF, private canonical credit recording and exclusive HELD reservations into110attempts. No caller-supplied amount on reserve; derive109allocation, lock credit and enforce totalclaims<=verifiedcredit. Same deposit cannot enter both pools. Actual recorder still must use read-only inbound provider verifier; SQL receives attestation from restricted role and does not independently query chain. Fee funding, submit, receipt/ledger and release/reconcile remain unadmitted. Rollback test: `pnpm exec tsx tools/runtime/food-return108-sql-smoke.ts --finance --journal --wallet-journal --funding`. This proves sequential SQL authority/identity, not committed race/restart or real funds.102runtime+8candidates.

Internal `createFoodRefundFunding` now binds reviewed policy and actual assetregistry to read-only inbound verifier before calling111record; no clientverified flag or key loader. Lookup/recovery keyed by policy+signature validates credit/proofdigest/amount and avoids repeatRPC; reserve takes only canonical IDs. Tests inject lost SQLresult inside rollback transaction; committed crash/restart is not yet proved. No runtime entry/grants configured; fee/submit/finalreceipt/ledger remain required.

Candidate112 records token-denominated inbound custody liability, approval, reserve and finalized transfer as atomic balanced ledger pairs. It only accepts provider-verified matching finalized evidence; exact outcome replay cannot duplicate posting. Contradictory outcomes are immutable evidence + quarantine; failure never automatically releases funds or authorizes replacement. Node store must explicitly opt into receipts112 mode; default remains unadmitted, submission still refuses. SQL test command adds `--ledger` to finance/journal/wallet-journal/funding. Signed offline RPC fixture is not live chain proof, SQL suite still rollback rather than committed crash/concurrency. Fee/submission and public executed/disputed reads remain required.
