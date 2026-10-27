import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const root=process.cwd(),temporary=await mkdtemp(resolve('.omp/work/flutter-delivery-20261016/union-smoke-'));
async function run(binary:string,args:string[]){const child=spawn(binary,args,{cwd:temporary,stdio:['ignore','pipe','pipe']}),output:Buffer[]=[];child.stdout.on('data',value=>output.push(value));child.stderr.on('data',value=>output.push(value));const [code]=await once(child,'exit');const text=Buffer.concat(output).toString();process.stdout.write(text);assert.equal(code,0,text);return text;}
try{
 for(const path of ['packages/openapi','packages/contracts/src','packages/mobile_shared/lib'])await mkdir(join(temporary,path),{recursive:true});
 const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties}),ref=(name:string)=>({$ref:'#/components/schemas/'+name});
 const spec={components:{schemas:{PrivacyNormal:object({access:{type:'string',enum:['NORMAL']},privateAddress:{type:'string',minLength:1}}),PrivacyRestricted:object({access:{type:'string',enum:['RESTRICTED']},custodyPhase:{type:'string',enum:['PREPICKUP','PICKED_UP']}}),PrivacyDuty:{oneOf:[ref('PrivacyNormal'),ref('PrivacyRestricted')],discriminator:{propertyName:'access'}},PrivacyWork:object({duty:ref('PrivacyDuty')})}}};
 await writeFile(join(temporary,'packages/openapi/mobile-v1.json'),JSON.stringify(spec));await run(resolve('node_modules/.bin/tsx'),[resolve('tools/runtime/generate-mobile-contracts.ts')]);
 await writeFile(join(temporary,'smoke.ts'),`import assert from 'node:assert/strict';import {PrivacyWorkSchema} from './packages/contracts/src/mobile-v1.generated';
const normal=PrivacyWorkSchema.parse({duty:{access:'NORMAL',privateAddress:'Synthetic private fixture'}});assert.equal(normal.duty.access,'NORMAL');
const restricted=PrivacyWorkSchema.parse({duty:{access:'RESTRICTED',custodyPhase:'PICKED_UP'}});assert.equal(restricted.duty.access,'RESTRICTED');
assert.equal(PrivacyWorkSchema.safeParse({duty:{access:'RESTRICTED',custodyPhase:'PICKED_UP',privateAddress:'forbidden'}}).success,false);
assert.equal(PrivacyWorkSchema.safeParse({duty:{access:'OTHER'}}).success,false);console.log('PASS_TS_TAGGED_PRIVACY_BOUNDARY');`);
 await run(resolve('node_modules/.bin/tsx'),['smoke.ts']);
 await writeFile(join(temporary,'smoke.dart'),`import 'packages/mobile_shared/lib/mobile_v1.generated.dart';
void main(){final normal=PrivacyWork.fromJson({'duty':{'access':'NORMAL','privateAddress':'Synthetic private fixture'}});if(normal.duty is! PrivacyNormal)throw StateError('Normal subtype lost');final restricted=PrivacyWork.fromJson({'duty':{'access':'RESTRICTED','custodyPhase':'PICKED_UP'}});if(restricted.duty is! PrivacyRestricted)throw StateError('Restricted custody subtype lost');var denied=0;for(final value in [{'access':'RESTRICTED','custodyPhase':'PICKED_UP','privateAddress':'forbidden'},{'access':'OTHER'}]){try{PrivacyDuty.fromJson(value);}on FormatException{denied++;}}if(denied!=2)throw StateError('Private payload/tag accepted');print('PASS_DART_SEALED_PRIVACY_BOUNDARY');}`);
 await run('/Users/cryptoclock/development/flutter/bin/dart',['run','smoke.dart']);
 await writeFile(resolve('.omp/work/flutter-delivery-20261016/evidence/dispatch078-generated-privacy-union-smoke-20261018.json'),JSON.stringify({status:'PASS_GENERATED_TS_DART_TAGGED_PRIVACY_BOUNDARY',checks:['Actual generated TS parses both legal variants and rejects restricted private address and unknown tag','Actual generated Dart sealed subtype dispatch parses both legal variants and rejects restricted private address and unknown tag'],limits:['Isolated contract-generator fixture, not active-driver privacy/API/native acceptance'],physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');
}finally{await rm(temporary,{recursive:true,force:true});}
