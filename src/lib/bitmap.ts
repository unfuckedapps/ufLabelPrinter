import type { Bitmap } from "./types";

interface Pixels {
  width: number;
  height: number;
  /** RGBA, composited on white. */
  data: Uint8ClampedArray;
}

function luminance(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const lum = new Float32Array(width * height);
  for (let i = 0, p = 0; p < lum.length; i += 4, p++) {
    // Transparent pixels count as paper.
    const a = data[i + 3] / 255;
    const l = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    lum[p] = l * a + 255 * (1 - a);
  }
  return lum;
}

/**
 * Converts rendered pixels to a packed 1-bit bitmap. A hard threshold keeps barcode
 * edges crisp; Floyd–Steinberg dithering is for photos and gradients.
 */
export function toBitmap(pixels: Pixels, threshold: number, dither: boolean): Bitmap {
  const { width, height } = pixels;
  const widthBytes = Math.ceil(width / 8);
  const data = new Uint8Array(widthBytes * height);
  const lum = luminance(pixels.data, width, height);

  for (let y = 0; y < height; y++) {
    // Serpentine scan avoids the diagonal "worm" artefacts of plain left-to-right.
    const reverse = dither && y % 2 === 1;
    for (let step = 0; step < width; step++) {
      const x = reverse ? width - 1 - step : step;
      const p = y * width + x;
      const black = lum[p] < threshold;
      if (black) data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);

      if (dither) {
        const err = lum[p] - (black ? 0 : 255);
        const dir = reverse ? -1 : 1;
        const nx = x + dir;
        if (nx >= 0 && nx < width) lum[p + dir] += (err * 7) / 16;
        if (y + 1 < height) {
          const below = p + width;
          if (x - dir >= 0 && x - dir < width) lum[below - dir] += (err * 3) / 16;
          lum[below] += (err * 5) / 16;
          if (nx >= 0 && nx < width) lum[below + dir] += err / 16;
        }
      }
    }
  }

  return { width, height, widthBytes, data };
}

export function isBlack(bitmap: Bitmap, x: number, y: number): boolean {
  return (bitmap.data[y * bitmap.widthBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
}

/** Paints the bitmap as it will come out of the printer. */
export function drawBitmap(bitmap: Bitmap, canvas: HTMLCanvasElement, ink = [17, 17, 17]): void {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(bitmap.width, bitmap.height);
  const px = image.data;
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const i = (y * bitmap.width + x) * 4;
      const black = isBlack(bitmap, x, y);
      px[i] = black ? ink[0] : 255;
      px[i + 1] = black ? ink[1] : 255;
      px[i + 2] = black ? ink[2] : 255;
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Bounding box of everything darker than `cutoff`, in pixels; `null` for a blank page. */
export function inkBounds(
  pixels: Pixels,
  cutoff = 230,
): { x: number; y: number; w: number; h: number } | null {
  const { width, height } = pixels;
  const lum = luminance(pixels.data, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (lum[y * width + x] < cutoff) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
