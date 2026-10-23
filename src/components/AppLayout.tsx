import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FileDown, Printer, RefreshCw, ScrollText, Settings2 } from "lucide-react";

import { takePendingFiles } from "../lib/api";
import { useConfig } from "../lib/config";
import { useDocuments } from "../lib/documents";
import { connectionKind } from "../lib/printers";
import { summarize, useStatus } from "../lib/status";
import { StatusDot } from "./ui";

export const OPEN_FILTERS = [{ name: "Etiketten", extensions: ["pdf", "png", "jpg", "jpeg", "webp"] }];

export async function pickFiles(): Promise<string[]> {
  const picked = await open({ multiple: true, filters: OPEN_FILTERS });
  return picked ?? [];
}

/** Accepts files from drag & drop, ⌘O and Finder ("Öffnen mit"). */
function useFileIntake(): boolean {
  const { addPaths } = useDocuments();
  const navigate = useNavigate();
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const intake = (paths: string[]) => {
      if (paths.length === 0) return;
      navigate("/");
      void addPaths(paths);
    };

    const unlisteners = [
      getCurrentWebview().onDragDropEvent((event) => {
        const { type } = event.payload;
        if (type === "enter" || type === "over") setDragging(true);
        else if (type === "leave") setDragging(false);
        else if (type === "drop") {
          setDragging(false);
          intake(event.payload.paths);
        }
      }),
      listen("files-opened", () => void takePendingFiles().then(intake)),
    ];
    void takePendingFiles().then(intake);

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void pickFiles().then(intake);
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      unlisteners.forEach((p) => void p.then((unlisten) => unlisten()));
    };
  }, [addPaths, navigate]);

  return dragging;
}

const PICKER =
  "h-7 max-w-52 truncate rounded-md border border-line bg-panel px-2 text-xs font-medium outline-none focus:border-accent";

function PrinterPicker() {
  const { config, printers, activePrinter, setActivePrinter, updatePrinter } = useConfig();
  const status = useStatus();

  if (!activePrinter) {
    return (
      <NavLink to="/drucker" className="text-xs font-medium text-accent hover:underline">
        Drucker einrichten
      </NavLink>
    );
  }

  const entry = status.get(activePrinter.id);
  const summary = summarize(activePrinter, entry);

  return (
    <div className="flex items-center gap-2">
      <button
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-muted hover:bg-sunken hover:text-ink"
        title={entry.error ?? "Status aktualisieren"}
        onClick={() => void status.refresh(activePrinter)}
      >
        <StatusDot tone={entry.checking && !entry.status ? "busy" : summary.tone} />
        {summary.text}
        {entry.checking && <RefreshCw className="size-3 animate-spin" />}
      </button>
      <select
        className={PICKER}
        title="Aktiver Drucker"
        value={activePrinter.id}
        onChange={(e) => setActivePrinter(e.target.value)}
      >
        {printers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {connectionKind(p.connection)}
          </option>
        ))}
      </select>
      <select
        className={PICKER}
        title="Eingelegtes Papier"
        value={activePrinter.paperId}
        onChange={(e) => updatePrinter(activePrinter.id, { paperId: e.target.value })}
      >
        {config.papers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function Tab({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition ${
          isActive ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"
        }`
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}

export function AppLayout() {
  const dragging = useFileIntake();

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-canvas px-4">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-ink text-canvas">
            <Printer className="size-3.5" />
          </div>
          <span className="text-[13px] font-semibold tracking-tight">Thermalprinter</span>
        </div>
        <nav className="flex rounded-lg bg-sunken p-0.5">
          <Tab to="/" icon={<Printer className="size-3.5" />}>
            Drucken
          </Tab>
          <Tab to="/drucker" icon={<Settings2 className="size-3.5" />}>
            Drucker
          </Tab>
          <Tab to="/papier" icon={<ScrollText className="size-3.5" />}>
            Papier
          </Tab>
        </nav>
        <div className="flex-1" />
        <PrinterPicker />
      </header>

      <main className="relative min-h-0 flex-1">
        <Outlet />
        {dragging && (
          <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-accent">
              <FileDown className="size-10" />
              <span className="text-base font-semibold">Loslassen zum Öffnen</span>
              <span className="text-xs">PDF, PNG, JPG oder WebP</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
