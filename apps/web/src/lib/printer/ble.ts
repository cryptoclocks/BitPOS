import { PERIPAGE_A9SMAX } from './peripage';
import type { PrintTransport } from './queue';

// Web Bluetooth transport for the PeriPage A9s MAX. Works in Chromium-based browsers (Chrome, Edge) on Windows, macOS, Linux, ChromeOS
// and Android over HTTPS or localhost. Safari, iOS browsers and Firefox have no Web Bluetooth: use the print bridge described in
// docs/THERMAL_PRINTER_TH.md or the normal browser print dialog there.
interface Char { writeValueWithoutResponse(value: BufferSource): Promise<void>; startNotifications(): Promise<Char>; addEventListener(type: string, fn: (e: { target: { value?: DataView } }) => void): void; removeEventListener(type: string, fn: (e: { target: { value?: DataView } }) => void): void }
interface Server { connected: boolean; connect(): Promise<Server>; disconnect(): void; getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Char> }> }
export interface BtDevice { id: string; name?: string; gatt?: Server; forget?: () => Promise<void>; addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void }
interface BtApi { requestDevice(options: unknown): Promise<BtDevice>; getDevices?: () => Promise<BtDevice[]> }

const api = (): BtApi | undefined => (typeof navigator === 'undefined' ? undefined : (navigator as unknown as { bluetooth?: BtApi }).bluetooth);
export const bluetoothSupported = () => typeof window !== 'undefined' && window.isSecureContext && !!api();
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const P = PERIPAGE_A9SMAX;

export type LinkState = 'unsupported' | 'idle' | 'connecting' | 'connected' | 'lost';

export class WebBluetoothPrinter implements PrintTransport {
  private device?: BtDevice; private tx?: Char; private rx?: Char; private link: LinkState = bluetoothSupported() ? 'idle' : 'unsupported'; private listeners = new Set<() => void>();
  notifications: string[] = [];
  private onDisconnect = () => { this.tx = this.rx = undefined; this.setLink('lost'); };
  private onNotify = (e: { target: { value?: DataView } }) => { const v = e.target.value; if (v) { this.notifications.push(Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), b => b.toString(16).padStart(2, '0')).join('')); if (this.notifications.length > 20) this.notifications.shift(); } };
  state() { return this.link; } name() { return this.device?.name ?? ''; } deviceId() { return this.device?.id ?? ''; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private setLink(s: LinkState) { this.link = s; for (const fn of this.listeners) fn(); }

  /** Browser device chooser; must run from a click. By default only devices named PeriPage* are offered. */
  async choose(all = false): Promise<{ id: string; name: string }> {
    const bt = api(); if (!bt) throw new Error('BLUETOOTH_UNSUPPORTED');
    const device = await bt.requestDevice(all ? { acceptAllDevices: true, optionalServices: [P.service] } : { filters: [{ namePrefix: P.btNamePrefix }], optionalServices: [P.service] });
    this.attach(device); return { id: device.id, name: device.name ?? '' };
  }
  /** Re-finds a device the browser already remembers for this site (Chrome with persistent Bluetooth permissions). No chooser. */
  async restore(id: string): Promise<boolean> {
    const bt = api(); if (!bt?.getDevices) return false;
    const found = (await bt.getDevices()).find(d => d.id === id); if (!found) return false; this.attach(found); return true;
  }
  private attach(device: BtDevice) { this.detach(); this.device = device; device.addEventListener('gattserverdisconnected', this.onDisconnect); this.setLink(device.gatt?.connected ? 'connected' : 'idle'); }
  private detach() { this.device?.removeEventListener('gattserverdisconnected', this.onDisconnect); this.tx = this.rx = undefined; }

  async connect(): Promise<void> {
    const d = this.device; if (!d?.gatt) throw new Error('PRINTER_NOT_SELECTED');
    if (this.tx && d.gatt.connected) return;
    this.setLink('connecting');
    try {
      const server = await Promise.race([d.gatt.connect(), sleep(15000).then(() => { throw new Error('CONNECT_TIMEOUT'); })]) as Server;
      const svc = await server.getPrimaryService(P.service);
      this.tx = await svc.getCharacteristic(P.write);
      try { this.rx = await (await svc.getCharacteristic(P.notify)).startNotifications(); this.rx.addEventListener('characteristicvaluechanged', this.onNotify); } catch { this.rx = undefined; }
      this.setLink('connected');
    } catch (e) { this.tx = undefined; this.setLink('lost'); throw e; }
  }
  disconnect() { try { this.rx?.removeEventListener('characteristicvaluechanged', this.onNotify); this.device?.gatt?.disconnect(); } catch { /* already gone */ } this.tx = this.rx = undefined; if (this.device) this.setLink('idle'); }
  async forget() { this.disconnect(); try { await this.device?.forget?.(); } catch { /* not supported */ } this.detach(); this.device = undefined; this.setLink(bluetoothSupported() ? 'idle' : 'unsupported'); }

  /** Writes the packets in order, 18 ms apart, each awaited (the browser's own write queue is the back-pressure). */
  async send(packets: Uint8Array[], { signal, onProgress }: { signal: AbortSignal; onProgress: (sent: number, total: number) => void }): Promise<void> {
    await this.connect();
    for (let i = 0; i < packets.length; i++) {
      if (signal.aborted) throw new Error('CANCELLED');
      if (!this.device?.gatt?.connected || !this.tx) throw new Error('DISCONNECTED');
      await this.tx.writeValueWithoutResponse(packets[i]! as unknown as BufferSource);
      onProgress(i + 1, packets.length); await sleep(P.intervalMs);
    }
    await sleep(400); // let the printer's replies arrive before the caller reads `notifications`; they are not proof of paper output
  }
}
