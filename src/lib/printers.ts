import type { AppConfig, Connection, LayoutOptions, MediaType, PrinterModel, PrinterProfile } from "./types";

export interface PaperPreset {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
}

export const PAPER_PRESETS: PaperPreset[] = [
  { id: "4x6", label: '4 × 6" (Versandetikett)', widthMm: 101.6, heightMm: 152.4 },
  { id: "100x150", label: "100 × 150 mm", widthMm: 100, heightMm: 150 },
  { id: "100x100", label: "100 × 100 mm", widthMm: 100, heightMm: 100 },
  { id: "4x4", label: '4 × 4"', widthMm: 101.6, heightMm: 101.6 },
  { id: "100x50", label: "100 × 50 mm", widthMm: 100, heightMm: 50 },
  { id: "75x50", label: "75 × 50 mm", widthMm: 75, heightMm: 50 },
  { id: "60x40", label: "60 × 40 mm", widthMm: 60, heightMm: 40 },
  { id: "57x32", label: "57 × 32 mm", widthMm: 57, heightMm: 32 },
  { id: "50x30", label: "50 × 30 mm", widthMm: 50, heightMm: 30 },
  { id: "40x30", label: "40 × 30 mm", widthMm: 40, heightMm: 30 },
  { id: "40x20", label: "40 × 20 mm", widthMm: 40, heightMm: 20 },
];

export const MEDIA_TYPES: { value: MediaType; label: string; hint: string }[] = [
  {
    value: "gap",
    label: "Lückenpapier",
    hint: "Einzelne Etiketten auf der Rolle, dazwischen eine Lücke",
  },
  {
    value: "blackMark",
    label: "Schwarze Markierung",
    hint: "Etiketten werden über eine schwarze Marke auf der Rückseite erkannt",
  },
  {
    value: "continuous",
    label: "Endlospapier",
    hint: "Durchgehende Rolle ohne Markierung, Länge wird fest vorgegeben",
  },
];

export const DEFAULT_LAYOUT: LayoutOptions = {
  fit: "contain",
  rotation: "auto",
  trim: true,
  marginMm: 1.5,
  threshold: 128,
  dither: false,
};

export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  printers: [],
  activePrinterId: null,
  layout: DEFAULT_LAYOUT,
};

/** Fallback when a profile references a model file that no longer exists. */
export function genericModelId(dpi: number): string {
  return dpi >= 300 ? "generic-tspl-300" : "generic-tspl-203";
}

export function modelLabel(m: PrinterModel): string {
  return `${m.vendor} ${m.name}`;
}

export function newPrinter(name: string, connection: Connection, model: PrinterModel): PrinterProfile {
  const d = model.defaults;
  return {
    id: crypto.randomUUID(),
    name,
    modelId: model.id,
    connection,
    dpi: model.dpi,
    widthMm: d.widthMm ?? 101.6,
    heightMm: d.heightMm ?? 152.4,
    mediaType: d.mediaType ?? "gap",
    gapMm: d.gapMm ?? 3,
    gapOffsetMm: 0,
    density: d.density ?? null,
    speed: d.speed ?? null,
    rotate180: false,
    tear: true,
    offsetXMm: 0,
    offsetYMm: 0,
  };
}

export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

/** Label size in printer dots. */
export function labelDots(p: PrinterProfile): { width: number; height: number } {
  return { width: mmToDots(p.widthMm, p.dpi), height: mmToDots(p.heightMm, p.dpi) };
}

/** Matches `tspl::JobSettings` on the Rust side. */
export function jobSettings(p: PrinterProfile) {
  const media =
    p.mediaType === "gap"
      ? { type: "gap", gapMm: p.gapMm, offsetMm: p.gapOffsetMm }
      : p.mediaType === "blackMark"
        ? { type: "blackMark", markMm: p.gapMm, offsetMm: p.gapOffsetMm }
        : { type: "continuous" };
  return {
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    media,
    density: p.density,
    speed: p.speed,
    rotate180: p.rotate180,
    tear: p.tear,
  };
}

export function describeConnection(c: Connection): string {
  switch (c.type) {
    case "usb":
      return `USB ${hex(c.vendorId)}:${hex(c.productId)}${c.serial ? ` · ${c.serial}` : ""}`;
    case "serial":
      return `Bluetooth · ${c.path.replace("/dev/cu.", "")}`;
    case "cups":
      return `CUPS · ${c.queue}`;
  }
}

export function connectionKind(c: Connection): string {
  return { usb: "USB", serial: "Bluetooth", cups: "CUPS" }[c.type];
}

export function sameConnection(a: Connection, b: Connection): boolean {
  if (a.type === "usb" && b.type === "usb") {
    return a.vendorId === b.vendorId && a.productId === b.productId && a.serial === b.serial;
  }
  if (a.type === "serial" && b.type === "serial") return a.path === b.path;
  if (a.type === "cups" && b.type === "cups") return a.queue === b.queue;
  return false;
}

function hex(n: number): string {
  return n.toString(16).padStart(4, "0");
}

export function formatMm(mm: number): string {
  return Number.isInteger(mm) ? `${mm}` : mm.toFixed(1).replace(".", ",");
}
