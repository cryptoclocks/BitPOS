import {mobilePrincipal} from './mobile-auth';
import {fail} from './authority';
import {cancelGroup,createGroup,currentGroups,getGroup,inviteGroup,joinGroup,leaveGroup,lockGroup,removeLine,setMyLine} from './group-carts';

// /api/mobile/v1/groups: shared group carts (selection intents only; no price, payment or order).
export async function mobileGroupRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const path=url.pathname,base='/api/mobile/v1/groups';
 if(path!==base&&!path.startsWith(base+'/'))return undefined;
 if(url.search)fail('INVALID_REQUEST',422);
 const actor=await mobilePrincipal(bearer);
 const rest=path.slice(base.length).split('/').filter(Boolean);
 if(!rest.length){if(method==='POST')return createGroup(actor.accountId);if(method==='GET')return currentGroups(actor.accountId);fail('INVALID_REQUEST',405);}
 if(rest.length===1&&rest[0]==='join'){if(method!=='POST')fail('INVALID_REQUEST',405);return joinGroup(actor.accountId,(input as {token?:unknown}|null)?.token);}
 const [id,action,member]=rest;
 if(rest.length===1){if(method!=='GET')fail('INVALID_REQUEST',405);return getGroup(actor.accountId,id);}
 if(method!=='POST')fail('INVALID_REQUEST',405);
 if(rest.length===2)switch(action){
  case 'invite':return inviteGroup(actor.accountId,id);
  case 'lines':return setMyLine(actor.accountId,id,input);
  case 'lock':return lockGroup(actor.accountId,id,input);
  case 'cancel':return cancelGroup(actor.accountId,id);
  case 'leave':return leaveGroup(actor.accountId,id);
 }
 if(rest.length===3&&action==='members')return removeLine(actor.accountId,id,member,input);
 fail('RESOURCE_NOT_FOUND',404);
}
