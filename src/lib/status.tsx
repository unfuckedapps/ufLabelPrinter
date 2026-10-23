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

import { errorMessage, printerStatus } from "./api";
import { useConfig } from "./config";
import type { PrinterProfile, PrinterStatus } from "./types";

export interface StatusEntry {
  status: PrinterStatus | null;
  error: string | null;
  checking: boolean;
  printing: boolean;
}

interface StatusApi {
  get(printerId: string): StatusEntry;
  refresh(printer: PrinterProfile): Promise<void>;
  setPrinting(printerId: string, printing: boolean): void;
}

const EMPTY: StatusEntry = { status: null, error: null, checking: false, printing: false };

/** USB status reads are cheap; Bluetooth would reconnect every time, so it is on demand. */
const USB_POLL_MS = 10_000;

const StatusContext = createContext<StatusApi | null>(null);

export function StatusProvider({ children }: { children: ReactNode }) {
  const { activePrinter } = useConfig();
  const [entries, setEntries] = useState<Record<string, StatusEntry>>({});
  const inFlight = useRef(new Set<string>());

  const patch = useCallback((id: string, update: Partial<StatusEntry>) => {
    setEntries((all) => ({ ...all, [id]: { ...EMPTY, ...all[id], ...update } }));
  }, []);

  const refresh = useCallback(
    async (printer: PrinterProfile) => {
      if (inFlight.current.has(printer.id)) return;
      inFlight.current.add(printer.id);
      patch(printer.id, { checking: true });
      try {
        patch(printer.id, { status: await printerStatus(printer), error: null });
      } catch (err) {
        patch(printer.id, { status: null, error: errorMessage(err) });
      } finally {
        inFlight.current.delete(printer.id);
        patch(printer.id, { checking: false });
      }
    },
    [patch],
  );

  // Keep a stable reference for the poll loop without restarting it on every config edit.
  const activeRef = useRef(activePrinter);
  activeRef.current = activePrinter;
  const activeId = activePrinter?.id;
  const activeType = activePrinter?.connection.type;

  useEffect(() => {
    const printer = activeRef.current;
    // Other transports are only queried on demand: Bluetooth would reconnect each time
    // and printers of unknown brands might not understand the Phomemo status queries.
    if (!printer || activeType !== "usb") return;
    void refresh(printer);

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && activeRef.current) void refresh(activeRef.current);
    }, USB_POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeId, activeType, refresh]);

  const api = useMemo<StatusApi>(
    () => ({
      get: (id) => entries[id] ?? EMPTY,
      refresh,
      setPrinting: (id, printing) => patch(id, { printing }),
    }),
    [entries, refresh, patch],
  );

  return <StatusContext.Provider value={api}>{children}</StatusContext.Provider>;
}

export function useStatus(): StatusApi {
  const api = useContext(StatusContext);
  if (!api) throw new Error("useStatus must be used inside <StatusProvider>");
  return api;
}

export interface StatusSummary {
  tone: "ok" | "warn" | "err" | "idle" | "busy";
  text: string;
}

export function summarize(printer: PrinterProfile, entry: StatusEntry): StatusSummary {
  if (entry.printing) return { tone: "busy", text: "Sendet …" };
  if (entry.error) return { tone: "err", text: "Nicht erreichbar" };
  const s = entry.status;
  if (s?.printing) return { tone: "busy", text: "Druckt …" };
  if (!s) return { tone: "idle", text: entry.checking ? "Prüfe …" : "Status unbekannt" };
  if (!s.connected) {
    return { tone: "idle", text: printer.connection.type === "cups" ? "Über CUPS" : "Status unbekannt" };
  }
  if (s.coverOpen) return { tone: "err", text: "Deckel offen" };
  if (s.paper === false) return { tone: "err", text: "Kein Papier" };
  if (!s.responsive) return { tone: "ok", text: "Verbunden" };
  return { tone: "ok", text: "Bereit" };
}
