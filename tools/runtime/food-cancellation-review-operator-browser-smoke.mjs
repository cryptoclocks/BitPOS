import assert from 'node:assert/strict';
// Native tab helpers exercise real React inputs; no fetch/auth/domain substitution.
export async function verifyFoodCancellationReviewOperator(tab,fixture){
 const text=()=>tab.text('body'),button=label=>'role/button[name="'+label+'" exact]';
 let continuedAuthenticated=(await tab.count('input[pattern="[0-9a-fA-F-]{36}"]'))>0;
 if(!continuedAuthenticated){
  await tab.waitForSelector('input[type="tel"]');if((await text()).includes('ขอ OTP'))await tab.click(button('English'));
  await tab.fill('input[type="tel"]',fixture.phone);await tab.click(button('Request OTP'));await tab.waitForSelector('input[autocomplete="one-time-code"]');await tab.fill('input[autocomplete="one-time-code"]',fixture.otp);await tab.click(button('Verify OTP'));await tab.waitForSelector('input[pattern="[0-9a-fA-F-]{36}"]');
 }
 assert(!(await text()).includes('Original command unresolved'),'Recover existing pending command first');
 await tab.fill('input[pattern="[0-9a-fA-F-]{36}"]',fixture.merchantId);await tab.click(button('Load latest reviews'));await tab.waitForSelector('button.platform-driver');await tab.click('button.platform-driver');await tab.waitForSelector('textarea');
 assert((await text()).includes('AT_PICKUP'));assert(!(await text()).includes('Synthetic PRIVATE customer cancellation-review detail'));
 await tab.fill('input[maxlength="500"]','Synthetic native-helper browser audited review investigation');await tab.click(button('Inspect private detail with access audit'));await tab.waitForSelector('aside');assert((await tab.text('aside')).includes('Synthetic PRIVATE customer cancellation-review detail'));
 const privatePersisted=await tab.evaluate(()=>Object.values(localStorage).some(value=>value.includes('Synthetic PRIVATE customer cancellation-review detail')));assert.equal(privatePersisted,false);
 await tab.fill('textarea','Synthetic browser review requires further compensation investigation; active order and custody unchanged, no refund sent.');await tab.click(button('Record review disposition only'));await tab.waitForText('Review disposition recorded. No order cancellation, refund, stock return or custody release.');await tab.waitForText('COMPENSATION_REVIEW_REQUIRED');
 assert((await text()).includes('AT_PICKUP'));assert.equal(await tab.count('aside'),0);assert.equal(await tab.count('textarea'),0);
 return {status:'PASS_ACTUAL_COMPILED_OPERATOR_CANCELLATION_REVIEW_BROWSER',reviewId:fixture.reviewId,assignmentId:fixture.assignmentId,continuedAuthenticated,scopedQueue:true,auditedPrivateInspection:true,privateDetailNeverPersisted:true,dispositionSeparateFromOrderCancellationRefund:true,fixture:'Current compiled4383 proxy→API3016→disposable55436; synthetic OTP/payment/review only. Actual native tab helper input/click, no auth/domain fetch response substitution.',limits:['Genuine OS background/window privacy proof not exercised','Persisted counterpart and screenshot require separate receipt','No refund/order cancellation/stock return/custody execution or physical testing'],physicalTesting:'deferred_by_user_2026-10-16'};
}
