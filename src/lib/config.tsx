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
import { DEFAULT_CONFIG, DEFAULT_LAYOUT, genericModelId, newPrinter } from "./printers";
import type { AppConfig, LayoutOptions, ModelRegistry, PrinterModel, PrinterProfile } from "./types";

interface ConfigApi {
  config: AppConfig;
  ready: boolean;
  models: ModelRegistry;
  /** Re-reads the model files, e.g. after the user added one. */
  reloadModels(): Promise<void>;
  modelFor(printer: PrinterProfile): PrinterModel | null;
  activePrinter: PrinterProfile | null;
  setActivePrinter(id: string): void;
  addPrinter(printer: PrinterProfile): void;
  updatePrinter(id: string, patch: Partial<PrinterProfile>): void;
  removePrinter(id: string): void;
  setLayout(patch: Partial<LayoutOptions>): void;
}

const ConfigContext = createContext<ConfigApi | null>(null);

const NO_MODELS: ModelRegistry = { models: [], errors: [] };

/** Fills fields added in later versions so old config files keep working. */
function normalize(raw: AppConfig | null): AppConfig {
  if (!raw) return DEFAULT_CONFIG;
  return {
    version: 1,
    printers: (raw.printers ?? []).map((p) => ({
      ...p,
      modelId: p.modelId ?? genericModelId(p.dpi),
    })),
    activePrinterId: raw.activePrinterId ?? null,
    layout: { ...DEFAULT_LAYOUT, ...raw.layout },
  };
}

/** First start: set up every connected USB printer so the user can print right away. */
async function detectPrinters(registry: ModelRegistry): Promise<PrinterProfile[]> {
  const byId = (id: string | null) => registry.models.find((m) => m.id === id);
  const devices = await listDevices();
  return devices.usb.flatMap((d) => {
    const model = byId(d.modelId) ?? byId(genericModelId(203));
    if (!model) return [];
    const name = d.cupsQueue?.replace(/_/g, " ") ?? (d.modelId ? model.name : (d.product ?? "USB-Drucker"));
    return [newPrinter(name, { type: "usb", vendorId: d.vendorId, productId: d.productId, serial: d.serial }, model)];
  });
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
      let loaded = normalize(await loadConfig().catch(() => null));
      if (loaded.printers.length === 0) {
        const detected = await detectPrinters(registry).catch(() => []);
        loaded = { ...loaded, printers: detected, activePrinterId: detected[0]?.id ?? null };
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
    const activePrinter =
      config.printers.find((p) => p.id === config.activePrinterId) ?? config.printers[0] ?? null;
    return {
      config,
      ready,
      models,
      reloadModels,
      modelFor: (printer) => models.models.find((m) => m.id === printer.modelId) ?? null,
      activePrinter,
      setActivePrinter: (id) => update((c) => ({ ...c, activePrinterId: id })),
      addPrinter: (printer) =>
        update((c) => ({
          ...c,
          printers: [...c.printers, printer],
          activePrinterId: c.activePrinterId ?? printer.id,
        })),
      updatePrinter: (id, patch) =>
        update((c) => ({
          ...c,
          printers: c.printers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      removePrinter: (id) =>
        update((c) => {
          const printers = c.printers.filter((p) => p.id !== id);
          return {
            ...c,
            printers,
            activePrinterId: c.activePrinterId === id ? (printers[0]?.id ?? null) : c.activePrinterId,
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
