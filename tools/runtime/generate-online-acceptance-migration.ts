import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Preserve the complete canonical settlement/wire projection while making the
// acceptance policy explicit. The generated migration is checked into source.
const source=await readFile('supabase/migrations/051_online_order_authority.sql','utf8');
const start=source.indexOf('CREATE OR REPLACE FUNCTION bitpos.settle_verified_attempt(');
const end=source.indexOf('GRANT EXECUTE ON FUNCTION bitpos.settle_verified_attempt(uuid,uuid,uuid,boolean) TO bitpos_app;',start);
assert(start>=0&&end>start);
let settlement=source.slice(start,end)+'GRANT EXECUTE ON FUNCTION bitpos.settle_verified_attempt(uuid,uuid,uuid,boolean) TO bitpos_app;\n';
function replaceOnce(old:string,next:string){assert.equal(settlement.split(old).length,2,'Canonical settlement anchor changed');settlement=settlement.replace(old,next);}
replaceOnce("OR v_order.status IN ('PAID','RECOVERY');","OR v_order.status IN ('PAID','RECOVERY')\n            OR bitpos.online_acceptance_ended(p_merchant,p_order);");
replaceOnce("  RETURN;\n END IF;\n\n SELECT * INTO v_asset", "  PERFORM bitpos.ensure_online_decision_refunds(p_merchant,p_order);\n  RETURN;\n END IF;\n\n SELECT * INTO v_asset");
replaceOnce(" updated_order := v_order;", " PERFORM bitpos.ensure_online_decision_refunds(p_merchant,p_order);\n updated_order := v_order;");
const policy=await readFile('tools/runtime/online-acceptance-policy.sql','utf8');
const closure=await readFile('tools/runtime/online-closure-policy.sql','utf8');
const refundInvariants=await readFile('tools/runtime/online-refund-invariants.sql','utf8');
const expected=policy+'\n'+closure+'\n'+refundInvariants+'\n'+settlement;
const path='supabase/migrations/055_online_acceptance_decisions.sql';
if(process.argv.includes('--check'))assert.equal(await readFile(path,'utf8'),expected,'Acceptance migration differs from generator');
else await writeFile(path,expected);
console.log(process.argv.includes('--check')?'Acceptance migration matches canonical generator':'Generated acceptance migration');
