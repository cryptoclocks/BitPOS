import {createSettlementFundingRuntime} from '../apps/worker/src/settlement-funding-runtime';
// Deliberately not a public HTTP endpoint. Runtime uses only its dedicated DB/RPC
// environment; importing this command never loads root dotenv or signing keys.
const args=process.argv.slice(2);
if(args.length!==3){console.error('Usage: npx tsx tools/record-settlement-funding.ts <config-id> <expected-config-version> <finalized-signature>');process.exitCode=2;}
else{
 let runtime:ReturnType<typeof createSettlementFundingRuntime>|undefined;
 try{
  runtime=createSettlementFundingRuntime();
  const result=await runtime.recorder.record({configId:args[0],expectedConfigVersion:args[1],signature:args[2]});
  console.log(JSON.stringify(result));if(result.status!=='RECORDED')process.exitCode=2;
 }catch{console.error(JSON.stringify({status:'REJECTED',reason:'FUNDING_INGESTION_FAILED'}));process.exitCode=1;}
 finally{await runtime?.close();}
}
