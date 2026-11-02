import assert from 'node:assert/strict';
import test from 'node:test';
import {advanceChannelStatus,capabilitiesFor,channelEventKey,isExternalSource,unmappedLines,CHANNEL_ORDER_STATUSES,type ChannelOrderLine} from '../packages/contracts/src/order-channels';

const money={currency:'THB',decimals:2,amountMinor:'5000'};
const line=(mapped:string|null):ChannelOrderLine=>({externalItemId:'x',name:'n',qty:1,unitPrice:money,externalModifiers:[],mappedProductId:mapped});

test('no provider capability is claimed before provider access is proven',()=>{
 for(const s of ['grabfood','lineman'] as const)for(const st of ['awaiting_provider_access','credentials_saved','credentials_missing','linked','disconnected','revoked'] as const)
  assert.ok(Object.values(capabilitiesFor(s,st,'fixture')).every(v=>v===false),`${s}/${st}`);
});
test('status never moves backwards and terminal states are final',()=>{
 assert.equal(advanceChannelStatus('preparing','accepted'),'preparing');
 assert.equal(advanceChannelStatus('accepted','ready'),'ready');
 assert.equal(advanceChannelStatus('ready','ready'),'ready');
 assert.equal(advanceChannelStatus('cancelled','ready'),'cancelled');
 assert.equal(advanceChannelStatus('completed','cancelled'),'completed');
 assert.equal(advanceChannelStatus('preparing','cancelled'),'cancelled');
 assert.equal(advanceChannelStatus('ready','needs_attention'),'ready');
 assert.equal(advanceChannelStatus('needs_attention','accepted'),'accepted');
});
test('accept_pending resolves only forward, and every pair is defined',()=>{
 assert.equal(advanceChannelStatus('accept_pending','received'),'accept_pending');
 assert.equal(advanceChannelStatus('accept_pending','accepted'),'accepted');
 for(const a of CHANNEL_ORDER_STATUSES)for(const b of CHANNEL_ORDER_STATUSES)assert.ok(CHANNEL_ORDER_STATUSES.includes(advanceChannelStatus(a,b)));
});
test('unmapped lines are reported, never matched by name',()=>{
 assert.equal(unmappedLines([line('p1'),line(null)]).length,1);
});
test('event key separates tenant-relevant identity parts',()=>{
 const base={source:'grabfood' as const,environment:'fixture' as const,externalStoreId:'s',externalOrderId:'o',externalEventId:'e'};
 assert.notEqual(channelEventKey(base),channelEventKey({...base,environment:'sandbox'}));
 assert.notEqual(channelEventKey(base),channelEventKey({...base,externalStoreId:'s|o'}));
 assert.equal(channelEventKey(base),channelEventKey({...base}));
 assert.ok(isExternalSource('lineman')&&!isExternalSource('bitpos'));
});
