import { translator } from "../i18n";
import type {
  AppConfig,
  Connection,
  LayoutOptions,
  MediaType,
  PaperProfile,
  Printer,
  PrinterModel,
  PrinterProfile,
} from "./types";

export interface PaperPreset {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
}

export const PAPER_PRESETS: PaperPreset[] = [
  { id: "4x6", label: '4 × 6"', widthMm: 101.6, heightMm: 152.4 },
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

/** Labels and hints live in the dictionaries under `media.<type>`. */
export const MEDIA_TYPES: MediaType[] = ["gap", "blackMark", "continuous"];

export const DEFAULT_LAYOUT: LayoutOptions = {
  fit: "contain",
  rotation: "auto",
  trim: true,
  marginMm: 1.5,
  threshold: 128,
  dither: false,
};

export const DEFAULT_PAPERS: PaperProfile[] = [
  {
    id: "paper-4x6",
    name: '4 × 6"',
    widthMm: 101.6,
    heightMm: 152.4,
    mediaType: "gap",
    gapMm: 3,
    gapOffsetMm: 0,
  },
];

export const DEFAULT_CONFIG: AppConfig = {
  version: 2,
  language: "en",
  printers: [],
  papers: DEFAULT_PAPERS,
  activePrinterId: null,
  layout: DEFAULT_LAYOUT,
};

export function newPaper(fields: Partial<Omit<PaperProfile, "id">> = {}): PaperProfile {
  const paper = {
    widthMm: 101.6,
    heightMm: 152.4,
    mediaType: "gap" as MediaType,
    gapMm: 3,
    gapOffsetMm: 0,
    ...fields,
  };
  return { id: crypto.randomUUID(), name: fields.name ?? paperSize(paper), ...paper };
}

export function paperSize(p: Pick<PaperProfile, "widthMm" | "heightMm">): string {
  return `${formatMm(p.widthMm)} × ${formatMm(p.heightMm)} mm`;
}

export function paperSummary(p: PaperProfile): string {
  const t = translator();
  const media =
    p.mediaType === "gap"
      ? t("paper.summary.gap", { mm: formatMm(p.gapMm) })
      : p.mediaType === "blackMark"
        ? t("paper.summary.mark", { mm: formatMm(p.gapMm) })
        : t("paper.summary.continuous");
  return `${paperSize(p)} · ${media}`;
}

type PaperShape = Omit<PaperProfile, "id" | "name">;

function samePaper(a: PaperShape, b: PaperShape): boolean {
  return (
    a.widthMm === b.widthMm &&
    a.heightMm === b.heightMm &&
    a.mediaType === b.mediaType &&
    a.gapMm === b.gapMm &&
    a.gapOffsetMm === b.gapOffsetMm
  );
}

/** Reuses a matching paper profile or appends a new one. */
export function ensurePaper(papers: PaperProfile[], shape: PaperShape): { papers: PaperProfile[]; paperId: string } {
  const existing = papers.find((p) => samePaper(p, shape));
  if (existing) return { papers, paperId: existing.id };
  const preset = PAPER_PRESETS.find((p) => p.widthMm === shape.widthMm && p.heightMm === shape.heightMm);
  const paper = newPaper({ ...shape, name: preset?.label });
  return { papers: [...papers, paper], paperId: paper.id };
}

export function modelPaper(model: PrinterModel): PaperShape {
  const d = model.defaults;
  return {
    widthMm: d.widthMm ?? 101.6,
    heightMm: d.heightMm ?? 152.4,
    mediaType: d.mediaType ?? "gap",
    gapMm: d.gapMm ?? 3,
    gapOffsetMm: 0,
  };
}

export function resolvePrinter(profile: PrinterProfile, papers: PaperProfile[]): Printer {
  const paper = papers.find((p) => p.id === profile.paperId) ?? papers[0] ?? DEFAULT_PAPERS[0];
  const { id: _id, name: _name, ...shape } = paper;
  return { ...profile, ...shape, paper };
}

/** Fallback when a profile references a model file that no longer exists. */
export function genericModelId(dpi: number): string {
  return dpi >= 300 ? "generic-tspl-300" : "generic-tspl-203";
}

export function modelLabel(m: PrinterModel): string {
  return `${m.vendor} ${m.name}`;
}

export function newPrinter(
  name: string,
  connection: Connection,
  model: PrinterModel,
  paperId: string,
): PrinterProfile {
  const d = model.defaults;
  return {
    id: crypto.randomUUID(),
    name,
    modelId: model.id,
    connection,
    dpi: model.dpi,
    paperId,
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
export function labelDots(p: Printer): { width: number; height: number } {
  return { width: mmToDots(p.widthMm, p.dpi), height: mmToDots(p.heightMm, p.dpi) };
}

/** Matches `protocol::JobSettings` on the Rust side. */
export function jobSettings(p: Printer) {
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
      return `${translator()("connection.serial")} · ${c.path.replace("/dev/cu.", "")}`;
    case "ble":
      return `${translator()("connection.ble")} · ${c.name}`;
    case "cups":
      return `CUPS · ${c.queue}`;
  }
}

export function connectionKind(c: Connection): string {
  return translator()(`connection.${c.type}`);
}

export function sameConnection(a: Connection, b: Connection): boolean {
  if (a.type === "usb" && b.type === "usb") {
    return a.vendorId === b.vendorId && a.productId === b.productId && a.serial === b.serial;
  }
  if (a.type === "serial" && b.type === "serial") return a.path === b.path;
  if (a.type === "ble" && b.type === "ble") return a.id === b.id;
  if (a.type === "cups" && b.type === "cups") return a.queue === b.queue;
  return false;
}

function hex(n: number): string {
  return n.toString(16).padStart(4, "0");
}

/** Millimetres with the active language's decimal separator, at most one decimal. */
export function formatMm(mm: number): string {
  return translator().number(mm, 1);
}
