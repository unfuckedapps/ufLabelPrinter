import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, TriangleAlert } from "lucide-react";

import { useT } from "../i18n";
import { drawBitmap } from "../lib/bitmap";
import type { LabelDocument } from "../lib/documents";
import { formatMm } from "../lib/printers";
import { renderLabel, type RenderedLabel } from "../lib/render";
import type { LayoutOptions, Printer } from "../lib/types";
import { errorMessage } from "../lib/api";

/** Below this, small text and barcode modules get hard to print and scan. */
const SMALL_SCALE = 0.6;

export function LabelPreview({
  doc,
  page,
  onPageChange,
  printer,
  layout,
}: {
  doc: LabelDocument;
  page: number;
  onPageChange: (page: number) => void;
  printer: Printer;
  layout: LayoutOptions;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [result, setResult] = useState<RenderedLabel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  // Only the source matters; copies/selection changes must not trigger a re-render.
  const { source } = doc;
  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    // Debounced so dragging the threshold slider does not queue dozens of renders.
    const timer = window.setTimeout(async () => {
      try {
        const rendered = await renderLabel(await source.getPage(page), printer, layout);
        if (cancelled) return;
        if (canvasRef.current) drawBitmap(rendered.bitmap, canvasRef.current);
        setResult(rendered);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, page, printer, layout]);

  const pageCount = source.pageCount;
  const ratio = printer.widthMm / printer.heightMm;

  return (
    <div className="flex h-full min-h-0 flex-col items-center gap-4 p-6">
      {/* Size container so the sheet can fit by both width and height at the label's ratio. */}
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center" style={{ containerType: "size" }}>
        <div
          className="label-sheet relative overflow-hidden"
          style={{ aspectRatio: String(ratio), width: `min(100cqw, calc(100cqh * ${ratio}))` }}
        >
          <canvas ref={canvasRef} className="block h-full w-full" />
          {rendering && (
            <div className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white">
              <LoaderCircle className="size-3.5 animate-spin" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/90 p-6 text-center text-[#c92a2a]">
              <TriangleAlert className="size-6" />
              <p className="text-xs select-text">{error}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex w-full items-center justify-between gap-4 text-xs text-muted">
        <div className="flex items-center gap-1">
          <button
            className="rounded p-1 hover:bg-panel hover:text-ink disabled:opacity-30"
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
            aria-label={t("preview.previous")}
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="tabular min-w-20 text-center">
            {t("preview.page", { page: page + 1, count: pageCount })}
          </span>
          <button
            className="rounded p-1 hover:bg-panel hover:text-ink disabled:opacity-30"
            disabled={page >= pageCount - 1}
            onClick={() => onPageChange(page + 1)}
            aria-label={t("preview.next")}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="tabular flex items-center gap-3">
          <span>
            {formatMm(printer.widthMm)} × {formatMm(printer.heightMm)} mm · {printer.dpi} dpi
          </span>
          {result && (
            <>
              <span className="text-faint">|</span>
              <span className={result.relativeScale < SMALL_SCALE ? "font-medium text-warn" : ""}>
                {Math.round(result.relativeScale * 100)} %
                {result.placement.rotation !== 0 &&
                  ` · ${t("preview.rotated", { degrees: result.placement.rotation })}`}
              </span>
            </>
          )}
        </div>
      </div>

      {result && result.relativeScale < SMALL_SCALE && (
        <p className="-mt-2 flex items-center gap-1.5 self-end text-[11px] text-warn">
          <TriangleAlert className="size-3.5" />
          {t("preview.shrunk")}
        </p>
      )}
    </div>
  );
}
