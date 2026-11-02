// GrabFood partner API client. Every URL, header, scope and JSON key below is taken from Grab's official, MIT-licensed
// OpenAPI-generated SDK (github.com/grab/grabfood-api-sdk-python, API version 1.1.3, read 2026-10-31):
//   hosts      sandbox  https://partner-api.grab.com/grabfood-sandbox   production https://partner-api.grab.com/grabfood   OAuth https://api.grab.com
//   token      POST /grabid/v1/oauth2/token  {client_id,client_secret,grant_type:'client_credentials',scope:'food.partner_api'}
//   orders     GET  /partner/v1/orders?merchantID&date&page | orderIDs (max 10)        accept/reject  POST /partner/v1/order/prepare {orderID,toState:'Accepted'|'Rejected'}
//   ready      POST /partner/v1/orders/mark {orderID,markStatus:1}                      cancel         PUT  /partner/v1/order/cancel {orderID,merchantID,cancelCode}
//   store      GET  /partner/v1/merchants/{merchantID}/store/status
// NOT in the SDK, therefore NOT implemented: how Grab authenticates its inbound Submit Order webhook, the full order-state list,
// the list-orders `date` format and the meaning of cancel codes. Orders are therefore obtained by polling List Orders.
// Nothing here has been run against Grab's real sandbox yet (no credentials issued to BitPOS); tests use a fake fetch.
export const GRAB_HOSTS={sandbox:'https://partner-api.grab.com/grabfood-sandbox',production:'https://partner-api.grab.com/grabfood'} as const;
export const GRAB_AUTH_HOST='https://api.grab.com';
export type GrabEnvironment=keyof typeof GRAB_HOSTS;
export interface GrabCredentials{clientId:string;clientSecret:string;merchantId:string}

/** Failure kinds a caller can act on. `unknown_outcome` = the request may have reached Grab: reconcile (List Orders) before retrying. */
export class GrabError extends Error{
 constructor(readonly kind:'auth'|'forbidden'|'rate_limited'|'server'|'rejected'|'network'|'unknown_outcome'|'bad_response',readonly status:number|null,message:string,readonly retryAfterSeconds:number|null=null){super(message);}
}
type Fetch=(url:string,init:{method:string;headers:Record<string,string>;body?:string;signal?:AbortSignal})=>Promise<{status:number;headers:{get(name:string):string|null};text():Promise<string>}>;
interface Token{value:string;expiresAt:number}
export interface GrabOrder{
 orderID:string;shortOrderNumber:string;merchantID:string;paymentType:string;orderTime:string;orderState?:string|null;scheduledTime?:string|null;
 currency:{code:string;symbol?:string;exponent:number};featureFlags?:{orderAcceptedType?:string;orderType?:string};
 items:{id:string;grabItemID?:string;quantity:number;price:number;tax?:number;specifications?:string|null;modifiers?:{id?:string;price?:number;tax?:number;quantity?:number}[]|null}[];
 price:{subtotal:number;tax?:number;merchantChargeFee?:number|null;merchantFundPromo?:number|null;grabFundPromo?:number|null;deliveryFee?:number|null;eaterPayment?:number|null;total?:number|null;merchantEarning?:{revenue?:number;netEarning?:number;mexFundDiscount?:number;commission?:number}|null};
}

export class GrabFoodClient{
 private token:Token|null=null;
 constructor(private readonly env:GrabEnvironment,private readonly creds:GrabCredentials,private readonly http:Fetch=fetch as unknown as Fetch,private readonly now:()=>number=Date.now,private readonly timeoutMs=15000){}
 get host(){return GRAB_HOSTS[this.env];}

 private async send(method:string,url:string,headers:Record<string,string>,body?:unknown,idempotentRead=true):Promise<unknown>{
  let res;
  try{
   res=await this.http(url,{method,headers:{'Content-Type':'application/json',Accept:'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(this.timeoutMs)});
  }catch{
   // A timeout/reset after a write may have been applied by Grab; the caller must reconcile, never blindly resend.
   throw new GrabError(idempotentRead?'network':'unknown_outcome',null,'GRAB_UNREACHABLE');
  }
  const text=await res.text();
  if(res.status===401)throw new GrabError('auth',401,'GRAB_AUTH_FAILED');
  if(res.status===403)throw new GrabError('forbidden',403,'GRAB_FORBIDDEN');
  if(res.status===429)throw new GrabError('rate_limited',429,'GRAB_RATE_LIMITED',Number(res.headers.get('retry-after'))||null);
  if(res.status>=500)throw new GrabError(idempotentRead?'server':'unknown_outcome',res.status,'GRAB_SERVER_ERROR');
  if(res.status>=400)throw new GrabError('rejected',res.status,'GRAB_REQUEST_REJECTED');
  if(!text)return null;
  try{return JSON.parse(text);}catch{throw new GrabError('bad_response',res.status,'GRAB_BAD_RESPONSE');}
 }
 /** The token is reused until it expires (Grab's default lifetime is 7 days); a 401 drops it so the next call re-authenticates. */
 async accessToken():Promise<string>{
  if(this.token&&this.token.expiresAt-60_000>this.now())return this.token.value;
  const r=await this.send('POST',GRAB_AUTH_HOST+'/grabid/v1/oauth2/token',{},{client_id:this.creds.clientId,client_secret:this.creds.clientSecret,grant_type:'client_credentials',scope:'food.partner_api'}) as {access_token?:string;expires_in?:number}|null;
  if(!r?.access_token)throw new GrabError('bad_response',200,'GRAB_BAD_RESPONSE');
  this.token={value:r.access_token,expiresAt:this.now()+(r.expires_in??3600)*1000};
  return this.token.value;
 }
 private async authed(method:string,path:string,body?:unknown,idempotentRead=true){
  const call=async()=>this.send(method,this.host+path,{Authorization:'Bearer '+await this.accessToken()},body,idempotentRead);
  try{return await call();}catch(e){if(e instanceof GrabError&&e.kind==='auth'&&this.token){this.token=null;return call();}throw e;}
 }
 /** Proves the credentials AND the merchant ID: token + store status. */
 async storeStatus():Promise<{isOpen:boolean;closeReason:string}>{
  const r=await this.authed('GET',`/partner/v1/merchants/${encodeURIComponent(this.creds.merchantId)}/store/status`) as {isOpen?:boolean;closeReason?:string}|null;
  if(typeof r?.isOpen!=='boolean')throw new GrabError('bad_response',200,'GRAB_BAD_RESPONSE');
  return {isOpen:r.isOpen,closeReason:r.closeReason??''};
 }
 async listOrders(q:{date:string;page:number}|{orderIds:string[]}):Promise<{orders:GrabOrder[];more:boolean}>{
  const p=new URLSearchParams({merchantID:this.creds.merchantId});
  if('orderIds' in q){if(q.orderIds.length>10||!q.orderIds.length)throw new GrabError('rejected',null,'GRAB_TOO_MANY_ORDER_IDS');for(const id of q.orderIds)p.append('orderIDs',id);}
  else{p.set('date',q.date);p.set('page',String(q.page));}
  const r=await this.authed('GET','/partner/v1/orders?'+p) as {orders?:GrabOrder[];more?:boolean}|null;
  return {orders:r?.orders??[],more:r?.more===true};
 }
 /** Writes below can time out after Grab applied them: unknown_outcome means "re-read the order before trying again". */
 async acceptOrReject(orderId:string,toState:'Accepted'|'Rejected'){await this.authed('POST','/partner/v1/order/prepare',{orderID:orderId,toState},false);}
 async markReady(orderId:string){await this.authed('POST','/partner/v1/orders/mark',{orderID:orderId,markStatus:1},false);}
 async cancel(orderId:string,cancelCode:number){await this.authed('PUT','/partner/v1/order/cancel',{orderID:orderId,merchantID:this.creds.merchantId,cancelCode},false);}
}
