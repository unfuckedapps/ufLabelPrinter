import { describe, expect, it } from "vitest";

import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { createTranslator, describeError } from ".";

function keys(node: object, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : keys(value as object, `${prefix}${key}.`),
  );
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe("dictionaries", () => {
  const reference = keys(en).sort();

  it.each([
    ["de", de],
    ["fr", fr],
    ["es", es],
  ])("%s has exactly the English keys and placeholders", (_, dict) => {
    expect(keys(dict).sort()).toEqual(reference);
    for (const key of reference) {
      const lookup = (d: object) => key.split(".").reduce<any>((n, k) => n[k], d) as string;
      expect(placeholders(lookup(dict)), key).toEqual(placeholders(lookup(en)));
    }
  });
});

describe("translator", () => {
  it("interpolates and pluralises per language", () => {
    const t = createTranslator("de");
    expect(t("print.on", { printer: "D530 Pro" })).toBe("auf D530 Pro · ⌘P");
    expect(t.plural("print.button", 1)).toBe("1 Etikett drucken");
    expect(t.plural("print.button", 3)).toBe("3 Etiketten drucken");
    // French treats 0 as singular.
    expect(createTranslator("fr").plural("documents.pages", 0)).toBe("0 page");
  });

  it("formats numbers with the language's decimal separator", () => {
    expect(createTranslator("de").number(101.6)).toBe("101,6");
    expect(createTranslator("en").number(101.6)).toBe("101.6");
    expect(createTranslator("en").number(152.4)).toBe("152.4");
  });
});

describe("describeError", () => {
  const t = createTranslator("en");

  it("translates coded Rust errors with their parameters", () => {
    expect(describeError(t, { code: "stalled", detail: "x", sentKb: 2, totalKb: 15 })).toBe(
      "Bluetooth transfer stalled at 2 of 15 KB – printer out of range or disconnected?",
    );
    expect(describeError(createTranslator("de"), { code: "cancelled", detail: "cancelled" })).toBe(
      "Druck abgebrochen",
    );
  });

  it("keeps the detail for generic categories and unknown codes", () => {
    expect(describeError(t, { code: "usb", detail: "pipe error" })).toBe("USB error: pipe error");
    expect(describeError(t, { code: "somethingNew", detail: "raw detail" })).toBe("raw detail");
    expect(describeError(t, "plain string")).toBe("plain string");
  });
});
