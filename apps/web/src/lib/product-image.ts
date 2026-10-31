// Product photo rules shared by the form and its tests. The server re-checks everything (magic bytes, size, role);
// this only gives the owner an early, readable error.
export const maxProductImageBytes = 1024 * 1024;
export const productImageTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const productImagePathPattern = /^\/images\/products\/[0-9a-f-]{36}$/;
export const imageStorageNote = (language: 'th' | 'en') => language === 'th'
  ? 'เก็บในฐานข้อมูล BitPOS (ตาราง product_images) เปิดดูที่ /images/products/… ขนาดไม่เกิน 1 MB ไฟล์ JPEG/PNG/WebP'
  : 'Stored in the BitPOS database (product_images), served at /images/products/…, max 1 MB JPEG/PNG/WebP';
export type ImageProblem = 'type' | 'size' | 'empty';
export function imageProblem(file: { type: string; size: number }): ImageProblem | null {
  if (file.size <= 0) return 'empty';
  if (!(productImageTypes as readonly string[]).includes(file.type)) return 'type';
  if (file.size > maxProductImageBytes) return 'size';
  return null;
}
export const imageProblemText = (problem: ImageProblem, language: 'th' | 'en') => ({
  type: language === 'th' ? 'รองรับเฉพาะ JPEG, PNG หรือ WebP (ไม่รับ SVG)' : 'Only JPEG, PNG or WebP files are accepted (no SVG).',
  size: language === 'th' ? 'ไฟล์ใหญ่เกิน 1 MB' : 'The file is larger than 1 MB.',
  empty: language === 'th' ? 'ไฟล์ว่างเปล่า' : 'The file is empty.',
})[problem];
export async function uploadProductImage(file: File, token: string): Promise<{ id: string; path: string }> {
  const response = await fetch('/api/product-images', { method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${token}` }, body: file, signal: AbortSignal.timeout(30_000) });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload ? (payload as { error: { code?: string } }).error : null;
    throw new Error(response.status === 413 ? 'size' : response.status === 415 ? 'type' : response.status === 403 ? 'role' : error?.code ?? 'failed');
  }
  const out = payload as { id: string; path: string };
  if (!productImagePathPattern.test(out.path)) throw new Error('failed');
  return out;
}
