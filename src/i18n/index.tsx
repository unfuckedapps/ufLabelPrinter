import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { de } from "./de";
import { en, type Dictionary } from "./en";
import { es } from "./es";
import { fr } from "./fr";

export type Language = "en" | "de" | "fr" | "es";

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
];

const DICTIONARIES: Record<Language, Dictionary> = { en, de, fr, es };

type Plural = { one: string; other: string };

/** Dotted paths to plain strings, e.g. `"print.button"`. */
type StringKey<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends Plural
      ? never
      : StringKey<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Dotted paths to `{ one, other }` plural entries. */
type PluralKey<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends Plural
    ? `${P}${K}`
    : T[K] extends string
      ? never
      : PluralKey<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TKey = StringKey<Dictionary>;
export type TPluralKey = PluralKey<Dictionary>;
export type Params = Record<string, string | number>;

export interface Translator {
  language: Language;
  /** Translates a key, replacing `{name}` placeholders. */
  (key: TKey, params?: Params): string;
  /** Picks the plural form for `count` and replaces `{count}` and other placeholders. */
  plural(key: TPluralKey, count: number, params?: Params): string;
  /** Locale-aware number, at most `digits` decimals. */
  number(value: number, digits?: number): string;
  time(timestamp: number): string;
}

function lookup(dict: Dictionary, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);
}

function interpolate(text: string, params?: Params): string {
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text;
}

export function createTranslator(language: Language): Translator {
  const dict = DICTIONARIES[language];
  const pluralRules = new Intl.PluralRules(language);
  const t = ((key: TKey, params?: Params) => {
    const value = lookup(dict, key) ?? lookup(en, key);
    return typeof value === "string" ? interpolate(value, params) : key;
  }) as Translator;
  t.language = language;
  t.plural = (key, count, params) => {
    const forms = (lookup(dict, key) ?? lookup(en, key)) as Plural | undefined;
    if (!forms) return key;
    const form = pluralRules.select(count) === "one" ? forms.one : forms.other;
    return interpolate(form, { count: t.number(count), ...params });
  };
  t.number = (value, digits = 1) =>
    new Intl.NumberFormat(language, { maximumFractionDigits: digits, useGrouping: false }).format(value);
  t.time = (timestamp) =>
    new Date(timestamp).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  return t;
}

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((l) => l.value === value);
}

// Outside React (error boundary, formatting helpers) the current language is read from
// here; the provider keeps it in sync.
let current = createTranslator("en");

/** The translator for the active language, usable outside components. */
export function translator(): Translator {
  return current;
}

const I18nContext = createContext<Translator>(current);

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const t = useMemo(() => createTranslator(language), [language]);
  current = t;
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): Translator {
  return useContext(I18nContext);
}

/** Errors from Rust arrive as `{ code, detail, ...params }`; everything else is shown as is. */
export function describeError(t: Translator, err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const { code, detail, ...params } = err as { code: string; detail?: string } & Params;
    const key = `errors.${code}` as TKey;
    const text = t(key, params);
    if (text === key) return detail ?? code;
    // Generic categories carry the useful part in the detail.
    return ["notFound", "busy", "usb", "invalidJob", "io", "other"].includes(code) && detail
      ? `${text}: ${detail}`
      : text;
  }
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return JSON.stringify(err);
}
