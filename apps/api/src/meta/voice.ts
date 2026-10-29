// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Speech to text for voice ordering with Muse Voice Transcribe (dev.meta.ai/docs/api-reference/voice/transcribe):
// the browser records a short push-to-talk clip as 16 kHz mono PCM WAV and posts it here; the server checks the WAV
// header and forwards it once to POST /v1/asr/transcribe with the menu names as keyword bias. Only the transcript
// comes back to the page (it then goes through the same ordering agent as typed text). Audio is never stored.
import {randomUUID} from 'node:crypto';

export interface AsrConfig {baseUrl:string;apiKey:string;model:string;timeoutMs?:number}
export type AsrFetch=(input:string,init:RequestInit)=>Promise<Response>;
export class AsrError extends Error {constructor(readonly code:'AUDIO_INVALID'|'UNAVAILABLE'|'RATE_LIMITED'|'FAILED'){super(code);}}

/** 45 s of 16 kHz 16-bit mono plus header; the page stops recording well before this. */
export const MAX_WAV_BYTES=45*16000*2+44;

export function asrConfigFromEnv(env:Record<string,string|undefined>):AsrConfig|null{
 const baseUrl=(env.META_AI_META_API_URL??'').replace(/\/+$/,''),apiKey=env.META_AI_META_API_KEY;
 if(!apiKey||!/^https:\/\/[^/?#@]+(\/[^?#@]*)?$/.test(baseUrl))return null;
 return {baseUrl,apiKey,model:env.META_AI_VOICE_MODEL||'muse-voice-transcribe-1.0'};
}

/** RIFF/WAVE, integer PCM, mono, 16 or 24 kHz (the documented requirements). */
export function wavValid(b:Buffer):boolean{
 if(b.length<46||b.length>MAX_WAV_BYTES||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')return false;
 let o=12;
 while(o+8<=b.length){
  const id=b.toString('ascii',o,o+4),size=b.readUInt32LE(o+4);
  if(id==='fmt '){if(o+24>b.length)return false;
   const format=b.readUInt16LE(o+8),channels=b.readUInt16LE(o+10),rate=b.readUInt32LE(o+12),bits=b.readUInt16LE(o+22);
   return format===1&&channels===1&&(rate===16000||rate===24000)&&(bits===16||bits===8||bits===24||bits===32);}
  o+=8+size+(size&1);
 }
 return false;
}

export interface Turn {speaker:string;transcript:string}
/** mode DIARIZATION also returns who said what (turns with speaker labels), for ordering for a whole table. */
export async function transcribe(config:AsrConfig,wav:Buffer,keywords:string[],fetchImpl:AsrFetch=fetch,mode:'PUSH_TO_TALK'|'DIARIZATION'='PUSH_TO_TALK'):Promise<{transcript:string;durationMs:number;sessionId:string;turns:Turn[]}>{
 if(!wavValid(wav))throw new AsrError('AUDIO_INVALID');
 const form=new FormData();
 form.append('request',new Blob([JSON.stringify({model:config.model,audioEncoding:'WAV',mode,languageBias:['Thai','English'],
  keywords:[...new Set(keywords.map(k=>k.trim()).filter(k=>k&&k.length<=40))].slice(0,40)})],{type:'application/json'}));
 form.append('audio',new Blob([new Uint8Array(wav)],{type:'audio/wav'}),'order.wav');
 const sessionId=randomUUID();
 let res:Response;
 try{res=await fetchImpl(`${config.baseUrl}/asr/transcribe?sessionId=${sessionId}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(config.timeoutMs??20000),
  headers:{Authorization:`Bearer ${config.apiKey}`,Accept:'application/json'},body:form});}
 catch{throw new AsrError('UNAVAILABLE');}
 if(res.status===429)throw new AsrError('RATE_LIMITED');
 if(res.status===400||res.status===413)throw new AsrError('AUDIO_INVALID');
 if(!res.ok)throw new AsrError('FAILED');
 let body:any;try{body=await res.json();}catch{throw new AsrError('FAILED');}
 if(typeof body?.transcript!=='string')throw new AsrError('FAILED');
 const turns=(Array.isArray(body.turns)?body.turns:[]).slice(0,40).flatMap((t:any)=>typeof t?.transcript==='string'&&t.transcript.trim()?[{speaker:String(t.speaker??'unknown').slice(0,20),transcript:t.transcript.trim().slice(0,300)}]:[]);
 return {transcript:body.transcript.trim().slice(0,mode==='DIARIZATION'?2000:300),durationMs:Number(body.audioDurationMs)||0,sessionId,turns};
}
