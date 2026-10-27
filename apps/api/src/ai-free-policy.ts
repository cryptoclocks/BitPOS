import type pg from 'pg';
export async function reserveAiFree(db:pg.PoolClient,merchant:string,requestId:string,purpose:'copilot'|'transcribe'|'promotion',visitId:string|null,inputHash:string){return (await db.query('SELECT bitpos.reserve_ai_free($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text) AS admitted',[merchant,requestId,purpose,visitId,inputHash])).rows[0].admitted===true;}
