import type { Language } from "../i18n";

export type Connection =
  | { type: "usb"; vendorId: number; productId: number; serial: string | null }
  | { type: "serial"; path: string }
  | { type: "cups"; queue: string };

/** How the printer finds the start of the next label. */
export type MediaType = "gap" | "blackMark" | "continuous";

/** A kind of label roll; printers point at the one currently loaded. */
export interface PaperProfile {
  id: string;
  name: string;
  widthMm: number;
  /** Label height, or the cut length for continuous paper. */
  heightMm: number;
  mediaType: MediaType;
  /** Gap height, or black mark height for `blackMark`. */
  gapMm: number;
  gapOffsetMm: number;
}

export interface PrinterProfile {
  id: string;
  name: string;
  /** References a model file (`src-tauri/models/*.json` or a user model). */
  modelId: string;
  connection: Connection;
  dpi: number;
  /** The paper currently loaded. */
  paperId: string;
  /** 0–15, `null` keeps the printer's own setting. */
  density: number | null;
  /** Inches per second, `null` keeps the printer's own setting. */
  speed: number | null;
  rotate180: boolean;
  tear: boolean;
  /** Fine adjustment of where the content lands on the label. */
  offsetXMm: number;
  offsetYMm: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface LayoutOptions {
  /** `contain` scales the document to the printable area, `actual` prints at 100 %. */
  fit: "contain" | "actual";
  rotation: "auto" | Rotation;
  /** Crop white borders before fitting, so the content gets as large as possible. */
  trim: boolean;
  marginMm: number;
  /** 0–255; pixels darker than this print black. */
  threshold: number;
  /** Floyd–Steinberg dithering for photos; keep off for barcodes. */
  dither: boolean;
}

/** A printer with its loaded paper resolved; what rendering and printing work with. */
export type Printer = PrinterProfile & Omit<PaperProfile, "id" | "name"> & { paper: PaperProfile };

export interface AppConfig {
  version: 2;
  /** UI language; English unless the user picked another one. */
  language: Language;
  printers: PrinterProfile[];
  papers: PaperProfile[];
  activePrinterId: string | null;
  layout: LayoutOptions;
}

export interface PrinterStatus {
  connected: boolean;
  responsive: boolean;
  /** A job was just sent; the app leaves the printer alone until it is done. */
  printing: boolean;
  model: string | null;
  firmware: string | null;
  paper: boolean | null;
  coverOpen: boolean | null;
}

export interface UsbDevice {
  vendorId: number;
  productId: number;
  serial: string | null;
  manufacturer: string | null;
  product: string | null;
  cupsQueue: string | null;
  modelId: string | null;
}

export interface SerialDevice {
  path: string;
  name: string;
  modelId: string | null;
}

export interface CupsQueue {
  name: string;
  deviceUri: string;
  dpi: number | null;
}

export interface Devices {
  usb: UsbDevice[];
  serial: SerialDevice[];
  cups: CupsQueue[];
}

/** Mirrors `models::PrinterModel`; see `src-tauri/models/` for examples. */
export interface PrinterModel {
  id: string;
  vendor: string;
  name: string;
  protocol: string;
  status: string | null;
  dpi: number;
  maxWidthMm: number;
  defaults: {
    widthMm?: number | null;
    heightMm?: number | null;
    mediaType?: MediaType | null;
    gapMm?: number | null;
    speed?: number | null;
    density?: number | null;
  };
  speeds: number[];
  density: { min: number; max: number } | null;
  notes: string | null;
  custom: boolean;
}

export interface ModelRegistry {
  models: PrinterModel[];
  errors: string[];
}

/** 1-bit raster, set bit = black, rows padded to whole bytes (MSB first). */
export interface Bitmap {
  width: number;
  height: number;
  widthBytes: number;
  data: Uint8Array;
}
