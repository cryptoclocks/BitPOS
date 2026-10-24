import test from 'node:test';import assert from 'node:assert/strict';
import {localApiOrigin} from '../apps/web/src/lib/api-origin';
test('server-configured loopback origin keeps production default and supports isolated fixtures',()=>{
 assert.equal(localApiOrigin(undefined),'http://127.0.0.1:3001');
 for(const url of ['http://127.0.0.1:3022','http://localhost:3022/','http://[::1]:3022'])assert.equal(localApiOrigin(url),new URL(url).origin);
});
test('upstream config refuses remote hosts, credentials and path/query injection',()=>{
 for(const url of ['', 'https://127.0.0.1:3022','http://127.0.0.1.evil.test','http://user:secret@127.0.0.1:3022','http://127.0.0.1:3022/api','http://127.0.0.1:3022/?override=1','http://127.0.0.1:3022/#x','file:///tmp/server'])assert.throws(()=>localApiOrigin(url));
});
