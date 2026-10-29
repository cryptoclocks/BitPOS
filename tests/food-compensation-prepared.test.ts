import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {fixture} from './payout-provider.fixture';
import {validateCompensationPrepared} from '../apps/worker/src/food-compensation-prepared';
test('real Ed25519 fixture transaction binds compensation reservation and rejects substitution',async()=>{
 const f=fixture();const payload=await f.prepare();
 const binding={attemptId:payload.attemptId,reservationId:payload.batchId,recipientOwner:payload.recipientOwner,sourceOwner:payload.sourceOwner,feePayerOwner:payload.feePayerOwner,amountMinor:payload.amountMinor,asset:payload.asset,maxFeeLamports:1000000,maxTotalLamports:3000000};
 assert.equal(validateCompensationPrepared(binding,payload).signature,payload.signature);
 for(const changed of [{reservationId:randomUUID()},{attemptId:randomUUID()},{amountMinor:'101'},{recipientOwner:payload.sourceOwner}])assert.throws(()=>validateCompensationPrepared({...binding,...changed},payload));
 const bytes=Buffer.from(payload.signedBase64,'base64');bytes[1]^=1;
 assert.throws(()=>validateCompensationPrepared(binding,{...payload,signedBase64:bytes.toString('base64'),signedBytesSha256:createHash('sha256').update(bytes).digest('hex')}));
 assert.throws(()=>validateCompensationPrepared(binding,{...payload,feeLamports:1000001}));assert.equal(f.state.sends.length,0);
});
