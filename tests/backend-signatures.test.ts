import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction,TransactionInstruction,PublicKey} from '@solana/web3.js';
import {createTransferCheckedWithFeeInstruction,TOKEN_2022_PROGRAM_ID,TOKEN_PROGRAM_ID} from '@solana/spl-token';

test('frozen sponsored payment rejects changed payment fields and invalid signatures',{skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'},async()=>{
 // Intentional module-loading boundary: static import would load required payment config in skipped runs.
 // Ephemeral fixture signers also prove validation never loads the private sponsor key.
 const {validateSigned}=await import('../apps/api/src/payments');
 const sponsor=Keypair.generate(),payer=Keypair.generate(),other=Keypair.generate();
 const source=Keypair.generate().publicKey,destination=Keypair.generate().publicKey;
 const mint=Keypair.generate().publicKey,reference=Keypair.generate().publicKey;
 const blockhash=Keypair.generate().publicKey.toBase58();
 const memo=new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
 function transaction(mutation='none'){
  const owner=mutation==='payer'?other:payer;
  const instruction=createTransferCheckedWithFeeInstruction(source,
   mutation==='mint'?other.publicKey:mint,
   mutation==='recipient'?other.publicKey:destination,
   owner.publicKey,mutation==='amount'?2n:1n,mutation==='decimals'?7:6,0n,[],
   TOKEN_2022_PROGRAM_ID);
  if(mutation==='program')instruction.programId=TOKEN_PROGRAM_ID;
  instruction.keys.push({pubkey:mutation==='reference'?other.publicKey:reference,isSigner:false,isWritable:false});
  return new Transaction({feePayer:mutation==='feePayer'?other.publicKey:sponsor.publicKey,
   recentBlockhash:mutation==='blockhash'?other.publicKey.toBase58():blockhash})
   .add(instruction,new TransactionInstruction({programId:memo,keys:[],
    data:Buffer.from(mutation==='order'?'unrelated order':'BitPOS fixture order')}));
 }
 const expected=transaction();expected.partialSign(sponsor);
 const frozen=expected.serialize({requireAllSignatures:false}).toString('base64');
 assert.throws(()=>validateSigned(frozen,frozen,payer.publicKey.toBase58()));
 expected.partialSign(payer);
 const signed=expected.serialize().toString('base64');
 assert.equal(validateSigned(signed,frozen,payer.publicKey.toBase58()).bytes.toString('base64'),signed);
 const missingSponsor=transaction();missingSponsor.partialSign(payer);
 assert.throws(()=>validateSigned(missingSponsor.serialize({requireAllSignatures:false}).toString('base64'),frozen,payer.publicKey.toBase58()));
 for(const mutation of ['recipient','amount','mint','reference','payer','feePayer','program','decimals','order','blockhash']){
  const changed=transaction(mutation);
  changed.sign(mutation==='feePayer'?other:sponsor,mutation==='payer'?other:payer);
  assert.throws(()=>validateSigned(changed.serialize().toString('base64'),frozen,payer.publicKey.toBase58()),mutation);
 }
 const tampered=Buffer.from(signed,'base64');tampered[1]^=1;
 assert.throws(()=>validateSigned(tampered.toString('base64'),frozen,payer.publicKey.toBase58()));
});
