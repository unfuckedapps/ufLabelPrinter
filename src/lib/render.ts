import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { translator } from "../i18n";
import { inkBounds, toBitmap } from "./bitmap";
import { place, rotatedSize, type Box, type LabelGeometry, type Placement } from "./layout";
import { labelDots, mmToDots, paperSize } from "./printers";
import type { Bitmap, LayoutOptions, Printer, Rotation } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** One printable page of a PDF or an image, independent of the source format. */
export interface SourcePage {
  /** Natural size in source units, unrotated. */
  width: number;
  height: number;
  /** Source units per inch, `null` for images (1 px = 1 printer dot at 100 %). */
  unitsPerInch: number | null;
  /** Draws the page rotated clockwise by `rotation`, scaled, with its origin at (x, y). */
  draw(ctx: CanvasRenderingContext2D, placement: Placement): Promise<void>;
}

class PdfPage implements SourcePage {
  readonly width: number;
  readonly height: number;
  readonly unitsPerInch = 72;

  constructor(private readonly page: PDFPageProxy) {
    const viewport = page.getViewport({ scale: 1 });
    this.width = viewport.width;
    this.height = viewport.height;
  }

  async draw(ctx: CanvasRenderingContext2D, { rotation, scale, x, y }: Placement) {
    const viewport = this.page.getViewport({
      scale,
      rotation: (this.page.rotate + rotation) % 360,
    });
    await this.page.render({
      canvas: ctx.canvas as HTMLCanvasElement,
      canvasContext: ctx,
      viewport,
      transform: [1, 0, 0, 1, x, y],
    }).promise;
  }
}

class ImagePage implements SourcePage {
  readonly width: number;
  readonly height: number;
  readonly unitsPerInch = null;

  constructor(private readonly image: ImageBitmap) {
    this.width = image.width;
    this.height = image.height;
  }

  async draw(ctx: CanvasRenderingContext2D, { rotation, scale, x, y }: Placement) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    if (rotation === 90) {
      ctx.translate(this.height, 0);
      ctx.rotate(Math.PI / 2);
    } else if (rotation === 180) {
      ctx.translate(this.width, this.height);
      ctx.rotate(Math.PI);
    } else if (rotation === 270) {
      ctx.translate(0, this.width);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.image, 0, 0);
    ctx.restore();
  }
}

export interface LoadedSource {
  pageCount: number;
  getPage(index: number): Promise<SourcePage>;
  dispose(): void;
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
}

export async function loadSource(bytes: Uint8Array): Promise<LoadedSource> {
  if (isPdf(bytes)) {
    const doc: PDFDocumentProxy = await pdfjs.getDocument({
      // pdf.js transfers the buffer to its worker; keep the caller's copy intact.
      data: bytes.slice(),
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
    }).promise;
    const pages = new Map<number, Promise<SourcePage>>();
    return {
      pageCount: doc.numPages,
      getPage(index) {
        let page = pages.get(index);
        if (!page) {
          page = doc.getPage(index + 1).then((p) => new PdfPage(p));
          pages.set(index, page);
        }
        return page;
      },
      dispose: () => void doc.destroy(),
    };
  }

  const image = await createImageBitmap(new Blob([bytes.slice()]));
  const page = new ImagePage(image);
  return {
    pageCount: 1,
    getPage: async () => page,
    dispose: () => image.close(),
  };
}

function whiteCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** Longest side of the low-resolution pass that finds the content box. */
const TRIM_PROBE_PX = 800;

/** Content box of the rotated page in source units, padded by `pad` units. */
async function contentBox(page: SourcePage, rotation: Rotation, pad: number): Promise<Box> {
  const size = rotatedSize(page.width, page.height, rotation);
  const full = { x: 0, y: 0, ...size };
  const probe = TRIM_PROBE_PX / Math.max(size.w, size.h);
  const { canvas, ctx } = whiteCanvas(size.w * probe, size.h * probe);
  await page.draw(ctx, { rotation, scale: probe, x: 0, y: 0 });

  const ink = inkBounds(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (!ink) return full;

  const x = Math.max(0, ink.x / probe - pad);
  const y = Math.max(0, ink.y / probe - pad);
  return {
    x,
    y,
    w: Math.min(size.w, (ink.x + ink.w) / probe + pad) - x,
    h: Math.min(size.h, (ink.y + ink.h) / probe + pad) - y,
  };
}

export interface RenderedLabel {
  bitmap: Bitmap;
  placement: Placement;
  /** Size relative to printing at 100 %, e.g. 0.75 when shrunk to fit. */
  relativeScale: number;
}

/** Renders a page onto the printer's label at printer resolution and converts it to 1 bit. */
export async function renderLabel(
  page: SourcePage,
  printer: Printer,
  options: LayoutOptions,
): Promise<RenderedLabel> {
  const { width, height } = labelDots(printer);
  const unitsPerInch = page.unitsPerInch ?? printer.dpi;
  const actualScale = printer.dpi / unitsPerInch;
  const geometry: LabelGeometry = {
    width,
    height,
    marginDots: mmToDots(options.marginMm, printer.dpi),
    offsetX: mmToDots(printer.offsetXMm, printer.dpi),
    offsetY: mmToDots(printer.offsetYMm, printer.dpi),
    actualScale,
  };

  const rotations: Rotation[] = options.rotation === "auto" ? [0, 90] : [options.rotation];
  // Half a millimetre of breathing room around trimmed content.
  const pad = unitsPerInch / 50.8;
  const candidates = await Promise.all(
    rotations.map(async (rotation) => ({
      rotation,
      box: options.trim
        ? await contentBox(page, rotation, pad)
        : { x: 0, y: 0, ...rotatedSize(page.width, page.height, rotation) },
    })),
  );

  const placement = place(candidates, geometry, options.fit);
  const { canvas, ctx } = whiteCanvas(width, height);
  await page.draw(ctx, placement);

  return {
    bitmap: toBitmap(ctx.getImageData(0, 0, canvas.width, canvas.height), options.threshold, options.dither),
    placement,
    relativeScale: placement.scale / actualScale,
  };
}

/**
 * Calibration label: an outline exactly on the label edge, centre cross and millimetre
 * rulers show whether offsets, size and darkness are right.
 */
export function renderTestLabel(printer: Printer): Bitmap {
  const { width, height } = labelDots(printer);
  const dpmm = printer.dpi / 25.4;
  const { canvas, ctx } = whiteCanvas(width, height);
  const ox = mmToDots(printer.offsetXMm, printer.dpi);
  const oy = mmToDots(printer.offsetYMm, printer.dpi);
  ctx.translate(ox, oy);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";

  const line = Math.max(2, Math.round(dpmm * 0.3));
  ctx.lineWidth = line;
  ctx.strokeRect(line / 2, line / 2, width - line, height - line);
  const inset = 2 * dpmm;
  ctx.setLineDash([dpmm, dpmm]);
  ctx.strokeRect(inset, inset, width - 2 * inset, height - 2 * inset);
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(width / 2 - 5 * dpmm, height / 2);
  ctx.lineTo(width / 2 + 5 * dpmm, height / 2);
  ctx.moveTo(width / 2, height / 2 - 5 * dpmm);
  ctx.lineTo(width / 2, height / 2 + 5 * dpmm);
  ctx.stroke();

  // Millimetre rulers along the top and left edge, every 10 mm labelled.
  ctx.lineWidth = Math.max(1, Math.round(dpmm * 0.15));
  ctx.font = `${Math.round(2.2 * dpmm)}px -apple-system, Helvetica, sans-serif`;
  ctx.textBaseline = "top";
  for (let mm = 0; mm * dpmm < width; mm++) {
    const len = mm % 10 === 0 ? 4 : mm % 5 === 0 ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(mm * dpmm, inset);
    ctx.lineTo(mm * dpmm, inset + len * dpmm);
    ctx.stroke();
    if (mm % 10 === 0 && mm > 0) ctx.fillText(String(mm), mm * dpmm + 0.5 * dpmm, inset + 4.2 * dpmm);
  }
  for (let mm = 0; mm * dpmm < height; mm++) {
    const len = mm % 10 === 0 ? 4 : mm % 5 === 0 ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(inset, mm * dpmm);
    ctx.lineTo(inset + len * dpmm, mm * dpmm);
    ctx.stroke();
    if (mm % 10 === 0 && mm > 0) ctx.fillText(String(mm), inset + 4.6 * dpmm, mm * dpmm - 1 * dpmm);
  }

  // Solid block and 1/2/3-dot line pairs to judge darkness: lines should stay separate,
  // the block should be evenly black.
  const patternY = Math.round(height / 2 + 10 * dpmm);
  const patternH = Math.round(6 * dpmm);
  let px = Math.round(10 * dpmm);
  ctx.fillRect(px, patternY, Math.round(10 * dpmm), patternH);
  px += Math.round(14 * dpmm);
  for (const dots of [1, 2, 3]) {
    for (let i = 0; i < 12; i++, px += 2 * dots) ctx.fillRect(px, patternY, dots, patternH);
    px += Math.round(4 * dpmm);
  }

  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.font = `600 ${Math.round(4 * dpmm)}px -apple-system, Helvetica, sans-serif`;
  ctx.fillText(printer.name, width / 2, height / 2 - 18 * dpmm);
  ctx.font = `${Math.round(3 * dpmm)}px -apple-system, Helvetica, sans-serif`;
  ctx.fillText(printer.paper.name, width / 2, height / 2 - 23 * dpmm);
  ctx.font = `${Math.round(3 * dpmm)}px -apple-system, Helvetica, sans-serif`;
  const t = translator();
  ctx.fillText(`${paperSize(printer)} · ${printer.dpi} dpi`, width / 2, height / 2 - 12 * dpmm);
  const density = printer.density ?? t("testLabel.printerDefault");
  ctx.fillText(t("testLabel.density", { value: density }), width / 2, height / 2 - 8 * dpmm);

  return toBitmap(ctx.getImageData(0, 0, canvas.width, canvas.height), 128, false);
}
