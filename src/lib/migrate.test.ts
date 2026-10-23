import { describe, expect, it } from "vitest";

import { normalize } from "./migrate";

const usb = { type: "usb" as const, vendorId: 11836, productId: 22361, serial: "Q7" };

function v1Printer(id: string, size: { widthMm: number; heightMm: number }) {
  return {
    id,
    name: id,
    modelId: "phomemo-d530-pro",
    connection: usb,
    dpi: 300,
    ...size,
    mediaType: "gap" as const,
    gapMm: 3,
    gapOffsetMm: 0,
    density: null,
    speed: null,
    rotate180: false,
    tear: true,
    offsetXMm: 0,
    offsetYMm: 0,
  };
}

describe("normalize", () => {
  it("starts with a 4x6 shipping label paper", () => {
    const config = normalize(null);
    expect(config.version).toBe(2);
    expect(config.papers).toHaveLength(1);
    expect(config.papers[0].heightMm).toBe(152.4);
  });

  it("moves v1 paper fields into shared paper profiles", () => {
    const config = normalize({
      version: 1,
      activePrinterId: "a",
      printers: [
        v1Printer("a", { widthMm: 101.6, heightMm: 152.4 }),
        v1Printer("b", { widthMm: 101.6, heightMm: 152.4 }),
        v1Printer("c", { widthMm: 50, heightMm: 30 }),
      ],
    });

    // The default 4x6 paper is reused, the 50x30 roll gets its own profile.
    expect(config.papers).toHaveLength(2);
    const [a, b, c] = config.printers;
    expect(a.paperId).toBe(b.paperId);
    expect(c.paperId).not.toBe(a.paperId);
    expect(config.papers.find((p) => p.id === c.paperId)?.name).toBe("50 × 30 mm");
    expect(a).not.toHaveProperty("widthMm");
  });

  it("repairs printers pointing at a deleted paper", () => {
    const config = normalize({
      version: 2,
      papers: [{ id: "p1", name: "Klein", widthMm: 40, heightMm: 30, mediaType: "gap", gapMm: 2, gapOffsetMm: 0 }],
      printers: [{ ...v1Printer("a", { widthMm: 40, heightMm: 30 }), gapMm: 2, paperId: "gone" }],
    });
    expect(config.printers[0].paperId).toBe("p1");
  });
});
