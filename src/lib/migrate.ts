import { DEFAULT_CONFIG, DEFAULT_LAYOUT, DEFAULT_PAPERS, ensurePaper, genericModelId } from "./printers";
import type { AppConfig, MediaType, PrinterProfile } from "./types";

/** Printer profiles of version 1 carried the paper fields themselves. */
interface PrinterProfileV1 extends Omit<PrinterProfile, "paperId"> {
  paperId?: string;
  widthMm?: number;
  heightMm?: number;
  mediaType?: MediaType;
  gapMm?: number;
  gapOffsetMm?: number;
}

export type StoredConfig = Omit<Partial<AppConfig>, "version" | "printers"> & {
  version?: number;
  printers?: PrinterProfileV1[];
};

/** Upgrades older config files and fills fields added in later versions. */
export function normalize(raw: StoredConfig | null): AppConfig {
  if (!raw) return DEFAULT_CONFIG;

  let papers = raw.papers?.length ? raw.papers : DEFAULT_PAPERS;
  const printers = (raw.printers ?? []).map((p): PrinterProfile => {
    const { widthMm, heightMm, mediaType, gapMm, gapOffsetMm, ...rest } = p;
    let paperId = p.paperId;
    if (!paperId || !papers.some((x) => x.id === paperId)) {
      const ensured = ensurePaper(papers, {
        widthMm: widthMm ?? 101.6,
        heightMm: heightMm ?? 152.4,
        mediaType: mediaType ?? "gap",
        gapMm: gapMm ?? 3,
        gapOffsetMm: gapOffsetMm ?? 0,
      });
      papers = ensured.papers;
      paperId = ensured.paperId;
    }
    return { ...rest, modelId: p.modelId ?? genericModelId(p.dpi), paperId };
  });

  return {
    version: 2,
    printers,
    papers,
    activePrinterId: raw.activePrinterId ?? null,
    layout: { ...DEFAULT_LAYOUT, ...raw.layout },
  };
}
