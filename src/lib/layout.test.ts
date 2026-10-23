import { describe, expect, it } from "vitest";

import { place, rotatedSize, type LabelGeometry } from "./layout";
import { inkBounds, isBlack, toBitmap } from "./bitmap";

// 4x6" at 300 dpi, no margin.
const label: LabelGeometry = {
  width: 1200,
  height: 1800,
  marginDots: 0,
  offsetX: 0,
  offsetY: 0,
  actualScale: 300 / 72,
};

// DHL label: 105 x 203 mm in PDF points.
const dhl = { w: 297.64, h: 575.43 };

describe("place", () => {
  it("shrinks an oversized DHL label to fit 4x6 instead of cropping it", () => {
    const p = place([{ rotation: 0, box: { x: 0, y: 0, ...dhl } }], label, "contain");
    expect(dhl.h * p.scale).toBeCloseTo(1800);
    expect(dhl.w * p.scale).toBeLessThanOrEqual(1200);
    // Centred horizontally.
    expect(p.x).toBeCloseTo((1200 - dhl.w * p.scale) / 2);
    expect(p.y).toBeCloseTo(0);
  });

  it("auto-rotates landscape content onto portrait paper", () => {
    const landscape = { w: 600, h: 400 };
    const candidates = ([0, 90] as const).map((rotation) => ({
      rotation,
      box: { x: 0, y: 0, ...rotatedSize(landscape.w, landscape.h, rotation) },
    }));
    expect(place(candidates, label, "contain").rotation).toBe(90);
  });

  it("keeps portrait content unrotated", () => {
    const candidates = ([0, 90] as const).map((rotation) => ({
      rotation,
      box: { x: 0, y: 0, ...rotatedSize(dhl.w, dhl.h, rotation) },
    }));
    expect(place(candidates, label, "contain").rotation).toBe(0);
  });

  it("moves a trimmed box to the label origin and honours margin and offset", () => {
    const geometry = { ...label, marginDots: 18, offsetX: 5, offsetY: -3 };
    const box = { x: 10, y: 20, w: 100, h: 150 };
    const p = place([{ rotation: 0, box }], geometry, "contain");
    const contentLeft = p.x + box.x * p.scale;
    const contentTop = p.y + box.y * p.scale;
    expect(Math.min(contentLeft - 5, contentTop + 3)).toBeCloseTo(18);
  });

  it("prints at 100 % in actual mode", () => {
    const p = place([{ rotation: 0, box: { x: 0, y: 0, ...dhl } }], label, "actual");
    expect(p.scale).toBeCloseTo(300 / 72);
  });
});

function pixels(width: number, height: number, dark: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = dark(x, y);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

describe("toBitmap", () => {
  it("packs rows MSB first with byte padding", () => {
    const bm = toBitmap(pixels(10, 2, (x, y) => (x === 0 || (x === 9 && y === 1) ? 0 : 255)), 128, false);
    expect(bm.widthBytes).toBe(2);
    expect(Array.from(bm.data)).toEqual([0x80, 0x00, 0x80, 0x40]);
    expect(isBlack(bm, 9, 1)).toBe(true);
  });

  it("dithers mid grey to roughly half coverage", () => {
    const bm = toBitmap(pixels(64, 64, () => 128), 128, true);
    let black = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (isBlack(bm, x, y)) black++;
    expect(black / (64 * 64)).toBeGreaterThan(0.4);
    expect(black / (64 * 64)).toBeLessThan(0.6);
  });

  it("treats transparent pixels as paper", () => {
    const data = new Uint8ClampedArray([0, 0, 0, 0]);
    expect(toBitmap({ width: 1, height: 1, data }, 128, false).data[0]).toBe(0);
  });
});

describe("inkBounds", () => {
  it("finds the content box and ignores blank pages", () => {
    expect(inkBounds(pixels(20, 20, (x, y) => (x >= 3 && x <= 7 && y >= 5 && y <= 15 ? 0 : 255)))).toEqual({
      x: 3,
      y: 5,
      w: 5,
      h: 11,
    });
    expect(inkBounds(pixels(5, 5, () => 255))).toBeNull();
  });
});
