import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {ed25519} from '@noble/curves/ed25519';
import bs58 from 'bs58';
import {CUSTOMER_CONSENT_VERSION,customerAuthMessage} from '../packages/contracts/src/customer-auth';
import type {CustomerAuthChallenge} from '../packages/contracts/src/customer-auth';
import type {verifyCustomerSignature as CustomerSignatureVerifier} from '../apps/api/src/customer-auth';

let verifyCustomerSignature:typeof CustomerSignatureVerifier;

before(async()=>{
 // Intentional module-loading boundary: a static API import validates configuration
 // before these isolated import prerequisites can be supplied. Its pg.Pool is lazy;
 // these tests never connect to a database or RPC.
 const isolatedEnv={
  DATABASE_URL:'postgresql://customer_auth_test:unused@127.0.0.1:1/customer_auth_test',
  ADMIN_DATABASE_URL:'postgresql://customer_auth_test:unused@127.0.0.1:1/customer_auth_test',
  AUTH_URL:'https://auth.customer-auth-test.invalid',
  AUTH_ANON_KEY:'unused-customer-auth-test',
  APP_SECRET:'customer-auth-test-only-secret-not-for-production',
  PUBLIC_URL:'https://customer-auth-test.invalid',
  BITPOS_CUSTOMER_PUBLIC_URL:'https://customer-auth-test.invalid',
  SOLANA_RPC:'https://api.devnet.solana.com',
  DEVNET_PRIVATE_DIR:'/unused/customer-auth-test',
  BITPOS_DEMO_QUICK_SIGNIN:'0',
 };
 const previous=Object.fromEntries(Object.keys(isolatedEnv).map(key=>[key,process.env[key]]));
 Object.assign(process.env,isolatedEnv);
 try{({verifyCustomerSignature}=await import('../apps/api/src/customer-auth'));}
 finally{
  for(const [key,value] of Object.entries(previous)){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
 }
});

// Native OpenSSL Ed25519 signing is independent of the production noble verifier.
// These deterministic keys authenticate test messages only, never payment authority.
function signer(seedHex:string){
 const privateKey=createPrivateKey({
  key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(seedHex,'hex')]),
  format:'der',type:'pkcs8',
 });
 const publicKey=createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32);
 return {walletAddress:bs58.encode(publicKey),sign:(message:string)=>sign(null,Buffer.from(message,'utf8'),privateKey)};
}
const wallet=signer('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
const otherWallet=signer('4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb');
const challenge:Omit<CustomerAuthChallenge,'message'>={
 challengeId:'10000000-0000-4000-8000-000000000001',
 origin:'https://customer-auth-test.invalid',
 merchantId:'10000000-0000-4000-8000-000000000002',
 walletAddress:wallet.walletAddress,
 order:{
  orderId:'10000000-0000-4000-8000-000000000003',
  requestHash:'a'.repeat(64),
  createdAt:'2026-10-13T12:00:00.000Z',
  occupancyId:'10000000-0000-4000-8000-000000000004',
  occupancyGeneration:'7',
 },
 nonce:'test-wallet-proof-nonce-not-a-session-token',
 issuedAt:'2026-10-13T12:01:00.000Z',
 expiresAt:'2026-10-13T12:06:00.000Z',
 consentVersion:CUSTOMER_CONSENT_VERSION,
};
const message=customerAuthMessage(challenge);
const signature=wallet.sign(message);
const scalarOrder=(1n<<252n)+27742317777372353535851937790883648493n;
function littleEndian(value:bigint):Buffer{
 const bytes=Buffer.alloc(32);
 for(let i=0;i<bytes.length;i++){bytes[i]=Number(value&255n);value>>=8n;}
 return bytes;
}
function fromLittleEndian(bytes:Uint8Array):bigint{
 let value=0n;
 for(let i=bytes.length-1;i>=0;i--)value=(value<<8n)|BigInt(bytes[i]);
 return value;
}

test('a real Ed25519 wallet accepts its exact UTF-8 customer-auth message',()=>{
 assert.equal(verifyCustomerSignature(message,signature,wallet.walletAddress),true);
 const unicodeMessage=`${message}\nบริบทลูกค้า: กาแฟ ☕`;
 assert.equal(verifyCustomerSignature(unicodeMessage,wallet.sign(unicodeMessage),wallet.walletAddress),true);
 assert.equal(verifyCustomerSignature(unicodeMessage,signature,wallet.walletAddress),false);
});

test('customer proof refuses a different wallet, message, signer or damaged signature',()=>{
 assert.equal(verifyCustomerSignature(message,signature,otherWallet.walletAddress),false);
 assert.equal(verifyCustomerSignature(`${message}\n`,signature,wallet.walletAddress),false);
 assert.equal(verifyCustomerSignature(message,otherWallet.sign(message),wallet.walletAddress),false);
 for(const byte of [0,31,32,63]){
  const damaged=Buffer.from(signature);damaged[byte]^=1;
  assert.equal(verifyCustomerSignature(message,damaged,wallet.walletAddress),false,`changed signature byte ${byte}`);
 }
 for(const invalid of [Buffer.alloc(0),signature.subarray(0,63),Buffer.concat([signature,Buffer.of(0)])]){
  assert.equal(verifyCustomerSignature(message,invalid,wallet.walletAddress),false,`signature length ${invalid.length}`);
 }
 assert.equal(verifyCustomerSignature(message,signature,'not-a-solana-wallet'),false);
});

test('a mathematically equivalent noncanonical signature scalar is refused',()=>{
 const scalar=fromLittleEndian(signature.subarray(32));
 const noncanonical=Buffer.concat([signature.subarray(0,32),littleEndian(scalar+scalarOrder)]);
 assert.equal(verifyCustomerSignature(message,noncanonical,wallet.walletAddress),false);
});

const changedChallenges:Array<[string,Omit<CustomerAuthChallenge,'message'>]>=[
 ['origin',{...challenge,origin:'https://other-customer-auth-test.invalid'}],
 ['origin scheme',{...challenge,origin:'http://customer-auth-test.invalid'}],
 ['merchant',{...challenge,merchantId:'10000000-0000-4000-8000-000000000005'}],
 ['wallet',{...challenge,walletAddress:otherWallet.walletAddress}],
 ['order',{...challenge,order:{...challenge.order,orderId:'10000000-0000-4000-8000-000000000006'}}],
 ['request hash',{...challenge,order:{...challenge.order,requestHash:'b'.repeat(64)}}],
 ['order creation',{...challenge,order:{...challenge.order,createdAt:'2026-10-13T12:00:01.000Z'}}],
 ['occupancy',{...challenge,order:{...challenge.order,occupancyId:'10000000-0000-4000-8000-000000000007'}}],
 ['generation',{...challenge,order:{...challenge.order,occupancyGeneration:'8'}}],
 ['absent occupancy',{...challenge,order:{...challenge.order,occupancyId:null,occupancyGeneration:null}}],
 ['challenge',{...challenge,challengeId:'10000000-0000-4000-8000-000000000008'}],
 ['nonce',{...challenge,nonce:'another-test-wallet-proof-nonce'}],
 ['issuance',{...challenge,issuedAt:'2026-10-13T12:01:01.000Z'}],
 ['expiry',{...challenge,expiresAt:'2026-10-13T12:07:00.000Z'}],
];
for(const [binding,changed] of changedChallenges){
 test(`the signed canonical message binds ${binding}`,()=>{
  // If the serializer omits this binding, the unchanged proof wrongly succeeds.
  assert.equal(verifyCustomerSignature(customerAuthMessage(changed),signature,wallet.walletAddress),false);
 });
}
for(const [binding,changedMessage] of [
 ['consent version',message.replace(`Consent Version: ${CUSTOMER_CONSENT_VERSION}`,'Consent Version: bitpos-personal-offers-v2')],
 ['profile consent',message.replace('Consent Purposes: profile,purchase-history','Consent Purposes: purchase-history')],
 ['purchase-history consent',message.replace('Consent Purposes: profile,purchase-history','Consent Purposes: profile')],
] as const){
 test(`the proof cannot be reused with changed ${binding}`,()=>{
  assert.equal(verifyCustomerSignature(changedMessage,signature,wallet.walletAddress),false);
 });
}

// Construct adversarial proofs that DO satisfy ZIP215's cofactored equation.
// Unlike random invalid bytes, these catch swapping in a permissive verifier.
// The known scalar a=1 and nonce r are local algebraic fixtures, not real wallets.
const base=ed25519.Point.BASE;
const torsionGenerator=ed25519.Point.fromBytes(Buffer.from('26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05','hex'));
function cofactoredProof(publicKey:Uint8Array,commitment:Uint8Array,ownerScalar:bigint,nonceScalar:bigint){
 // noble 1.9.7 hashes re-encoded points when evaluating its ZIP215 equation.
 const canonicalR=ed25519.Point.fromBytes(commitment,true).toBytes();
 const canonicalA=ed25519.Point.fromBytes(publicKey,true).toBytes();
 const hash=createHash('sha512').update(canonicalR).update(canonicalA).update(Buffer.from(message,'utf8')).digest();
 const k=fromLittleEndian(hash)%scalarOrder;
 const s=(nonceScalar+k*ownerScalar)%scalarOrder;
 return Buffer.concat([commitment,littleEndian(s)]);
}
function rejectsPermissiveProof(publicKey:Uint8Array,commitment:Uint8Array,ownerScalar:bigint,nonceScalar:bigint){
 const forged=cofactoredProof(publicKey,commitment,ownerScalar,nonceScalar);
 assert.equal(ed25519.verify(forged,Buffer.from(message,'utf8'),publicKey,{zip215:true}),true,'fixture must satisfy the permissive ZIP215 equation');
 assert.equal(verifyCustomerSignature(message,forged,bs58.encode(publicKey)),false);
}

for(let i=0;i<8;i++){
 const torsion=torsionGenerator.multiplyUnsafe(BigInt(i));
 test(`strict wallet proof rejects small-order public key ${i} even with a ZIP215-valid proof`,()=>{
  rejectsPermissiveProof(torsion.toBytes(),base.toBytes(),0n,1n);
 });
 test(`strict wallet proof rejects small-order commitment ${i} even with a ZIP215-valid proof`,()=>{
  rejectsPermissiveProof(base.toBytes(),torsion.toBytes(),1n,0n);
 });
 if(i!==0){
  const mixed=base.add(torsion).toBytes();
  test(`strict wallet proof rejects non-small-order torsion public key ${i}`,()=>{
   rejectsPermissiveProof(mixed,base.toBytes(),1n,1n);
  });
  test(`strict wallet proof rejects non-small-order torsion commitment ${i}`,()=>{
   rejectsPermissiveProof(base.toBytes(),mixed,1n,1n);
  });
 }
}
const noncanonicalPoints:Array<[string,Buffer]>=[
 ['y = p',littleEndian((1n<<255n)-19n)],
 ['y = p + 1',littleEndian((1n<<255n)-18n)],
 ['negative-zero x',Buffer.concat([Buffer.of(1),Buffer.alloc(30),Buffer.of(0x80)])],
];
for(const [encoding,point] of noncanonicalPoints){
 test(`strict wallet proof rejects noncanonical public key encoding ${encoding}`,()=>{
  rejectsPermissiveProof(point,base.toBytes(),0n,1n);
 });
 test(`strict wallet proof rejects noncanonical commitment encoding ${encoding}`,()=>{
  rejectsPermissiveProof(base.toBytes(),point,1n,0n);
 });
}
