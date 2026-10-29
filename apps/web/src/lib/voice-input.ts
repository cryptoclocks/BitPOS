export type VoiceState='idle'|'permission'|'listening'|'processing';
interface Recognition {lang:string;continuous:boolean;interimResults:boolean;onresult:((e:{results:ArrayLike<ArrayLike<{transcript:string}>>})=>void)|null;onerror:((e:{error:string})=>void)|null;onend:(()=>void)|null;start():void;stop():void;abort():void;}
type VoiceWindow=Window&{SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
export interface VoiceCallbacks {state:(state:VoiceState)=>void;transcript:(text:string)=>void;audio:(blob:Blob,durationMs:number)=>Promise<void>;error:(message:string)=>void;}
export interface VoiceInput {start:(language:'th'|'en',forceRecorder?:boolean)=>Promise<void>;stop:()=>void;cancel:()=>void;dispose:()=>void;}
/** Explicit tap-owned session; cleanup cancels callbacks and all media tracks. */
export function createVoiceInput(callbacks:VoiceCallbacks):VoiceInput{
 let disposed=false,epoch=0,recognition:Recognition|null=null,recorder:MediaRecorder|null=null,stream:MediaStream|null=null,timer:ReturnType<typeof setTimeout>|undefined;let heard=false;
 function release(){clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;}
 function cancel(){epoch++;recognition?.abort();recognition=null;if(recorder&&recorder.state!=='inactive')recorder.stop();recorder=null;release();if(!disposed)callbacks.state('idle');}
 async function fallback(){const token=epoch;callbacks.state('permission');
  try{if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('Microphone unsupported. Type your request / กรุณาพิมพ์คำสั่ง');
   const media=await navigator.mediaDevices.getUserMedia({audio:true});if(disposed||token!==epoch){media.getTracks().forEach(t=>t.stop());return;}stream=media;
   const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus'].find(m=>MediaRecorder.isTypeSupported(m));if(!mime)throw Error('Supported Opus recording unavailable. Type your request / บันทึกเสียง Opus ไม่รองรับ กรุณาพิมพ์คำสั่ง');
   const chunks:Blob[]=[];let bytes=0;const r=new MediaRecorder(media,{mimeType:mime});recorder=r;const started=performance.now();
   const current=()=>!disposed&&token===epoch&&recorder===r;
   r.ondataavailable=e=>{if(!current())return;bytes+=e.data.size;if(bytes>2097152){cancel();callbacks.error('Recording too large. Try a shorter request / ลองพูดให้สั้นลง');return;}if(e.data.size)chunks.push(e.data);};
   r.onerror=()=>{if(!current())return;cancel();callbacks.error('Recording failed. Type or try again / กรุณาพิมพ์หรือลองใหม่');};
   r.onstop=()=>{media.getTracks().forEach(t=>t.stop());if(!current())return;clearTimeout(timer);stream=null;recorder=null;const duration=Math.min(20000,Math.ceil(performance.now()-started));const blob=new Blob(chunks,{type:mime});if(!blob.size){callbacks.state('idle');callbacks.error('No speech captured / ไม่พบเสียงพูด');return;}callbacks.state('processing');void callbacks.audio(blob,duration).catch(e=>{if(!disposed&&token===epoch)callbacks.error(e instanceof Error?e.message:'Transcription failed');}).finally(()=>{if(!disposed&&token===epoch)callbacks.state('idle');});};
   r.start(250);callbacks.state('listening');timer=setTimeout(()=>{if(current())stop();},20000);
  }catch(e){if(disposed||token!==epoch)return;release();callbacks.state('idle');callbacks.error(e instanceof Error?e.message:'Microphone permission denied / ไม่อนุญาตไมโครโฟน');}
 }
 function stop(){clearTimeout(timer);if(!recognition&&!recorder){cancel();return;}if(recognition)recognition.stop();if(recorder&&recorder.state!=='inactive')recorder.stop();stream?.getTracks().forEach(t=>t.stop());}
 async function start(language:'th'|'en',forceRecorder=false){cancel();if(!window.isSecureContext){callbacks.error('Microphone requires HTTPS / ไมโครโฟนต้องใช้ HTTPS');return;}const token=epoch;heard=false;const Constructor=(window as VoiceWindow).SpeechRecognition??(window as VoiceWindow).webkitSpeechRecognition;
  if(!Constructor||forceRecorder){await fallback();return;}
  const r=new Constructor();recognition=r;r.lang=language==='th'?'th-TH':'en-US';r.continuous=false;r.interimResults=false;
  r.onresult=e=>{if(disposed||token!==epoch)return;const text=Array.from(e.results).map(row=>row[0]?.transcript??'').join(' ').trim();if(text){heard=true;callbacks.transcript(text);}};
  r.onerror=e=>{if(disposed||token!==epoch)return;cancel();callbacks.error(e.error==='not-allowed'?'Microphone permission denied. Type instead / กรุณาอนุญาตไมโครโฟนหรือพิมพ์':'Speech recognition unavailable. Tap Record audio / แตะบันทึกเสียงแทน');};
  r.onend=()=>{if(disposed||token!==epoch)return;recognition=null;clearTimeout(timer);callbacks.state('idle');if(!heard)callbacks.error('No clear speech. Try Record audio or type / ลองบันทึกเสียงหรือพิมพ์');};
  try{r.start();callbacks.state('listening');timer=setTimeout(stop,20000);}catch{cancel();await fallback();}
 }
 return {start,stop,cancel,dispose(){disposed=true;cancel();}};
}
export async function audioBase64(blob:Blob){const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(binary);}
