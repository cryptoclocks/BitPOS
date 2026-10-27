import {Keypair,PublicKey,Transaction,type VersionedTransaction,type AccountInfo} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import bs58 from 'bs58';
import {createPayoutProvider,createInboundFundingVerifier,type PayoutTransport,type ReadyPayoutProvider,type PreparedPayout} from '../apps/worker/src/payout-provider';
import {DEVNET_GENESIS} from '../packages/domain/src/index';
import {USDC_DEVNET_MINT,SPL_TOKEN_PROGRAM,USDG_ASSET} from '../packages/domain/src/payment-assets';
import type {PaymentAsset} from '../packages/contracts/src/index';
// Public deterministic synthetic test keys only. Never load an operator key or contact an RPC.
const source=Keypair.fromSeed(new Uint8Array(32).fill(1)),recipient=Keypair.fromSeed(new Uint8Array(32).fill(2));
const asset:PaymentAsset={assetId:'usdc-devnet',symbol:'USDC',displayLabel:'USDC devnet',cluster:'devnet',genesisHash:DEVNET_GENESIS,mint:USDC_DEVNET_MINT,tokenProgram:SPL_TOKEN_PROGRAM,decimals:6,instructionPolicy:'spl_checked',issuerTestAsset:true};
const info=(data:Buffer,owner=spl.TOKEN_PROGRAM_ID):AccountInfo<Buffer>=>({data,owner,executable:false,lamports:1,rentEpoch:0});
function usdgExtensions(){
 const issuer=new PublicKey('DFWDTsWsyGgFLbVARTS92wHDKK2hwTUNk71uPM3mf16S').toBuffer(),tlv=(type:number,data:Buffer)=>{const header=Buffer.alloc(4);header.writeUInt16LE(type);header.writeUInt16LE(data.length,2);return Buffer.concat([header,data]);};
 const fee=Buffer.alloc(108);issuer.copy(fee,0);issuer.copy(fee,32);const hook=Buffer.alloc(64);issuer.copy(hook,0);
 return Buffer.concat([tlv(1,fee),tlv(3,Buffer.alloc(0)),tlv(12,issuer),tlv(4,Buffer.alloc(0)),tlv(16,Buffer.alloc(0)),tlv(14,hook),tlv(18,Buffer.concat([issuer,new PublicKey(USDG_ASSET.mint).toBuffer()])),tlv(19,Buffer.alloc(0))]);
}
function mintInfo(asset:PaymentAsset,extensions?:Buffer){
 const base=Buffer.alloc(spl.MINT_SIZE);spl.MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},base);
 if(!extensions)return info(base,new PublicKey(asset.tokenProgram));const data=Buffer.alloc(166+extensions.length);base.copy(data);data[165]=1;extensions.copy(data,166);return info(data,new PublicKey(asset.tokenProgram));
}
function tokenInfo(owner:PublicKey,amount:bigint,asset:PaymentAsset){const data=Buffer.alloc(spl.ACCOUNT_SIZE);spl.AccountLayout.encode({mint:new PublicKey(asset.mint),owner,amount,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},data);return info(data,new PublicKey(asset.tokenProgram));}
function fixture(selectedAsset:PaymentAsset=asset,separatePayer=false,selectedRecipient:PublicKey=recipient.publicKey,maxAmountMinor='1000000',selectedSource:Keypair=source){
 const feePayer=separatePayer?Keypair.fromSeed(new Uint8Array(32).fill(3)):selectedSource;
 const asset=selectedAsset,sourceAta=spl.getAssociatedTokenAddressSync(new PublicKey(asset.mint),selectedSource.publicKey,false,new PublicKey(asset.tokenProgram)),recipientAta=spl.getAssociatedTokenAddressSync(new PublicKey(asset.mint),selectedRecipient,false,new PublicKey(asset.tokenProgram));
 const state={genesis:DEVNET_GENESIS,balance:1000000n,feeBalance:10000000,recipientExists:true,sends:[] as Buffer[],sendAmbiguous:false,chain:null as any,commitment:'finalized',history:null as any,blockHeight:101,signs:0,registry:asset,mint:mintInfo(asset,asset.instructionPolicy==='token2022_zero_fee'?usdgExtensions():undefined),accountSize:512n,sizeProgram:asset.tokenProgram,sizeError:null as unknown,sizeReturnData:undefined as unknown,rentOverride:null as number|null,simulations:[] as {bytes:Buffer;query:boolean;options:Record<string,unknown>}[]};
 const connection={
  getGenesisHash:async()=>state.genesis,
  getAccountInfo:async(key:PublicKey)=>key.toBase58()===asset.mint?state.mint:key.equals(sourceAta)?tokenInfo(selectedSource.publicKey,state.balance,asset):key.equals(recipientAta)?state.recipientExists?tokenInfo(selectedRecipient,0n,asset):null:null,
  getLatestBlockhashAndContext:async()=>({context:{slot:10},value:{blockhash:PublicKey.default.toBase58(),lastValidBlockHeight:100}}),
  getFeeForMessage:async()=>({context:{slot:10},value:5000}),getMinimumBalanceForRentExemption:async(size:number)=>state.rentOverride??size*1000,getBalance:async()=>state.feeBalance,
  simulateTransaction:async(tx:VersionedTransaction,options:Record<string,unknown>)=>{
   const bytes=Buffer.from(tx.serialize()),decoded=Transaction.from(bytes),query=decoded.instructions[0]?.data[0]===21;
   state.simulations.push({bytes,query,options:{...options}});
   const size=Buffer.alloc(8);size.writeBigUInt64LE(state.accountSize);
   if(query)return {context:{slot:10},value:{err:state.sizeError,logs:[],returnData:state.sizeReturnData===undefined?{programId:state.sizeProgram,data:[size.toString('base64'),'base64']}:state.sizeReturnData}};
   return {context:{slot:10},value:{err:options.sigVerify===true&&decoded.verifySignatures()?null:'SignatureVerificationRequired',logs:[]}};
  },
  sendRawTransaction:async(bytes:Buffer)=>{state.sends.push(Buffer.from(bytes));if(state.sendAmbiguous)throw Error('Synthetic response loss');return bs58.encode(Transaction.from(bytes).signature!);},
  getTransaction:async(_signature:string,options:{commitment:string})=>options.commitment===state.commitment?state.chain:null,
  getSignatureStatuses:async()=>({context:{slot:11},value:[state.history]}),getBlockHeight:async()=>state.blockHeight,isBlockhashValid:async()=>({context:{slot:11},value:false}),
 } as unknown as PayoutTransport;
 const provider=createPayoutProvider({kind:'solana-devnet',sourceOwner:selectedSource.publicKey.toBase58(),feePayerOwner:feePayer.publicKey.toBase58(),allowedAssetIds:[asset.assetId],maxAmountMinor,maxFeeLamports:10000,maxTotalLamports:3000000},{connection,resolveAsset:async()=>state.registry,loadSigningKeys:async()=>{state.signs++;return {source:selectedSource,feePayer};}}) as ReadyPayoutProvider;
 return {provider,state,connection,sourceOwner:selectedSource.publicKey.toBase58(),feePayerOwner:feePayer.publicKey.toBase58(),prepare:()=>provider.prepare({attemptId:'attempt-fixture',batchId:'batch-fixture',beneficiaryOwner:selectedRecipient.toBase58(),amountMinor:'1000',asset})};
}
function chainReceipt(prepared:PreparedPayout,sourceBalanceMinor='1000000'){
 const asset=prepared.asset;
 const tx=Transaction.from(Buffer.from(prepared.signedBase64,'base64')),message=tx.compileMessage();
 const index=(key:string)=>message.accountKeys.findIndex(value=>value.toBase58()===key);
 const balance=(key:string,owner:string,amount:string)=>({accountIndex:index(key),owner,mint:asset.mint,programId:asset.tokenProgram,uiTokenAmount:{amount,decimals:6,uiAmount:null,uiAmountString:amount}});
 return {slot:11,blockTime:1792368000,version:'legacy',transaction:{message,signatures:tx.signatures.map(value=>bs58.encode(value.signature!))},meta:{err:null as unknown,fee:5000,innerInstructions:[],preTokenBalances:[balance(prepared.sourceTokenAccount,prepared.sourceOwner,sourceBalanceMinor),balance(prepared.recipientTokenAccount,prepared.recipientOwner,'0')],postTokenBalances:[balance(prepared.sourceTokenAccount,prepared.sourceOwner,(BigInt(sourceBalanceMinor)-BigInt(prepared.amountMinor)).toString()),balance(prepared.recipientTokenAccount,prepared.recipientOwner,prepared.amountMinor)]}};
}
export {source,recipient,asset,fixture,chainReceipt};
export async function fundingFixture(selected:PaymentAsset=asset,blockhash=PublicKey.default.toBase58(),amountMinor='1000'){
 const f=fixture(selected);if(amountMinor!=='1000')f.state.balance=BigInt(amountMinor)+1000000n;const prepared=await f.prepare(),program=new PublicKey(selected.tokenProgram);
 const sourceAta=new PublicKey(prepared.sourceTokenAccount),destinationAta=new PublicKey(prepared.recipientTokenAccount),mint=new PublicKey(selected.mint);
 const transfer=selected.instructionPolicy==='token2022_zero_fee'?spl.createTransferCheckedWithFeeInstruction(sourceAta,mint,destinationAta,source.publicKey,BigInt(amountMinor),6,0n,[],program):spl.createTransferCheckedInstruction(sourceAta,mint,destinationAta,source.publicKey,BigInt(amountMinor),6,[],program);
 const tx=new Transaction({feePayer:source.publicKey,recentBlockhash:blockhash}).add(transfer);tx.sign(source);
 const signature=bs58.encode(tx.signature!);f.state.chain=chainReceipt({...prepared,amountMinor,signedBase64:tx.serialize().toString('base64'),signature},f.state.balance.toString());
 const verifier=createInboundFundingVerifier({connection:f.connection,resolveAsset:async()=>selected}),input={signature,assetId:selected.assetId,recipientOwner:recipient.publicKey.toBase58()};
 return {...f,verifier,input};
}
