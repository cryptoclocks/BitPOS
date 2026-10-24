import {PlatformSession,PlatformError} from './platform-session';
import {MobileSupportStaffCasesSchema,MobileSupportStaffDetailSchema,MobileSupportStaffCommandSchema,MobileSupportStaffCaseSchema} from '../../../../packages/contracts/src/mobile-v1.generated';
import type {MobileSupportStaffCommand} from '../../../../packages/contracts/src/mobile-v1.generated';
export interface PendingSupportCommand{caseId:string;command:MobileSupportStaffCommand}
export class SupportSession extends PlatformSession{
 private key(){if(!this.accountId)throw new PlatformError('AUTH_REQUIRED',401);return 'bitpos.platform.support.'+this.accountId;}
 pendingSupport():PendingSupportCommand|null{const raw=localStorage.getItem(this.key());if(!raw)return null;const saved=JSON.parse(raw);if(!saved||typeof saved.caseId!=='string'||!/^[0-9a-f-]{36}$/i.test(saved.caseId)||Object.keys(saved).length!==2)throw new PlatformError('INVALID_SAVED_COMMAND',409);return{caseId:saved.caseId,command:MobileSupportStaffCommandSchema.parse(saved.command)};}
 async list(queue:string,purpose:string,cursor:string|null=null){const owner=this.sessionOwner(),query=new URLSearchParams({queue,purpose,...(cursor?{cursor}:{})});const result=MobileSupportStaffCasesSchema.parse(await this.request('platform/support?'+query));this.requireSessionOwner(owner);return result;}
 async read(id:string,purpose:string,cursor:string|null=null){const owner=this.sessionOwner(),query=new URLSearchParams({purpose,...(cursor?{cursor}:{})});const result=MobileSupportStaffDetailSchema.parse(await this.request('platform/support/'+encodeURIComponent(id)+'?'+query));this.requireSessionOwner(owner);return result;}
 async command(caseId:string,command:MobileSupportStaffCommand){
  const owner=this.sessionOwner(),key=this.key();
  if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('BROWSER_LOCK_REQUIRED',409);
  return navigator.locks.request(key,async()=>{this.requireSessionOwner(owner);const value={caseId,command:MobileSupportStaffCommandSchema.parse(command)},encoded=JSON.stringify(value),pending=this.pendingSupport();
  if(pending&&JSON.stringify(pending)!==encoded)throw new PlatformError('PENDING_COMMAND',409);localStorage.setItem(key,encoded);
  try{const receipt=MobileSupportStaffCaseSchema.parse(await this.request('platform/support/'+encodeURIComponent(caseId),value.command));this.requireSessionOwner(owner);if(receipt.id!==caseId)throw new PlatformError('INVALID_RECEIPT',409);localStorage.removeItem(key);return receipt;}
  catch(error){this.requireSessionOwner(owner);if(error instanceof PlatformError&&['VERSION_CONFLICT','INVALID_REQUEST'].includes(error.code))localStorage.removeItem(key);throw error;}
  });
 }
}
