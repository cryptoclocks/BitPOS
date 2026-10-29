import type {PaymentAsset,DenominationPolicy,Settlement} from '../../contracts/src/index';
import {MINT,TOKEN_PROGRAM,DEVNET_GENESIS} from './index';
export const SPL_TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const USDC_DEVNET_MINT='4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const MAX_PAYMENT_RAW=999999999999999999n;
export const USDG_ASSET:PaymentAsset={assetId:'usdg-devnet',symbol:'USDG',displayLabel:'USDG devnet',cluster:'devnet',genesisHash:DEVNET_GENESIS,mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,instructionPolicy:'token2022_zero_fee',issuerTestAsset:true};
export function denomination(totalMinor:string,policy:DenominationPolicy):string {
 const total=BigInt(totalMinor),n=BigInt(policy.numerator),d=BigInt(policy.denominator);
 if(total<=0n||n<=0n||d<=0n||n>18446744073709551615n||d>18446744073709551615n)throw Error('Invalid denomination');
 const product=total*n;
 if(product%d!==0n)throw Error('Nondivisible denomination');
 const amount=product/d;if(amount<=0n||amount>MAX_PAYMENT_RAW)throw Error('Payment amount exceeds policy');
 return amount.toString();
}
export function assetSettlement(asset:PaymentAsset,totalMinor:string,policy:DenominationPolicy,recipient:string):Settlement {
 return {assetId:asset.assetId,currency:asset.symbol,displayLabel:asset.displayLabel,decimals:asset.decimals,amountMinor:denomination(totalMinor,policy),denominationPolicy:policy,network:'solana:devnet',genesisHash:asset.genesisHash,mint:asset.mint,tokenProgram:asset.tokenProgram,testToken:true,recipient,sponsor:'merchant_funded'};
}
export function assertAssetDescriptor(asset:PaymentAsset){
 if(asset.cluster!=='devnet'||asset.genesisHash!==DEVNET_GENESIS||asset.decimals!==6)throw Error('Unsupported payment asset');
 if(asset.assetId==='usdg-devnet'){
  if(asset.mint!==MINT||asset.tokenProgram!==TOKEN_PROGRAM||asset.symbol!=='USDG'||asset.instructionPolicy!=='token2022_zero_fee'||!asset.issuerTestAsset)throw Error('Unsupported payment asset');
 }else if(asset.assetId==='usdc-devnet'){
  if(asset.mint!==USDC_DEVNET_MINT||asset.tokenProgram!==SPL_TOKEN_PROGRAM||asset.symbol!=='USDC'||asset.instructionPolicy!=='spl_checked'||!asset.issuerTestAsset)throw Error('Unsupported payment asset');
 }else if(asset.assetId==='usdt-test-devnet'){
  if(asset.mint===MINT||asset.mint===USDC_DEVNET_MINT||asset.tokenProgram!==SPL_TOKEN_PROGRAM||asset.symbol!=='USDT'||asset.instructionPolicy!=='spl_checked'||asset.issuerTestAsset||asset.displayLabel!=='USDT test (BitPOS-issued)')throw Error('Unsupported payment asset');
 }else throw Error('Unsupported payment asset');
}

/** Merchant policies use cents. Freeze an exact scale-aware policy for this quote. */
export function policyForPrecision(policy:DenominationPolicy,decimals:2|4|6):DenominationPolicy {
 if(decimals===2)return policy;
 if(decimals!==4)throw Error('Invalid USD precision');
 let n=BigInt(policy.numerator),d=BigInt(policy.denominator)*100n;
 const gcd=(a:bigint,b:bigint):bigint=>b?gcd(b,a%b):a;const common=gcd(n,d);n/=common;d/=common;
 if(n<=0n||d<=0n||n>18446744073709551615n||d>18446744073709551615n)throw Error('Invalid precision policy');
 const id=policy.id.replace('USD_CENTS','USD_FIXED4');if(Buffer.byteLength(id)>64)throw Error('Invalid precision policy');return {id,numerator:n.toString(),denominator:d.toString()};
}
