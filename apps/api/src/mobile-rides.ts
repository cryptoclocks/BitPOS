import {mobilePrincipal} from './mobile-auth';
import {fail} from './authority';
import {rideLocation,setRideLocationConsent,sendRideLocation,currentTrip,incidentQueue,reviewIncident,activeFare,publishFare,acceptTrip,arriveTrip,cancelTrip,completeTrip,getTrip,openTrips,quoteTrip,reportIncident,requestTrip,revokeShares,sharedTripView,shareTrip,startTrip} from './passenger-trips';

// /api/mobile/v1/rides: quote/request/read/cancel for riders; open/accept/arrive/start/complete for approved drivers.
// Returns undefined when the path is not a ride route so the mobile dispatcher can continue.
export async function mobileRideRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const path=url.pathname;
 const base='/api/mobile/v1/rides';
 if(path!==base&&!path.startsWith(base+'/'))return undefined;
 if(url.search)fail('INVALID_REQUEST',422);
 const rest=path.slice(base.length).split('/').filter(Boolean);
 // Share-link holders need no account: they get trip state only, behind an unguessable expiring token.
 if(rest.length===2&&rest[0]==='shared'){if(method!=='GET')fail('INVALID_REQUEST',405);return sharedTripView(rest[1]);}
 const actor=await mobilePrincipal(bearer);
 if(!rest.length){if(method!=='POST')fail('INVALID_REQUEST',405);return requestTrip(actor.accountId,input);}
 if(rest.length===1&&rest[0]==='incidents'){if(method!=='GET')fail('INVALID_REQUEST',405);return incidentQueue(actor.accountId);}
 if(rest.length===3&&rest[0]==='incidents'&&rest[2]==='review'){if(method!=='POST')fail('INVALID_REQUEST',405);return reviewIncident(actor.accountId,rest[1],input);}
 if(rest.length===1&&rest[0]==='fare'){if(method==='GET')return activeFare(actor.accountId);if(method==='PUT')return publishFare(actor.accountId,input);fail('INVALID_REQUEST',405);}
 if(rest.length===1&&rest[0]==='quote'){if(method!=='POST')fail('INVALID_REQUEST',405);return quoteTrip(actor.accountId,input);}
 if(rest.length===1&&rest[0]==='current'){if(method!=='GET')fail('INVALID_REQUEST',405);return currentTrip(actor.accountId);}
 if(rest.length===1&&rest[0]==='open'){if(method!=='GET')fail('INVALID_REQUEST',405);return {trips:await openTrips(actor.accountId)};}
 const [id,action]=rest;
 if(rest.length===2&&action==='location'){if(method==='GET')return rideLocation(actor.accountId,id);if(method==='POST')return sendRideLocation(actor.accountId,id,input);fail('INVALID_REQUEST',405);}
 if(rest.length===3&&action==='location'&&rest[2]==='consent'){if(method!=='PUT')fail('INVALID_REQUEST',405);return setRideLocationConsent(actor.accountId,id,input);}
 if(rest.length===1){if(method!=='GET')fail('INVALID_REQUEST',405);return getTrip(actor.accountId,id);}
 if(rest.length===3&&method==='POST'&&action==='share'&&rest[2]==='revoke')return revokeShares(actor.accountId,id);
 if(rest.length!==2||method!=='POST')fail('RESOURCE_NOT_FOUND',404);
 switch(action){
  case 'share':return shareTrip(actor.accountId,id);
  case 'incidents':return reportIncident(actor.accountId,id,input);
  case 'accept':return acceptTrip(actor.accountId,id);
  case 'arrive':return arriveTrip(actor.accountId,id);
  case 'start':return startTrip(actor.accountId,id,(input as {pin?:unknown}|null)?.pin);
  case 'complete':return completeTrip(actor.accountId,id);
  case 'cancel':return cancelTrip(actor.accountId,id);
  default:fail('RESOURCE_NOT_FOUND',404);
 }
}
