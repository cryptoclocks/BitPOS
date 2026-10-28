// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// BitPOS Muse Connector: a Model Context Protocol server (Streamable HTTP transport, JSON responses, no
// server-sent events) at POST /meta/mcp/<merchantId>. Stateless JSON-RPC 2.0; hand-written so it runs on the
// existing runtime image without a new dependency. Tools follow Muse's read / write / sensitive-write split:
// the agent picks product ids and quote ids only, never a price, and pays with a Stripe Shared Payment Token
// (it never sees a card number or a secret key). Stripe sandbox only.
import type http from 'node:http';
import {AgentOrderError,cancelOrder,completeCheckout,createQuote,listMenu,orderStatus,type AgentDeps} from './agent-orders';

export const MCP_PROTOCOL_VERSIONS=['2025-06-18','2025-03-26','2024-11-05'];
const MAX_BODY=65536;
const LABEL='Stripe sandbox · US test merchant · no real money';

const uuidSchema={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
export const TOOLS=[
 {name:'list_menu',title:'List menu',description:`Menu with server prices in minor units and any owner-approved offer. Read only. ${LABEL}.`,
  inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'get_quote',title:'Get quote',description:'Price one product (quantity 1–10) from the live catalog. Returns a quote id valid for 10 minutes; the total is decided by the shop server, never by the agent. Show the total to the user before paying.',
  inputSchema:{type:'object',properties:{product_id:uuidSchema,quantity:{type:'integer',minimum:1,maximum:10,default:1}},required:['product_id'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}},
 {name:'complete_checkout',title:'Pay for a quote',description:`Sensitive write: charges the quoted total with a Stripe Shared Payment Token. Ask the user to confirm the exact total first. One payment per quote; retrying the same quote never charges twice. Status: CONFIRMED (paid), PENDING (outcome not yet known, check order_status), FAILED (ask for another payment method and a new quote). ${LABEL}.`,
  inputSchema:{type:'object',properties:{quote_id:uuidSchema,shared_payment_token:{type:'string',pattern:'^spt_[A-Za-z0-9_]{1,200}$'}},required:['quote_id','shared_payment_token'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
 {name:'order_status',title:'Order status',description:'Status of an order: PENDING, CONFIRMED, FAILED, REFUNDING or CANCELLED, plus the pickup code and whether staff handed it over. Read only.',
  inputSchema:{type:'object',properties:{order_id:uuidSchema},required:['order_id'],additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'cancel_order',title:'Cancel and refund',description:`Write: cancels a paid order that staff have not handed over yet and refunds it in full through Stripe. ${LABEL}.`,
  inputSchema:{type:'object',properties:{order_id:uuidSchema},required:['order_id'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:true}},
] as const;

type Rpc={jsonrpc:'2.0';id?:string|number|null;method:string;params?:any};
const ok=(id:Rpc['id'],result:unknown)=>({jsonrpc:'2.0',id:id??null,result});
const err=(id:Rpc['id'],code:number,message:string)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});
const MESSAGES:Record<AgentOrderError['code'],string>={NOT_FOUND:'Not found.',OUT_OF_STOCK:'Not enough stock.',CURRENCY:'This price cannot be paid with Stripe.',
 BELOW_MINIMUM:'Total is below the Stripe minimum charge; order at the counter instead.',INVALID_INPUT:'Invalid arguments.',QUOTE_EXPIRED:'Quote expired; get a new quote.',
 PAYMENTS_UNAVAILABLE:'Payments are not configured.',NOT_CANCELLABLE:'Only a paid order that has not been handed over can be cancelled.',
 PAYMENT_FAILED:'Stripe refused the request.',PROVIDER_OUTCOME_UNKNOWN:'Stripe did not answer; the outcome is unknown. Retry the same call or check order_status.'};

/** One tool call. Errors become `isError` results so the agent can explain them to the user. */
export async function callTool(deps:AgentDeps,merchantId:string,name:string,args:any):Promise<{content:{type:'text';text:string}[];structuredContent?:unknown;isError?:boolean}>{
 const a=args&&typeof args==='object'?args:{};
 try{
  let out:unknown;
  if(name==='list_menu')out={items:await listMenu(deps,merchantId),label:LABEL};
  else if(name==='get_quote')out=await createQuote(deps,merchantId,'mcp',a.product_id,a.quantity??1);
  else if(name==='complete_checkout')out=await completeCheckout(deps,merchantId,a.quote_id,a.shared_payment_token);
  else if(name==='order_status')out=await orderStatus(deps,merchantId,a.order_id);
  else if(name==='cancel_order')out=await cancelOrder(deps,merchantId,a.order_id);
  else return {content:[{type:'text',text:`Unknown tool: ${String(name).slice(0,60)}`}],isError:true};
  return {content:[{type:'text',text:JSON.stringify(out)}],structuredContent:out};
 }catch(e){
  if(e instanceof AgentOrderError)return {content:[{type:'text',text:JSON.stringify({error:e.code,message:MESSAGES[e.code]})}],structuredContent:{error:e.code,message:MESSAGES[e.code]},isError:true};
  throw e;
 }
}

export async function handleRpc(deps:AgentDeps,merchantId:string,msg:unknown):Promise<object|null>{
 if(!msg||typeof msg!=='object'||Array.isArray(msg))return err(null,-32600,'Invalid Request');
 const m=msg as Rpc;
 if(m.jsonrpc!=='2.0'||typeof m.method!=='string')return err(m.id,-32600,'Invalid Request');
 const notification=m.id===undefined;
 if(m.method==='notifications/initialized'||m.method.startsWith('notifications/'))return null;
 if(notification)return null;
 if(m.method==='initialize'){
  const asked=m.params?.protocolVersion;
  return ok(m.id,{protocolVersion:MCP_PROTOCOL_VERSIONS.includes(asked)?asked:MCP_PROTOCOL_VERSIONS[0],capabilities:{tools:{listChanged:false}},
   serverInfo:{name:'bitpos-muse-connector',title:'BitPOS Muse Connector',version:'0.1.0'},
   instructions:`Order from this shop. Flow: list_menu → get_quote → show the total and ask the user to confirm → complete_checkout with a Shared Payment Token → order_status. Prices come only from quotes. ${LABEL}.`});
 }
 if(m.method==='ping')return ok(m.id,{});
 if(m.method==='tools/list')return ok(m.id,{tools:TOOLS});
 if(m.method==='tools/call'){
  const name=m.params?.name;
  if(typeof name!=='string')return err(m.id,-32602,'Invalid params');
  try{return ok(m.id,await callTool(deps,merchantId,name,m.params?.arguments));}
  catch{return err(m.id,-32603,'Internal error');}
 }
 return err(m.id,-32601,'Method not found');
}

/** POST /meta/mcp/<merchantId>. Returns false when the merchant is unknown (the caller answers 404). */
export async function serveMcp(req:http.IncomingMessage,res:http.ServerResponse,deps:AgentDeps,merchantId:string):Promise<boolean>{
 if(!(await deps.db.query('SELECT 1 FROM merchants WHERE id=$1',[merchantId])).rows.length)return false;
 const send=(status:number,body?:object)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...(status===405?{Allow:'POST'}:{})});res.end(body?JSON.stringify(body):undefined);};
 if(req.method!=='POST'){send(405,err(null,-32000,'Use POST (this server does not stream).'));return true;}
 // Agents call server to server. Any browser Origin (including DNS-rebinding pages) is refused.
 if(req.headers.origin!==undefined){send(403,err(null,-32000,'Browser origins are not allowed.'));return true;}
 const v=req.headers['mcp-protocol-version'];
 if(typeof v==='string'&&!MCP_PROTOCOL_VERSIONS.includes(v)){send(400,err(null,-32000,'Unsupported MCP-Protocol-Version'));return true;}
 const parts:Buffer[]=[];let bytes=0;
 for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_BODY){send(413,err(null,-32000,'Request too large'));return true;}parts.push(chunk);}
 let msg:unknown;try{msg=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{send(400,err(null,-32700,'Parse error'));return true;}
 const out=await handleRpc(deps,merchantId,msg);
 if(out===null){res.writeHead(202);res.end();return true;}
 send(200,out);return true;
}
