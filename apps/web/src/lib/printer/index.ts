import { PERIPAGE_A9SMAX, buildImageJob, buildPrintPackets, contentDots, packRaster, type Density } from './peripage';
import { PrintQueue, type PrintJob } from './queue';
import { WebBluetoothPrinter, bluetoothSupported } from './ble';
import { renderReceiptRaster } from './render';
import { DEFAULTS, loadPrinterSettings, savePrinterSettings, type PrinterSettings } from './settings';

export { bluetoothSupported } from './ble';
export type { PrintJob } from './queue';

/** The job the owner confirmed physically on 2026-11-04 (1200x360 test artwork, UI density 2). Kept only to replay a known-good job. */
const CONFIRMED_JOB_B64 = 'HwAAlgFoAAAFVu3ST47kJhTHcZAjsYnCBSJxkahY5FqtMq1Z5Fpu9SLLHCFEuQCzYySGl/egXKa6e2G5W5kaze+rdtc/Gz42KIUQQgghhBD6LnJUlQtqIlLK5n6ok3xe+MjKR018io3KU1EzUVBEZImiomDkDPWgDJ/B75MPOql50dkT/b2oqpRJB1UUXPhJFDyvUnNdVUlUWv4EnvhXulEZ+VtVTZj8ovmqNKhcOaqKLvw8tZtnmUzL84ioH3VQhVFlKXdVFlVcVYZKU/0VNYvkRg+rfpNnw9PLci0XVREVzzWollHlqAyq1FRRJ8v3Iao/o+bf5sOq5MLD5dmkaVNV+c5eVD6LKo4qf6PKTZV0cqsqTfxbe/QHVMHwxWVKJpti85RdbKqkKh+8y+egeCVOrGpbXq45K8t0/1jltKaKfDVf11QL8UNyYcqy06s/qJq6ShebpmKSjF5kulmmdItrqnNhEE8zqGZ+lVO0qHRpqqyTD76pdHMWtxxT6auqjS13mGU631SBh11V043qzK6mSqxSTXUSFT/EpuLxWGzfp2q3VU2cXqhsUz08vKHyg+rcVEVUrqlU4ZPeo3J/0LOogoz9tqqcd6keBlWVxfsglWzfUSWDvq2a+d1L1Vn2lWr7Sp35UOqoakoXFY83GxbIPFdV6qp8eq1aumqKovJNdWJVvKh8O/eoynSVLjyKn2hZVfNElCw1lc68iZXZVESLL7cqonjyOrm6qqiPf0jFg3VV7qp8UenaVXFTuXijovBK5VhFS1cxj/NHVYsLZUqmqTRRVxE1lSHZVDy7C56nHVWO0mvVI99H/jgVUVMp/nhRyXdpEuVVtYwqS+WVyj7yfdSusrJF1XwE1VewqVJTeX4gPI8o5TtWhk0VRtVEtanMMqieEj/trjJZzq1HVamrYlMZWZemijIl/76wykTL+6iqq2qRx0A3qqjUyTwlvq/HTaUPqoLJXRWaSl1VoammQZVvVfYN1T+J76ur+uXloEp3VVVdZXNTJb+0YZWPq0pmGFWqw0fVxCo1P22qvoxHVEVUPIQPsjenLJPwRuorqKyorCywfrGCfIGcYkfVZ/7CDSqbDqrUquK3Z73wVuW7n5JN7UHIjBeVohvVr3xBUwU559xU+nP6RdlB5eJHqOxVZXJ7fqNqDqOqvKX6ks43Kr+8W7WoauOqmi6r2lSOKHmZYlDVN1TqS5pvVHwj71SxqNg4XVT6orKbyr1Q+UFVuuorq8Z9NR9Cjbudd1IxsptsG7L258eAIvNnLxt/UM38oZ3Cu4/vp6vm5IN73FT1qMpkVv0uO7vYzMetKvmmUvq1aqFNZfJVFedBRbQcUhGxip55iImXSY6Laub3xcqwq8qkq0pWlDYVDyLHSfnEA24qfVyVLioeIspxUflPrOK5eOPxaunC65VHlaM6qNKq4p/0R6iiC/Pz+rjlcJuKn5di1Zn/vVRZKm1m31Sxqxzr6qaajquWVeVZMFO7ex7SPbNK89RXlS6jyvBay8ynpgqraqL8ISoewn0Slc396Cr7L6uUj6KqSlUG1VGlKGyqqrrK8n5c3q9CCCGEEEIIIYQQQgghhBBCdEdBtT+o9gfV/qDaH1T7g2p/UO3v3lUIIYTQjxzF+3mBCiqooIIKKqi+vQMqqKC6Cw5UUEF1Fy/3rkIIIYQQQgghhBBC/390R0G1P6j2B9X+oNofVPuDan9Q7e/eVQghhNCPHMX7eYEKKqigggoqqL69AyqooLoLDlRQQXUXL/euQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQ+m76DzsuIqw=';
export const confirmedHardwareJob = (): Uint8Array => Uint8Array.from(atob(CONFIRMED_JOB_B64), c => c.charCodeAt(0));

// One printer object and one queue per browser tab. The scope (the shop id) only decides which saved setting is read.
export const printer = new WebBluetoothPrinter();
export const queue = new PrintQueue(() => printer);
let scope = '-';
export const setPrinterScope = (shopId: string) => { scope = shopId || '-'; };
export const currentSettings = (): PrinterSettings | null => loadPrinterSettings(scope);
export const storeSettings = (s: PrinterSettings | null) => savePrinterSettings(scope, s);

export type Readiness = { ok: true; settings: PrinterSettings } | { ok: false; reason: 'UNSUPPORTED' | 'NOT_CONFIGURED' | 'CHOOSER_CANCELLED' };
/** Makes sure a printer is attached to this tab. Must run from a click when the browser needs to show its device chooser. */
export async function ensurePrinter(): Promise<Readiness> {
  if (!bluetoothSupported()) return { ok: false, reason: 'UNSUPPORTED' };
  const saved = currentSettings(); if (!saved) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (printer.deviceId() === saved.deviceId) return { ok: true, settings: saved };
  if (await printer.restore(saved.deviceId)) return { ok: true, settings: saved };
  try { const chosen = await printer.choose(); const next = { ...saved, deviceId: chosen.id, deviceName: chosen.name }; storeSettings(next); return { ok: true, settings: next }; }
  catch { return { ok: false, reason: 'CHOOSER_CANCELLED' }; }
}
export async function choosePrinter(all = false): Promise<PrinterSettings> {
  const chosen = await printer.choose(all), prev = currentSettings();
  const next: PrinterSettings = { version: 1, model: PERIPAGE_A9SMAX.id, deviceId: chosen.id, deviceName: chosen.name, contentMm: prev?.contentMm ?? DEFAULTS.contentMm, density: prev?.density ?? DEFAULTS.density };
  storeSettings(next); return next;
}
export async function forgetPrinter() { await printer.forget(); storeSettings(null); }

/** Receipt HTML -> raster -> compressed image job -> BLE packets, with the saved paper width and darkness. */
export async function packetsForHtml(html: string, settings: Pick<PrinterSettings, 'contentMm' | 'density'>): Promise<Uint8Array[]> {
  const r = await renderReceiptRaster(html, contentDots(settings.contentMm));
  return buildPrintPackets(buildImageJob(packRaster(r.rgba, r.width, r.height), r.width, r.height), settings.density as Density);
}
export function printHtml(key: string, label: string, html: string, settings: PrinterSettings, options?: { reprint?: boolean }) {
  return queue.enqueue(key, label, () => packetsForHtml(html, settings), options);
}
export function printConfirmedJob(settings: PrinterSettings) {
  return queue.enqueue('hardware-confirmed-job-' + Date.now(), 'Verified test image', async () => buildPrintPackets(confirmedHardwareJob(), settings.density as Density), { reprint: true });
}
