import pg from 'pg';
import {createHash} from 'node:crypto';
import {RequestError} from './authority';
import type {MobilePrincipal} from './mobile-auth';
import {SettlementBeneficiaryVerifyCommandSchema,SettlementBeneficiaryVerifiedReceiptSchema,SettlementOwnershipChallengeSchema,type SettlementBeneficiaryVerifyCommand} from '../../../packages/contracts/src/mobile-v1.generated';
import {verifyBeneficiaryOwnershipChallenge} from '../../worker/src/payout-provider';
import {DEVNET_GENESIS} from '../../../packages/domain/src/index';

/** Separate least-privilege login. Never fall back to application/admin credentials. */
let verifierPool:pg.Pool|undefined;
function privatePool(){
 const url=process.env.BITPOS_SETTLEMENT_VERIFIER_DATABASE_URL;
 if(!url)throw new RequestError(503,'CONFIGURATION_REQUIRED','Beneficiary verification is not configured');
 return verifierPool??=new pg.Pool({connectionString:url,max:2,connectionTimeoutMillis:2000});
}
export async function verifySettlementBeneficiary(actor:MobilePrincipal,accessHash:string,beneficiaryId:string,input:SettlementBeneficiaryVerifyCommand){
 const command=SettlementBeneficiaryVerifyCommandSchema.parse(input),db=await privatePool().connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await db.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");
  const role=(await db.query("SELECT NOT r.rolsuper AND pg_has_role(current_user,'bitpos_settlement_worker','MEMBER') AND NOT pg_has_role(current_user,'bitpos_app','MEMBER') AS ok FROM pg_roles r WHERE rolname=current_user")).rows[0];
  if(role?.ok!==true)throw new RequestError(503,'CONFIGURATION_REQUIRED','A separate least-privilege verifier login is required');
  await db.query('SET LOCAL ROLE bitpos_settlement_worker');
  await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_device',$3,true),set_config('bitpos.mobile_access_hash',$4,true)",[actor.accountId,actor.sessionId,actor.deviceId,accessHash]);
  const stored=(await db.query('SELECT bitpos.settlement088_worker_beneficiary_challenge($1) value',[beneficiaryId])).rows[0].value;
  const challenge=SettlementOwnershipChallengeSchema.parse(stored.challenge);
  if(challenge.accountId!==actor.accountId||challenge.deviceId!==actor.deviceId||challenge.enrollmentId!==beneficiaryId)throw new RequestError(404,'RESOURCE_NOT_FOUND');
  if(!['PENDING','VERIFIED'].includes(stored.state))throw new RequestError(409,'SETTLEMENT_NOT_READY');
  // An already-consumed challenge may only replay its ORIGINAL SQL command.
  // Recheck its signature without turning expiry into a second state transition;
  // SQL compares the full original command hash before returning the receipt.
  const now=stored.state==='VERIFIED'?Math.min(Date.now(),Date.parse(challenge.expiresAt)-1):Date.now();
  const proof=verifyBeneficiaryOwnershipChallenge({...challenge,version:1,genesisHash:DEVNET_GENESIS},command.signature,now);
  if(proof.status!=='VERIFIED')throw new RequestError(422,'INVALID_REQUEST','Beneficiary ownership signature rejected',{reasonCode:proof.reason});
  const ownershipProofHash=createHash('sha256').update(JSON.stringify([proof.messageDigest,command.signature])).digest('hex');
  const receipt=SettlementBeneficiaryVerifiedReceiptSchema.parse((await db.query('SELECT bitpos.settlement088_worker_beneficiary_verify($1,$2::jsonb) value',[beneficiaryId,JSON.stringify({idempotencyKey:command.idempotencyKey,expectedVersion:command.expectedVersion,enrollmentChallenge:challenge.challengeId,ownershipProofHash,challenge})])).rows[0].value);
  await db.query('COMMIT');return receipt;
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
