import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { errorMessage, listDevices, listModels, loadConfig, saveConfig } from "./api";
import { normalize, type StoredConfig } from "./migrate";
import { DEFAULT_CONFIG, ensurePaper, genericModelId, modelPaper, newPrinter, resolvePrinter } from "./printers";
import type {
  AppConfig,
  Connection,
  LayoutOptions,
  ModelRegistry,
  PaperProfile,
  Printer,
  PrinterModel,
  PrinterProfile,
} from "./types";

interface ConfigApi {
  config: AppConfig;
  ready: boolean;
  models: ModelRegistry;
  /** Re-reads the model files, e.g. after the user added one. */
  reloadModels(): Promise<void>;
  modelFor(printer: PrinterProfile): PrinterModel | null;
  /** All printers with their loaded paper resolved. */
  printers: Printer[];
  activePrinter: Printer | null;
  setActivePrinter(id: string): void;
  /** Adds a printer and picks (or creates) a paper profile matching the model's defaults. */
  createPrinter(name: string, connection: Connection, model: PrinterModel): void;
  updatePrinter(id: string, patch: Partial<PrinterProfile>): void;
  removePrinter(id: string): void;
  addPaper(paper: PaperProfile): void;
  updatePaper(id: string, patch: Partial<PaperProfile>): void;
  /** Printers that had this paper loaded switch to `replacementId`. */
  removePaper(id: string, replacementId: string): void;
  setLayout(patch: Partial<LayoutOptions>): void;
}

const ConfigContext = createContext<ConfigApi | null>(null);

const NO_MODELS: ModelRegistry = { models: [], errors: [] };

/** First start: set up every connected USB printer so the user can print right away. */
async function detectPrinters(config: AppConfig, registry: ModelRegistry): Promise<AppConfig> {
  const byId = (id: string | null) => registry.models.find((m) => m.id === id);
  const devices = await listDevices();
  let { papers } = config;
  const printers: PrinterProfile[] = [];
  for (const d of devices.usb) {
    const model = byId(d.modelId) ?? byId(genericModelId(203));
    if (!model) continue;
    const ensured = ensurePaper(papers, modelPaper(model));
    papers = ensured.papers;
    const name = d.cupsQueue?.replace(/_/g, " ") ?? (d.modelId ? model.name : (d.product ?? "USB-Drucker"));
    const connection: Connection = { type: "usb", vendorId: d.vendorId, productId: d.productId, serial: d.serial };
    printers.push(newPrinter(name, connection, model, ensured.paperId));
  }
  return { ...config, printers, papers, activePrinterId: printers[0]?.id ?? null };
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [models, setModels] = useState<ModelRegistry>(NO_MODELS);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const registry = await listModels().catch(() => NO_MODELS);
      let loaded = normalize((await loadConfig().catch(() => null)) as StoredConfig | null);
      if (loaded.printers.length === 0) {
        loaded = await detectPrinters(loaded, registry).catch(() => loaded);
      }
      if (!cancelled) {
        setModels(registry);
        setConfig(loaded);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveConfig(config).catch((err) => console.error("Konfiguration nicht gespeichert:", errorMessage(err)));
    }, 300);
  }, [config, ready]);

  const update = useCallback((recipe: (c: AppConfig) => AppConfig) => setConfig(recipe), []);

  const reloadModels = useCallback(async () => {
    setModels(await listModels());
  }, []);

  const api = useMemo<ConfigApi>(() => {
    const printers = config.printers.map((p) => resolvePrinter(p, config.papers));
    const activePrinter = printers.find((p) => p.id === config.activePrinterId) ?? printers[0] ?? null;
    return {
      config,
      ready,
      models,
      reloadModels,
      modelFor: (printer) => models.models.find((m) => m.id === printer.modelId) ?? null,
      printers,
      activePrinter,
      setActivePrinter: (id) => update((c) => ({ ...c, activePrinterId: id })),
      createPrinter: (name, connection, model) =>
        update((c) => {
          const { papers, paperId } = ensurePaper(c.papers, modelPaper(model));
          const printer = newPrinter(name, connection, model, paperId);
          return {
            ...c,
            papers,
            printers: [...c.printers, printer],
            activePrinterId: c.activePrinterId ?? printer.id,
          };
        }),
      updatePrinter: (id, patch) =>
        update((c) => ({
          ...c,
          printers: c.printers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      removePrinter: (id) =>
        update((c) => {
          const remaining = c.printers.filter((p) => p.id !== id);
          return {
            ...c,
            printers: remaining,
            activePrinterId: c.activePrinterId === id ? (remaining[0]?.id ?? null) : c.activePrinterId,
          };
        }),
      addPaper: (paper) => update((c) => ({ ...c, papers: [...c.papers, paper] })),
      updatePaper: (id, patch) =>
        update((c) => ({ ...c, papers: c.papers.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removePaper: (id, replacementId) =>
        update((c) => {
          if (c.papers.length <= 1) return c;
          return {
            ...c,
            papers: c.papers.filter((p) => p.id !== id),
            printers: c.printers.map((p) => (p.paperId === id ? { ...p, paperId: replacementId } : p)),
          };
        }),
      setLayout: (patch) => update((c) => ({ ...c, layout: { ...c.layout, ...patch } })),
    };
  }, [config, ready, models, reloadModels, update]);

  return <ConfigContext.Provider value={api}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigApi {
  const api = useContext(ConfigContext);
  if (!api) throw new Error("useConfig must be used inside <ConfigProvider>");
  return api;
}
