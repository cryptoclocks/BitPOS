import { PERIPAGE_A9SMAX, type Density } from './peripage';

// Saved per browser (= per POS device) and per shop, never on the server and never shared. The id is the browser's own opaque Bluetooth
// device id, not a hardware address, so it means nothing on another computer.
export interface PrinterSettings { version: 1; model: typeof PERIPAGE_A9SMAX.id; deviceId: string; deviceName: string; contentMm: 107 | 80 | 58; density: Density }
export const PAPER_OPTIONS = [{ mm: 107, label: '107 mm', note: 'เต็มหน้ากระดาษ (พื้นที่พิมพ์ ~102 mm)' }, { mm: 80, label: '80 mm', note: 'เนื้อหาอยู่กึ่งกลาง' }, { mm: 58, label: '58 mm', note: 'เนื้อหาอยู่กึ่งกลาง' }] as const;
export const DEFAULTS = { contentMm: 107, density: 2 } as const;
const key = (scope: string) => `bitpos.printer.${scope || '-'}`;

export function loadPrinterSettings(scope: string, storage: Pick<Storage, 'getItem'> | undefined = safe()): PrinterSettings | null {
  try {
    const raw = storage?.getItem(key(scope)); if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PrinterSettings>;
    if (v.version !== 1 || v.model !== PERIPAGE_A9SMAX.id || typeof v.deviceId !== 'string' || typeof v.deviceName !== 'string') return null;
    return { version: 1, model: v.model, deviceId: v.deviceId.slice(0, 200), deviceName: v.deviceName.slice(0, 80), contentMm: [107, 80, 58].includes(v.contentMm as number) ? v.contentMm! : DEFAULTS.contentMm, density: [0, 1, 2].includes(v.density as number) ? v.density! : DEFAULTS.density };
  } catch { return null; }
}
export function savePrinterSettings(scope: string, value: PrinterSettings | null, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safe()): boolean {
  try { if (!storage) return false; if (value) storage.setItem(key(scope), JSON.stringify(value)); else storage.removeItem(key(scope)); return true; } catch { return false; }
}
function safe(): Storage | undefined { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } }
