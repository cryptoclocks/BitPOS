import { PERIPAGE_A9SMAX } from './peripage';

// Receipt HTML (the same documents the browser print dialog uses) -> bitmap, so Thai and English are shaped by the browser's own text
// engine and nothing depends on the printer's built-in fonts. The page is laid out 3 dots per CSS pixel (about 288 dpi, close to the
// printer's 300) at the chosen content width and centred in the printer's fixed 1200-dot row.
export const SCALE = 3;
/** Blank dots kept at each edge of the content: the printable area sits inside the paper and the test frame is inset ~20 dots. */
export const EDGE_MARGIN = 24;
export interface Raster { rgba: Uint8ClampedArray; width: number; height: number }

export function layoutParts(html: string): { css: string; body: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const css = [...doc.querySelectorAll('style')].map(s => s.textContent ?? '').join('\n').replace(/@page\s*\{[^}]*\}/g, '').replace(/\bbody\b/g, '.rcpt');
  return { css, body: doc.body.innerHTML };
}

export async function renderReceiptRaster(html: string, widthDots: number, options: { topRows?: number; bottomRows?: number; weight?: number } = {}): Promise<Raster> {
  const rowDots = PERIPAGE_A9SMAX.rowDots, cssW = Math.floor((widthDots - 2 * EDGE_MARGIN) / SCALE), { css, body } = layoutParts(html);
  const style = `${css}\n.rcpt{width:${cssW}px!important;margin:0!important;background:#fff;color:#000;font-weight:${options.weight ?? 600};box-sizing:border-box}`;
  const host = document.createElement('div'); host.setAttribute('aria-hidden', 'true'); host.style.cssText = `position:fixed;left:-100000px;top:0;width:${cssW}px;visibility:hidden`;
  host.innerHTML = `<style>${style}</style><div class="rcpt">${body}</div>`; document.body.appendChild(host);
  let xhtml = '', cssH = 0;
  try {
    await (document.fonts?.ready ?? Promise.resolve());
    cssH = Math.max(1, Math.ceil((host.querySelector('.rcpt') as HTMLElement).getBoundingClientRect().height));
    const holder = document.createElement('div'); holder.innerHTML = `<style>${style}</style><div class="rcpt">${body}</div>`;
    xhtml = Array.from(holder.childNodes).map(n => new XMLSerializer().serializeToString(n)).join('');
  } finally { host.remove(); }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cssW * SCALE}" height="${cssH * SCALE}"><g transform="scale(${SCALE})"><foreignObject width="${cssW}" height="${cssH}"><div xmlns="http://www.w3.org/1999/xhtml">${xhtml}</div></foreignObject></g></svg>`;
  const img = new Image(); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const top = options.topRows ?? 24, bottom = options.bottomRows ?? 96, drawnW = cssW * SCALE, height = cssH * SCALE + top + bottom;
  const canvas = document.createElement('canvas'); canvas.width = rowDots; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, rowDots, height);
  ctx.drawImage(img, Math.floor((rowDots - drawnW) / 2), top);
  return { rgba: ctx.getImageData(0, 0, rowDots, height).data, width: rowDots, height };
}
