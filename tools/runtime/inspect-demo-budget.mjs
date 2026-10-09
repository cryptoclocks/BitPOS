import 'dotenv/config';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Connection,PublicKey} from '@solana/web3.js';
import {TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import pg from 'pg';
const vault='/Users/cryptoclock/Desktop/BitPOS-Devnet-Private';
assert.equal(path.resolve(process.env.DEVNET_PRIVATE_DIR||''),vault);
const chain=new Connection('https://api.devnet.solana.com','finalized');
assert.equal(await chain.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const manifest=JSON.parse(fs.readFileSync(path.join(vault,'wallets.public.json'),'utf8'));
const mint=new PublicKey('4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7');
const balances=[];
for(const id of ['fee-sponsor','customer-no-sol','merchant-a-treasury']){
 const role=manifest.wallets.find(wallet=>wallet.id===id);assert.ok(role);
 const owner=new PublicKey(role.address);const sol=await chain.getBalance(owner,'finalized');
 const token=id==='fee-sponsor'?null:(await chain.getTokenAccountBalance(getAssociatedTokenAddressSync(mint,owner,false,TOKEN_2022_PROGRAM_ID),'finalized')).value.amount;
 balances.push({role:id,lamports:sol,usdgMinor:token});
}
const journal=fs.readFileSync(path.join(vault,'activity.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});
await db.connect();
const pending=(await db.query("SELECT count(*)::int AS count FROM bitpos.payment_attempts WHERE signed_base64 IS NOT NULL AND status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')")).rows[0];
await db.end();
const evidence={origin:'read_only_finalized_devnet_balance_and_private_journal_count',at:new Date().toISOString(),genesisVerified:true,balances,journalEntriesInspected:journal.length,pendingSignedAttempts:pending.count,transactionsSubmitted:0,scope:'Read-only preparation; not new payment, budget authorization or physical latency proof'};
fs.writeFileSync('.omp/work/evidence/current-demo-budget.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
