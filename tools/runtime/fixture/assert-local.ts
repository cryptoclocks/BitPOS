import assert from'node:assert/strict';import type pg from'pg';
/** Match current connected server, not a caller label or a historical PID. */
export async function assertLocalFoodFixture(db:pg.Client){
 const row=(await db.query('SELECT current_database() name,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
 assert.equal(row.host,'127.0.0.1');
 assert.ok(row.name==='bitpos_w01_fixture'&&row.port===55446||row.name==='bitpos_delivery_fixture'&&[55436,55440].includes(row.port),'Only connected named local disposable food fixture allowed');
}
