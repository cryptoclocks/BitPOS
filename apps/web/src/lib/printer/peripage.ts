// PeriPage A9s MAX (Bluetooth name PeriPage_A9sMAX_BLE, firmware V1.17_HD) wire format, exactly as confirmed on the owner's physical
// printer on 2026-11-04 (evidence/printer-bluetooth-20261104/app-profile-retest). Nothing here is guessed beyond that evidence:
//   stream = 10 FF FE 01 (enable) | 10 FF FD 00 (grayscale off) | 10 FF 10 00 <wire density> | image job
//   image job = 1F 00 | rowBytes u16BE | height u16BE | payloadLength u32BE | payload
//   payload  = raw DEFLATE stream (1 KiB window, i.e. zlib windowBits 10) + Adler-32 of the raster, zlib header removed
// UI density 0/1/2 is sent as wire 0/2/4 (the legacy app doubles it for this model). Transport is BLE service FF00, write FF02, notify FF01.

export const PERIPAGE_A9SMAX = {
  id: 'peripage-a9smax', label: 'PeriPage A9s MAX', btNamePrefix: 'PeriPage', paperMm: 107, printMm: 102, dpi: 300,
  rowDots: 1200, rowBytes: 150,
  service: '0000ff00-0000-1000-8000-00805f9b34fb', write: '0000ff02-0000-1000-8000-00805f9b34fb', notify: '0000ff01-0000-1000-8000-00805f9b34fb',
  chunkBytes: 100, intervalMs: 18,
  // The tested jobs were 360 and 840 rows; the header allows 65535. Anything longer than this is refused, not guessed at.
  maxRows: 4800,
} as const;

export type Density = 0 | 1 | 2;
export const wireDensity = (ui: Density): 0 | 2 | 4 => (ui * 2) as 0 | 2 | 4;

/** Black-and-white packing: MSB first, 1 = black when the pixel's average RGB (over white) is <= 128, like the legacy app. */
export function packRaster(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  if (width % 8 !== 0 || width <= 0 || height <= 0 || rgba.length !== width * height * 4) throw new Error('RASTER_SIZE_INVALID');
  const rowBytes = width / 8, out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, a = rgba[i + 3]! / 255;
    const avg = ((rgba[i]! * a + 255 * (1 - a)) + (rgba[i + 1]! * a + 255 * (1 - a)) + (rgba[i + 2]! * a + 255 * (1 - a))) / 3;
    if (avg <= 128) out[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
  }
  return out;
}

export function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i += 3800) { const end = Math.min(i + 3800, data.length); for (let j = i; j < end; j++) { a += data[j]!; b += a; } a %= 65521; b %= 65521; }
  return ((b << 16) | a) >>> 0;
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8];
const WINDOW = 1024;

class Bits {
  out: number[] = []; private buf = 0; private n = 0;
  bits(value: number, count: number) { this.buf |= value << this.n; this.n += count; while (this.n >= 8) { this.out.push(this.buf & 255); this.buf >>>= 8; this.n -= 8; } }
  /** Huffman codes are written most significant bit first. */
  code(value: number, len: number) { let r = 0; for (let i = 0; i < len; i++) r |= ((value >> i) & 1) << (len - 1 - i); this.bits(r, len); }
  flush() { if (this.n) { this.out.push(this.buf & 255); this.buf = 0; this.n = 0; } }
}
function literal(w: Bits, sym: number) {
  if (sym < 144) w.code(0x30 + sym, 8); else if (sym < 256) w.code(0x190 + sym - 144, 9); else if (sym < 280) w.code(sym - 256, 7); else w.code(0xc0 + sym - 280, 8);
}

/** Raw DEFLATE (one final fixed-Huffman block) whose back-references never reach further than 1024 bytes, so a decoder with a zlib windowBits=10 window reads it. */
export function deflateWindow1k(raw: Uint8Array): Uint8Array {
  const w = new Bits(); w.bits(1, 1); w.bits(1, 2);
  const n = raw.length, head = new Int32Array(1 << 15).fill(-1), prev = new Int32Array(n).fill(-1);
  const hash = (i: number) => ((raw[i]! << 10) ^ (raw[i + 1]! << 5) ^ raw[i + 2]!) & 0x7fff;
  const insert = (i: number) => { if (i + 2 < n) { const h = hash(i); prev[i] = head[h]!; head[h] = i; } };
  let i = 0;
  while (i < n) {
    let bestLen = 0, bestDist = 0;
    if (i + 2 < n) {
      let cand = head[hash(i)]!, tries = 128;
      const maxLen = Math.min(258, n - i);
      while (cand >= 0 && i - cand <= WINDOW && tries-- > 0) {
        let l = 0; while (l < maxLen && raw[cand + l] === raw[i + l]) l++;
        if (l > bestLen) { bestLen = l; bestDist = i - cand; if (l === maxLen) break; }
        cand = prev[cand]!;
      }
    }
    if (bestLen >= 3) {
      let li = LEN_BASE.length - 1; if (bestLen !== 258) { li = 0; while (li + 1 < 28 && LEN_BASE[li + 1]! <= bestLen) li++; }
      literal(w, 257 + li); if (LEN_EXTRA[li]) w.bits(bestLen - LEN_BASE[li]!, LEN_EXTRA[li]!);
      let di = 0; while (di + 1 < DIST_BASE.length && DIST_BASE[di + 1]! <= bestDist) di++;
      w.code(di, 5); if (DIST_EXTRA[di]) w.bits(bestDist - DIST_BASE[di]!, DIST_EXTRA[di]!);
      for (let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else { literal(w, raw[i]!); insert(i); i++; }
  }
  literal(w, 256); w.flush();
  return Uint8Array.from(w.out);
}

/** The legacy-app image job for one 1-bit raster. Refuses anything the tested profile does not cover. */
export function buildImageJob(raster: Uint8Array, widthDots: number, height: number): Uint8Array {
  const p = PERIPAGE_A9SMAX;
  if (widthDots !== p.rowDots) throw new Error('ROW_WIDTH_UNSUPPORTED');
  if (height < 1 || height > p.maxRows) throw new Error('RECEIPT_TOO_LONG');
  if (raster.length !== p.rowBytes * height) throw new Error('RASTER_SIZE_INVALID');
  const body = deflateWindow1k(raster), sum = adler32(raster), payloadLength = body.length + 4, job = new Uint8Array(10 + payloadLength), dv = new DataView(job.buffer);
  job[0] = 0x1f; job[1] = 0x00; dv.setUint16(2, p.rowBytes); dv.setUint16(4, height); dv.setUint32(6, payloadLength);
  job.set(body, 10); dv.setUint32(10 + body.length, sum);
  return job;
}

export function chunk(data: Uint8Array, size: number = PERIPAGE_A9SMAX.chunkBytes): Uint8Array[] {
  const out: Uint8Array[] = []; for (let i = 0; i < data.length; i += size) out.push(data.subarray(i, Math.min(i + size, data.length))); return out;
}

/** The tested send order: three small setup writes (enable, grayscale off, density), then the image job in writes of at most 100 bytes. */
export function buildPrintPackets(imageJob: Uint8Array, density: Density): Uint8Array[] {
  return [Uint8Array.from([0x10, 0xff, 0xfe, 0x01]), Uint8Array.from([0x10, 0xff, 0xfd, 0x00]), Uint8Array.from([0x10, 0xff, 0x10, 0x00, wireDensity(density)]), ...chunk(imageJob)];
}

/** Content width in dots for a paper/content width in mm, in whole bytes and never wider than the 1200-dot row. */
export const contentDots = (mm: number) => Math.max(96, Math.min(PERIPAGE_A9SMAX.rowDots, Math.floor((mm / 25.4) * PERIPAGE_A9SMAX.dpi / 8) * 8));
