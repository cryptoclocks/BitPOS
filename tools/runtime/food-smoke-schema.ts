import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type pg from 'pg';
// A previously activated fixture must exactly match source; never silently run
// a new smoke against an old persisted schema. Fresh smoke DDL stays in rollback.
export async function foodSmokeMigration(db:pg.Client,name:string,probe:string){
 await db.query('SET LOCAL search_path=bitpos,public');
 const source=await readFile('supabase/migrations/'+name,'utf8');
 const installed=(await db.query('SELECT '+probe+' IS NOT NULL AS installed')).rows[0].installed;
 if(!installed){await db.query(source);return;}
 const row=(await db.query('SELECT source_sha256 FROM public.bitpos_migrations WHERE name=$1',[name])).rows[0];
 assert.equal(row?.source_sha256,createHash('sha256').update(source).digest('hex'),'Persisted fixture schema must match current '+name);
}
