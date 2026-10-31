// Pure helpers for the reward voucher setup card (migration 173). Money is integer minor units on the wire; the owner types major units.
export interface RewardRow {id:string;slot:number;nameTh:string;nameEn:string;pointsCost:number;currency:string;decimals:number;discountMinor:string;minimumSpendMinor:string;validityDays:number;enabled:boolean}
export interface RewardSettingsView {currency:string|null;decimals:number|null;rewards:RewardRow[]}
/** "12.5" with 2 decimals -> "1250". Null for anything that is not a positive amount within the currency precision. */
export function toMinor(text:string,decimals:number):string|null{
 const match=/^(\d{1,9})(?:\.(\d+))?$/.exec(text.trim());if(!match)return null;
 const fraction=match[2]??'';if(fraction.length>decimals)return null;
 const minor=BigInt(match[1]+fraction.padEnd(decimals,'0'));return minor>0n?minor.toString():null;
}
export function fromMinor(minor:string,decimals:number):string{
 if(decimals===0)return minor;const padded=minor.padStart(decimals+1,'0'),whole=padded.slice(0,-decimals),fraction=padded.slice(-decimals).replace(/0+$/,'');
 return fraction?`${whole}.${fraction}`:whole;
}
export interface RewardDraft {slot:number;nameTh:string;nameEn:string;pointsCost:string;discount:string;minimumSpend:string;validityDays:string;enabled:boolean}
export type RewardBody = {slot:number;nameTh:string;nameEn:string;pointsCost:number;discountMinor:string;minimumSpendMinor:string;validityDays:number;enabled:boolean};
/** The request the server will accept, or the first reason it would not. Minimum spend must exceed the discount (no zero-payable voucher). */
export function rewardBody(draft:RewardDraft,decimals:number):{ok:true;body:RewardBody}|{ok:false;reason:'name'|'points'|'discount'|'minimum'|'minimum-too-low'|'validity'}{
 const nameTh=draft.nameTh.trim(),nameEn=draft.nameEn.trim();
 if(!nameTh||!nameEn||nameTh.length>80||nameEn.length>80)return {ok:false,reason:'name'};
 const points=/^[1-9]\d{0,6}$/.test(draft.pointsCost.trim())?Number(draft.pointsCost.trim()):0;if(!points||points>1000000)return {ok:false,reason:'points'};
 const discountMinor=toMinor(draft.discount,decimals);if(!discountMinor)return {ok:false,reason:'discount'};
 const minimumSpendMinor=toMinor(draft.minimumSpend,decimals);if(!minimumSpendMinor)return {ok:false,reason:'minimum'};
 if(BigInt(minimumSpendMinor)<=BigInt(discountMinor))return {ok:false,reason:'minimum-too-low'};
 const days=/^[1-9]\d{0,2}$/.test(draft.validityDays.trim())?Number(draft.validityDays.trim()):0;if(!days||days>365)return {ok:false,reason:'validity'};
 return {ok:true,body:{slot:draft.slot,nameTh,nameEn,pointsCost:points,discountMinor,minimumSpendMinor,validityDays:days,enabled:draft.enabled}};
}
