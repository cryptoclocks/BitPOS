import { PlatformSession, PlatformError } from './platform-session';
export interface ShopCase { id: string; merchantId: string; subject: string; state: 'OPEN' | 'ANSWERED' | 'RESOLVED'; version: string; createdAt: string; updatedAt: string }
export interface ShopMessage { id: string; authorKind: 'SHOP' | 'STAFF'; body: string; createdAt: string }
export interface ShopSupportCommand { commandId: string; expectedVersion: string; action: 'REPLY' | 'RESOLVE' | 'REOPEN'; message: string; reason: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Platform staff answering shop requests. Same staff identity as the other platform consoles (mobile session); the server decides scope per shop.
export class ShopSupportSession extends PlatformSession {
  async list(merchantId: string, purpose: string): Promise<{ items: ShopCase[] }> {
    if (!uuid.test(merchantId)) throw new PlatformError('INVALID_REQUEST', 422);
    const owner = this.sessionOwner(); const result = await this.request('platform/merchant-support?' + new URLSearchParams({ queue: merchantId, purpose })); this.requireSessionOwner(owner); return result;
  }
  async read(id: string, purpose: string): Promise<{ ticket: ShopCase; messages: ShopMessage[] }> {
    const owner = this.sessionOwner(); const result = await this.request('platform/merchant-support/' + encodeURIComponent(id) + '?' + new URLSearchParams({ purpose })); this.requireSessionOwner(owner); return result;
  }
  async command(id: string, command: ShopSupportCommand): Promise<ShopCase> {
    const owner = this.sessionOwner(); const result = await this.request('platform/merchant-support/' + encodeURIComponent(id), command); this.requireSessionOwner(owner); return result;
  }
}
