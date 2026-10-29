import {isIP} from 'node:net';
import type {IncomingMessage} from 'node:http';
import {RequestError} from './authority';

const trustedPeers=(process.env.BITPOS_MOBILE_TRUSTED_PROXIES??'').split(',').filter(Boolean);
if(trustedPeers.some(peer=>!isIP(peer)))throw Error('Mobile trusted proxy configuration requires exact IP addresses');

// The configured ingress must strip caller forwarding headers and supply exactly
// one original client IP. No arbitrary chain parsing or trust-by-header-presence.
export function mobileClientAddress(req:Pick<IncomingMessage,'socket'|'headers'>):string {
 const peer=req.socket.remoteAddress;
 if(!peer||!isIP(peer))throw new RequestError(503,'CONFIGURATION_REQUIRED','Mobile client address unavailable');
 if(!trustedPeers.includes(peer))return peer;
 const forwarded=req.headers['x-bitpos-client-ip'];
 if(typeof forwarded!=='string'||!isIP(forwarded))throw new RequestError(503,'CONFIGURATION_REQUIRED','Trusted mobile ingress client address missing');
 return forwarded;
}
