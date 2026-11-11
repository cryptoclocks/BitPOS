// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// HTTP routes for PayPal, wired into the API server chain like serveX402. Customer routes are keyed by the bill's
// access token (same authority as the existing /api/pay/:token routes).
//   GET  /api/pay/:token/paypal          status + client id + amount (no PayPal call)
//   POST /api/pay/:token/paypal/orders   create or return the live PayPal order for this bill
//   POST /api/pay/:token/paypal/capture  {paypalOrderId} after the buyer approved in PayPal
//   POST /api/pay/:token/paypal/cancel   {paypalOrderId} the buyer closed PayPal
//   POST /paypal/webhooks                PayPal notifications (signature-verified, see webhook.ts)
//   GET|POST /paypal/messenger/webhook   Messenger ordering (signature-verified, see messenger.ts)
import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {RequestError} from '../authority';
import {PayPalRouteError,paypalStatus,createPayPalOrder,capturePayPalOrder,cancelPayPalOrder} from './checkout';
import {servePayPalWebhook} from './webhook';
import {serveMessengerWebhook} from './messenger';

const ROUTE=/^\/api\/pay\/([A-Za-z0-9_-]{20,128})\/paypal(?:\/(orders|capture|cancel))?$/;
const orderBody=z.object({paypalOrderId:z.string().regex(/^[A-Z0-9]{10,30}$/)}).strict();
function json(res:ServerResponse,status:number,value:unknown){res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));}
async function readJson(req:IncomingMessage,limit=1024):Promise<unknown>{
 let size=0;const chunks:Buffer[]=[];
 for await(const chunk of req){size+=chunk.length;if(size>limit)throw new PayPalRouteError(413,'REQUEST_TOO_LARGE');chunks.push(Buffer.from(chunk));}
 const text=Buffer.concat(chunks).toString('utf8');return text?JSON.parse(text):{};
}

export async function servePayPal(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
 if(await servePayPalWebhook(req,res))return true;
 if(await serveMessengerWebhook(req,res))return true;
 const url=new URL(req.url??'/','http://localhost');const m=url.pathname.match(ROUTE);
 if(!m)return false;
 try{
  if(url.search)throw new PayPalRouteError(404,'RESOURCE_NOT_FOUND');
  const [,token,action]=m;
  if(!action){if(req.method!=='GET')throw new PayPalRouteError(405,'METHOD_NOT_ALLOWED');json(res,200,await paypalStatus(token));return true;}
  if(req.method!=='POST')throw new PayPalRouteError(405,'METHOD_NOT_ALLOWED');
  if(action==='orders'){z.object({}).strict().parse(await readJson(req));json(res,200,await createPayPalOrder(token));return true;}
  const {paypalOrderId}=orderBody.parse(await readJson(req));
  json(res,200,action==='capture'?await capturePayPalOrder(token,paypalOrderId):await cancelPayPalOrder(token,paypalOrderId));
 }catch(error){
  if(error instanceof PayPalRouteError)json(res,error.status,{error:error.code});
  else if(error instanceof RequestError)json(res,error.status,{error:error.code});
  else if(error instanceof z.ZodError||error instanceof SyntaxError)json(res,422,{error:'INVALID_REQUEST'});
  else if((error as {code?:string}).code==='55P03')json(res,409,{error:'PAYMENT_PENDING'});
  else{console.error('PayPal route failed',(error as Error).message);json(res,503,{error:'PAYPAL_UNAVAILABLE'});}
 }
 return true;
}
