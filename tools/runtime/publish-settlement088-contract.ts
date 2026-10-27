import {readFile,writeFile} from 'node:fs/promises';
const path='packages/openapi/mobile-v1.json',spec=JSON.parse(await readFile(path,'utf8'));
const uuid={type:'string',format:'uuid'},version={type:'string',pattern:'^[1-9][0-9]{0,18}$'},time={type:'string',format:'date-time'},nil={type:'null'},falseValue={type:'boolean',enum:[false]},bool={type:'boolean'},key={type:'string',pattern:'^[1-9A-HJ-NP-Za-km-z]{32,44}$'},reason={type:'string',minLength:1,maxLength:1000};
const str=(...values:string[])=>({type:'string',enum:values}),integer=(...values:number[])=>({type:'integer',enum:values}),object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties}),ref=(name:string)=>({$ref:'#/components/schemas/Settlement'+name}),nullable=(field:unknown)=>({anyOf:[field,nil]}),array=(items:unknown,minItems=0,maxItems=50)=>({type:'array',items,minItems,maxItems});
const union=(key:string,...names:string[])=>({oneOf:names.map(ref),discriminator:{propertyName:key}}),money={$ref:'#/components/schemas/MobileMoney'};
const asset=object({assetId:str('usdg-devnet','usdc-devnet','usdt-test-devnet'),symbol:str('USDG','USDC','USDT'),displayLabel:{type:'string',minLength:1,maxLength:96},cluster:str('devnet'),genesisHash:str('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'),mint:key,tokenProgram:key,decimals:integer(6),instructionPolicy:str('spl_checked','token2022_zero_fee'),issuerTestAsset:bool});
const batchState=str('DRAFT','RESERVED','SIGNING','PREPARED','SUBMITTED','UNKNOWN','CONFIRMED','FAILED','CANCELLED'),attemptState=str('SIGNING','PREPARED','SUBMITTED','UNKNOWN','CONFIRMED','FAILED'),ids=array(uuid,1),versions=array(version,1),draftBase={batchId:uuid,version,beneficiaryId:uuid,beneficiaryVersion:version,sourceIds:ids,sourceVersions:versions,money,payoutMoney:money,asset:ref('Asset'),outwardReady:falseValue,fundsTransferred:falseValue},command={idempotencyKey:uuid,expectedVersion:version};
Object.assign(spec.components.schemas,{
 SettlementAsset:asset,
 SettlementOwnershipChallenge:object({version:integer(1),domain:str('bitpos.driver-settlement.v1'),tenantId:uuid,accountId:uuid,deviceId:uuid,enrollmentId:uuid,challengeId:uuid,nonce:{type:'string',pattern:'^[a-f0-9]{64}$'},destinationOwner:key,genesisHash:str('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'),issuedAt:time,expiresAt:time}),
 SettlementEligibilitySummary:object({decision:str('RELEASE','HOLD'),decidedAt:time}),
 SettlementPayoutAvailable:object({status:str('FROZEN_POLICY_AVAILABLE'),payoutMoney:money,asset:ref('Asset')}),
 SettlementPayoutZero:object({status:str('ZERO_EARNING'),payoutMoney:nil,asset:nil}),
 SettlementPayoutSetupRequired:object({status:str('SETUP_REQUIRED'),reasonCode:str('SETUP_REQUIRED_ORIGINAL_RECEIPT','SETUP_REQUIRED_ORIGINAL_ASSET','SETUP_REQUIRED_FROZEN_DENOMINATION','SETUP_REQUIRED_FROZEN_POLICY','SETUP_REQUIRED_ORIGINAL_AMOUNT','SETUP_REQUIRED_POLICY_RECEIPT_MISMATCH','SETUP_REQUIRED_NONDIVISIBLE_PAYOUT','SETUP_REQUIRED_PAYOUT_AMOUNT'),payoutMoney:nil,asset:nil}),
 SettlementPayoutProjection:union('status','PayoutAvailable','PayoutZero','PayoutSetupRequired'),
 SettlementSummary:object({batchId:uuid,state:batchState,version,beneficiaryId:uuid,beneficiaryVersion:version,attemptState:nullable(attemptState),receiptId:nullable(uuid),confirmedAt:nullable(time),money,payoutMoney:money,asset:ref('Asset'),readiness:str('CLOSED','BENEFICIARY_PENDING','PROVIDER_UNAVAILABLE','AWAITING_APPROVAL','VERIFIED_FUNDING_REQUIRED','FUNDING_RECONCILIATION_REQUIRED','SOURCE_RECONCILIATION_REQUIRED','AWAITING_SIGNATURE','READY_FOR_INITIAL_BROADCAST','EXACT_REBROADCAST_OR_RECONCILIATION_ONLY'),outwardReady:bool}),
 SettlementEarningItem:object({accrualId:uuid,driverId:uuid,merchantId:uuid,orderId:uuid,assignmentId:uuid,state:str('ACCRUED','HELD','AVAILABLE','RESERVED','SETTLED','REVERSED'),version,availableAt:time,createdAt:time,money,payout:ref('PayoutProjection'),eligibilityDecision:nullable(ref('EligibilitySummary')),settlement:nullable(ref('Summary'))}),
 SettlementBeneficiarySummary:object({beneficiaryId:uuid,merchantId:uuid,provider:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,39}$'},state:str('PENDING','VERIFIED','SUSPENDED'),version,challenge:nullable(ref('OwnershipChallenge'))}),
 SettlementDriverPage:object({kind:str('DRIVER_EARNINGS'),driverId:uuid,items:array(ref('EarningItem')),nextAfterId:nullable(uuid),beneficiaries:array(ref('BeneficiarySummary')),beneficiaryHistoryLimit:integer(50),snapshotAt:time,availabilityIsLiquidity:falseValue}),
 SettlementFinancePage:object({kind:str('FINANCE_EARNINGS'),merchantId:uuid,items:array(ref('EarningItem')),nextAfterId:nullable(uuid),snapshotAt:time,availabilityIsLiquidity:falseValue}),
 SettlementEligibilityCommand:object({...command,decision:str('RELEASE','HOLD'),reason}),
 SettlementEnrollCommand:object({idempotencyKey:uuid,expectedVersion:str('0'),merchantId:uuid,provider:str('solana-devnet'),publicKey:key}),
 SettlementPrepareCommand:object({idempotencyKey:uuid,expectedVersion:str('0'),merchantId:uuid,driverId:uuid,beneficiaryId:uuid,beneficiaryVersion:version,sourceIds:ids,sourceVersions:versions}),
 SettlementApproveCommand:object({kind:str('APPROVE_RESERVE'),...command,beneficiaryId:uuid,beneficiaryVersion:version,sourceIds:ids,sourceVersions:versions,reason}),
 SettlementCancelCommand:object({kind:str('CANCEL_DRAFT'),...command,reason}),
 SettlementBatchCommand:union('kind','ApproveCommand','CancelCommand'),
 SettlementEligibilityDecidedReceipt:object({kind:str('ELIGIBILITY_DECIDED'),accrualId:uuid,decisionId:uuid,state:str('HELD','AVAILABLE'),version,availableAt:time,fundsTransferred:falseValue}),
 SettlementBeneficiaryPendingReceipt:object({kind:str('BENEFICIARY_PENDING'),beneficiaryId:uuid,state:str('PENDING'),version:str('1'),challenge:ref('OwnershipChallenge'),outwardReady:falseValue}),
 SettlementBeneficiaryVerifyCommand:object({...command,signature:{type:'string',pattern:'^[1-9A-HJ-NP-Za-km-z]{64,90}$'}}),
 SettlementBeneficiaryVerifiedReceipt:object({kind:str('BENEFICIARY_VERIFIED'),beneficiaryId:uuid,state:str('VERIFIED'),version}),
 SettlementBatchDraftReceipt:object({...draftBase,kind:str('BATCH_DRAFT'),state:str('DRAFT'),version:str('1')}),
 SettlementBatchReservedReceipt:object({kind:str('BATCH_RESERVED'),batchId:uuid,state:str('RESERVED'),version,money,payoutMoney:money,asset:ref('Asset'),reserveTransactionId:uuid,outwardReady:falseValue,fundsTransferred:falseValue}),
 SettlementBatchCancelledReceipt:object({kind:str('BATCH_CANCELLED'),batchId:uuid,state:str('CANCELLED'),version,money,payoutMoney:money,asset:ref('Asset'),reserveTransactionId:nil,outwardReady:falseValue,fundsTransferred:falseValue}),
 SettlementBatchReceipt:union('kind','BatchReservedReceipt','BatchCancelledReceipt'),
});
Object.assign(spec.components.schemas,{
 SettlementAuthorityRetirementCommand:object({originalSessionId:uuid}),
 SettlementAuthorityRetiredReceipt:object({kind:str('BENEFICIARY_AUTHORITY_RETIRED'),accountId:uuid,originalSessionId:uuid,deviceId:uuid}),
});
function operation(pathName:string,method:'get'|'post',operationId:string,result:string,input?:string,param?:string){
 const parameters:any[]=[];if(param)parameters.push({name:param,in:'path',required:true,schema:uuid});if(method==='get')parameters.push({name:'afterId',in:'query',required:false,schema:uuid});
 const op:any={operationId,security:[{mobileBearer:[]}],parameters,responses:{'200':{description:'Canonical earning accounting and separately frozen token payout facts. Availability is not liquidity; submitted is not verified settlement.',content:{'application/json':{schema:ref(result)}}}}};
 if(input)op.requestBody={required:true,content:{'application/json':{schema:ref(input)}}};spec.paths[pathName]={...(spec.paths[pathName]??{}),[method]:op};
}
operation('/driver/earnings','get','driverEarnings','DriverPage');operation('/platform/merchants/{merchantId}/earnings','get','financeEarnings','FinancePage',undefined,'merchantId');
operation('/platform/earnings/{accrualId}/eligibility','post','earningEligibility','EligibilityDecidedReceipt','EligibilityCommand','accrualId');operation('/driver/payout-beneficiaries','post','enrollPayoutBeneficiary','BeneficiaryPendingReceipt','EnrollCommand');operation('/platform/settlement-batches','post','prepareSettlementBatch','BatchDraftReceipt','PrepareCommand');operation('/platform/settlement-batches/{batchId}/commands','post','commandSettlementBatch','BatchReceipt','BatchCommand','batchId');
operation('/driver/payout-beneficiaries/{beneficiaryId}/verify','post','verifyPayoutBeneficiary','BeneficiaryVerifiedReceipt','BeneficiaryVerifyCommand','beneficiaryId');
operation('/driver/payout-beneficiaries/retired-authority','post','retiredBeneficiaryAuthority','AuthorityRetiredReceipt','AuthorityRetirementCommand');
await writeFile(path,JSON.stringify(spec,null,2)+'\n');console.log('Published strict settlement088 earning/token-separated mobile contracts; no transfer confirmed by command.');
