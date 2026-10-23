import type { LayoutOptions, Rotation } from "./types";

/** A rectangle in source units, in the coordinate frame of a rotated page. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placement {
  rotation: Rotation;
  /** Printer dots per source unit. */
  scale: number;
  /** Where the rotated page's origin lands on the label, in dots. */
  x: number;
  y: number;
}

export interface LabelGeometry {
  /** Label size in dots. */
  width: number;
  height: number;
  marginDots: number;
  offsetX: number;
  offsetY: number;
  /** Scale for printing at 100 %. */
  actualScale: number;
}

export function rotatedSize(w: number, h: number, rotation: Rotation): { w: number; h: number } {
  return rotation % 180 === 0 ? { w, h } : { w: h, h: w };
}

/**
 * Picks rotation and scale for the content box and centres it on the label.
 * `candidates` holds one content box per rotation to consider (trimmed or full page).
 */
export function place(
  candidates: { rotation: Rotation; box: Box }[],
  label: LabelGeometry,
  fit: LayoutOptions["fit"],
): Placement {
  const availW = Math.max(1, label.width - 2 * label.marginDots);
  const availH = Math.max(1, label.height - 2 * label.marginDots);

  let best: { rotation: Rotation; box: Box; fitScale: number } | null = null;
  for (const { rotation, box } of candidates) {
    const fitScale = Math.min(availW / box.w, availH / box.h);
    // Prefer the earlier (unrotated) candidate unless rotating is clearly better.
    if (!best || fitScale > best.fitScale * 1.02) best = { rotation, box, fitScale };
  }
  if (!best) throw new Error("place() needs at least one candidate");

  const scale = fit === "contain" ? best.fitScale : label.actualScale;
  const { box } = best;
  return {
    rotation: best.rotation,
    scale,
    x: label.marginDots + (availW - box.w * scale) / 2 - box.x * scale + label.offsetX,
    y: label.marginDots + (availH - box.h * scale) / 2 - box.y * scale + label.offsetY,
  };
}
