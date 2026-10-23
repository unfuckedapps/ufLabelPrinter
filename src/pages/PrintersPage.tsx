import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Bluetooth,
  Cable,
  CircleCheck,
  Crosshair,
  FolderOpen,
  MoveVertical,
  Plus,
  Printer as PrinterIcon,
  RefreshCw,
  ScanLine,
  Server,
  Star,
  Trash2,
} from "lucide-react";

import { useToast } from "../components/Toasts";
import { Button, Field, NumberInput, Section, Segmented, Select, StatusDot, TextInput, Toggle } from "../components/ui";
import { calibrate, errorMessage, feedLabel, listDevices, openModelsDir, printJob } from "../lib/api";
import { useConfig } from "../lib/config";
import {
  describeConnection,
  formatMm,
  genericModelId,
  modelLabel,
  paperSummary,
  sameConnection,
} from "../lib/printers";
import { renderTestLabel } from "../lib/render";
import { summarize, useStatus } from "../lib/status";
import type { Connection, Devices, ModelRegistry, Printer, PrinterModel, PrinterProfile } from "../lib/types";

function ConnectionIcon({ connection, className = "size-4" }: { connection: Connection; className?: string }) {
  if (connection.type === "usb") return <Cable className={className} />;
  if (connection.type === "serial") return <Bluetooth className={className} />;
  return <Server className={className} />;
}

interface Candidate {
  key: string;
  name: string;
  detail: string;
  connection: Connection;
  /** Recognised from the model files; unknown devices get a generic TSPL model. */
  model: PrinterModel | null;
  recognised: boolean;
}

function candidates(devices: Devices, registry: ModelRegistry): Candidate[] {
  const find = (id: string | null) => registry.models.find((m) => m.id === id) ?? null;
  const resolve = (id: string | null, dpi: number) => ({
    model: find(id) ?? find(genericModelId(dpi)),
    recognised: find(id) !== null,
  });
  return [
    ...devices.usb.map((d) => ({
      key: `usb-${d.vendorId}-${d.productId}-${d.serial}`,
      name: d.cupsQueue?.replace(/_/g, " ") ?? find(d.modelId)?.name ?? d.product ?? "USB-Drucker",
      detail: [d.manufacturer, d.product, d.serial].filter(Boolean).join(" · "),
      connection: { type: "usb", vendorId: d.vendorId, productId: d.productId, serial: d.serial } as Connection,
      ...resolve(d.modelId, 203),
    })),
    ...devices.serial.map((s) => ({
      key: `serial-${s.path}`,
      name: s.name.replace(/-[0-9A-F]{4}$/i, ""),
      detail: s.path,
      connection: { type: "serial", path: s.path } as Connection,
      ...resolve(s.modelId, 203),
    })),
    ...devices.cups.map((q) => ({
      key: `cups-${q.name}`,
      name: q.name.replace(/_/g, " "),
      detail: `CUPS-Warteschlange · ${q.deviceUri.split("?")[0]}`,
      connection: { type: "cups", queue: q.name } as Connection,
      ...resolve(null, q.dpi ?? 203),
    })),
  ];
}

function DeviceFinder() {
  const { config, models, createPrinter } = useConfig();
  const toast = useToast();
  const [devices, setDevices] = useState<Devices | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      setDevices(await listDevices());
    } catch (err) {
      toast.error(`Gerätesuche fehlgeschlagen: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => void scan(), [scan]);

  const found = devices
    ? candidates(devices, models).filter(
        (c) =>
          // USB printer-class devices are printers by definition; serial ports and CUPS
          // queues can be anything, so only recognised ones are offered by default.
          (showAll || c.connection.type === "usb" || c.recognised) &&
          !config.printers.some((p) => sameConnection(p.connection, c.connection)),
      )
    : [];

  return (
    <Section
      title="Geräte hinzufügen"
      aside={
        <Button size="sm" variant="ghost" busy={loading} icon={<RefreshCw className="size-3.5" />} onClick={() => void scan()}>
          Suchen
        </Button>
      }
    >
      <ul className="flex flex-col gap-1">
        {found.map((c) => (
          <li key={c.key} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2">
            <span className="text-faint">
              <ConnectionIcon connection={c.connection} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{c.name}</span>
              <span className="truncate text-[11px] text-faint">
                {c.recognised && c.model ? `${modelLabel(c.model)} erkannt · ` : ""}
                {c.detail}
              </span>
            </div>
            <Button
              size="sm"
              icon={<Plus className="size-3.5" />}
              disabled={!c.model}
              onClick={() => {
                if (!c.model) return;
                createPrinter(c.name, c.connection, c.model);
                toast.success(`${c.name} hinzugefügt`);
              }}
            >
              Hinzufügen
            </Button>
          </li>
        ))}
        {devices && found.length === 0 && (
          <li className="px-1 text-xs leading-relaxed text-faint">
            Keine weiteren Drucker gefunden. Bluetooth-Drucker zuerst in den Systemeinstellungen koppeln.
          </li>
        )}
      </ul>
      <Toggle
        checked={showAll}
        onChange={setShowAll}
        label="Nicht erkannte Geräte anzeigen"
        hint="Alle Bluetooth-Ports und CUPS-Warteschlangen – für Drucker ohne Modelldatei."
      />
    </Section>
  );
}

function ModelLibrary() {
  const { models, reloadModels } = useConfig();
  const toast = useToast();
  const custom = models.models.filter((m) => m.custom);

  return (
    <Section
      title="Eigene Modelle"
      aside={
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => void reloadModels()}>
          Neu laden
        </Button>
      }
    >
      <p className="text-[11px] leading-relaxed text-faint">
        Neue Drucker lassen sich als JSON-Datei beschreiben – ohne die App neu zu bauen. Vorlagen liegen im Repository
        unter <code className="font-mono">src-tauri/models/</code>.
      </p>
      {custom.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {custom.map((m) => (
            <li key={m.id} className="truncate">
              {modelLabel(m)} <span className="text-faint">· {m.id}</span>
            </li>
          ))}
        </ul>
      )}
      {models.errors.map((e) => (
        <p key={e} className="rounded-md bg-err/10 p-2 font-mono text-[11px] text-err select-text">
          {e}
        </p>
      ))}
      <Button
        size="sm"
        icon={<FolderOpen className="size-3.5" />}
        onClick={() => void openModelsDir().catch((err) => toast.error(errorMessage(err)))}
      >
        Modellordner öffnen
      </Button>
    </Section>
  );
}

function PrinterEditor({ printer }: { printer: Printer }) {
  const { config, models, modelFor, updatePrinter, removePrinter, setActivePrinter } = useConfig();
  const status = useStatus();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<PrinterProfile>) => updatePrinter(printer.id, patch);

  useEffect(() => setConfirmDelete(false), [printer.id]);

  const run = async (key: string, action: () => Promise<void>, success: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const entry = status.get(printer.id);
  const summary = summarize(printer, entry);
  const isActive = config.activePrinterId === printer.id;
  const model = modelFor(printer);
  const tooWide = model !== null && printer.widthMm > model.maxWidthMm;
  const speeds = model?.speeds.length ? model.speeds : [2, 3, 4, 5, 6];
  const density = model?.density ?? { min: 0, max: 15 };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-lg font-semibold">{printer.name}</h2>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <ConnectionIcon connection={printer.connection} className="size-3.5" />
            {describeConnection(printer.connection)}
          </span>
        </div>
        {isActive ? (
          <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
            <Star className="size-3" /> Aktiver Drucker
          </span>
        ) : (
          <Button size="sm" icon={<Star className="size-3.5" />} onClick={() => setActivePrinter(printer.id)}>
            Als aktiv setzen
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-line bg-panel p-3">
        <StatusDot tone={entry.checking ? "busy" : summary.tone} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{entry.checking ? "Prüfe …" : summary.text}</span>
          <span className="truncate text-[11px] text-faint select-text">
            {entry.error ??
              (entry.status?.model
                ? `${entry.status.model} · Firmware ${entry.status.firmware ?? "?"}`
                : printer.connection.type === "cups"
                  ? "CUPS meldet keinen Gerätestatus"
                  : "Noch nicht abgefragt")}
          </span>
        </div>
        <Button size="sm" busy={entry.checking} icon={<RefreshCw className="size-3.5" />} onClick={() => void status.refresh(printer)}>
          Status
        </Button>
      </div>

      <Section title="Allgemein">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">
            <TextInput value={printer.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field
            label="Modell"
            hint={model ? (model.notes ?? `Druckersprache: ${model.protocol.toUpperCase()}`) : "Modelldatei fehlt"}
          >
            <Select
              value={printer.modelId}
              onChange={(modelId) => {
                const next = models.models.find((m) => m.id === modelId);
                set({ modelId, ...(next ? { dpi: next.dpi } : {}) });
              }}
              options={[
                ...models.models.map((m) => ({ value: m.id, label: modelLabel(m) })),
                ...(model ? [] : [{ value: printer.modelId, label: `${printer.modelId} (fehlt)` }]),
              ]}
            />
          </Field>
          <Field label="Auflösung" hint="Vom Modell vorgegeben, steht auch auf dem Typenschild">
            <Segmented
              value={printer.dpi}
              onChange={(dpi) => set({ dpi })}
              options={[
                { value: 203, label: "203 dpi" },
                { value: 300, label: "300 dpi" },
                { value: 600, label: "600 dpi" },
              ]}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Papier"
        aside={
          <Link to="/papier" className="text-[11px] font-medium text-accent hover:underline">
            Papier verwalten
          </Link>
        }
      >
        <Field
          label="Eingelegtes Papier"
          hint={
            tooWide
              ? `Breiter als der Druckkopf (${formatMm(model!.maxWidthMm)} mm) – rechts wird abgeschnitten.`
              : paperSummary(printer.paper)
          }
        >
          <Select
            value={printer.paperId}
            onChange={(paperId) => set({ paperId })}
            options={config.papers.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
      </Section>

      <Section title="Druck">
        <div className="grid grid-cols-2 gap-4">
          <Field
            label={
              <span className="flex justify-between">
                Druckdichte <span className="tabular text-faint">{printer.density ?? "Drucker"}</span>
              </span>
            }
            hint="Höher = schwärzer. Zu hoch lässt Barcodes verlaufen."
          >
            <div className="flex h-8 items-center gap-2">
              <input
                type="checkbox"
                className="size-3.5 accent-[var(--accent)]"
                title="Eigene Dichte verwenden"
                checked={printer.density !== null}
                onChange={(e) =>
                  set({ density: e.target.checked ? Math.round((density.min + density.max) / 2) : null })
                }
              />
              <input
                type="range"
                className="flex-1"
                min={density.min}
                max={density.max}
                disabled={printer.density === null}
                value={printer.density ?? Math.round((density.min + density.max) / 2)}
                onChange={(e) => set({ density: Number(e.target.value) })}
              />
            </div>
          </Field>
          <Field
            label="Geschwindigkeit"
            hint="Bricht der Drucker bei großen schwarzen Flächen ab und piept, hilft langsamer."
          >
            <Select
              value={printer.speed === null ? "default" : String(printer.speed)}
              onChange={(v) => set({ speed: v === "default" ? null : Number(v) })}
              options={[
                { value: "default", label: "Druckereinstellung" },
                ...speeds.map((s) => ({ value: String(s), label: `${s} Zoll/s${s <= 3 ? " (schonender)" : ""}` })),
              ]}
            />
          </Field>
        </div>
        <Toggle
          checked={printer.rotate180}
          onChange={(rotate180) => set({ rotate180 })}
          label="Ausdruck um 180° drehen"
          hint="Falls Etiketten kopfüber aus dem Drucker kommen"
        />
        <Toggle
          checked={printer.tear}
          onChange={(tear) => set({ tear })}
          label="Bis zur Abreißkante vorschieben"
          hint="Schiebt das fertige Etikett so weit vor, dass es abgerissen werden kann"
        />
      </Section>

      <Section title="Feinjustierung">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Versatz horizontal" hint="Positiv = nach rechts">
            <NumberInput value={printer.offsetXMm} onChange={(offsetXMm) => set({ offsetXMm })} unit="mm" min={-20} max={20} step={0.5} />
          </Field>
          <Field label="Versatz vertikal" hint="Positiv = nach unten">
            <NumberInput value={printer.offsetYMm} onChange={(offsetYMm) => set({ offsetYMm })} unit="mm" min={-20} max={20} step={0.5} />
          </Field>
        </div>
      </Section>

      <Section title="Werkzeuge">
        <div className="flex flex-wrap gap-2">
          <Button
            busy={busy === "test"}
            disabled={busy !== null}
            icon={<Crosshair className="size-4" />}
            onClick={() =>
              void run("test", () => printJob(printer, [{ bitmap: renderTestLabel(printer), copies: 1 }]), "Testetikett gesendet")
            }
          >
            Testetikett
          </Button>
          <Button
            busy={busy === "feed"}
            disabled={busy !== null}
            icon={<MoveVertical className="size-4" />}
            onClick={() => void run("feed", () => feedLabel(printer), "Ein Etikett vorgeschoben")}
          >
            Vorschub
          </Button>
          {printer.mediaType !== "continuous" && (
            <Button
              busy={busy === "calibrate"}
              disabled={busy !== null}
              icon={<ScanLine className="size-4" />}
              title="Misst Etikett und Lücke neu ein – schiebt dabei einige Etiketten vor"
              onClick={() => void run("calibrate", () => calibrate(printer), "Kalibrierung gestartet")}
            >
              Sensor kalibrieren
            </Button>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-faint">
          Das Testetikett zeigt einen Rahmen genau an der Etikettenkante, Lineale und Linienmuster. Sitzt der Rahmen
          schief, mit der Feinjustierung nachstellen. Nach einem Rollenwechsel einmal kalibrieren.
        </p>
      </Section>

      <div className="border-t border-line pt-5">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs text-muted">„{printer.name}“ wirklich entfernen?</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Abbrechen
            </Button>
            <Button size="sm" variant="danger" onClick={() => removePrinter(printer.id)}>
              Entfernen
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
            Drucker entfernen
          </Button>
        )}
      </div>
    </div>
  );
}

export function PrintersPage() {
  const { config, printers } = useConfig();
  const status = useStatus();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    printers.find((p) => p.id === selectedId) ??
    printers.find((p) => p.id === config.activePrinterId) ??
    printers[0] ??
    null;

  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <aside className="flex min-h-0 flex-col gap-8 overflow-y-auto border-r border-line p-4">
        <Section title="Eingerichtet">
          <ul className="flex flex-col gap-1">
            {printers.map((p) => {
              const summary = summarize(p, status.get(p.id));
              return (
                <li key={p.id}>
                  <button
                    onClick={() => setSelectedId(p.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                      p.id === selected?.id ? "border-accent/50 bg-panel shadow-sm" : "border-transparent hover:bg-panel/60"
                    }`}
                  >
                    <span className="text-faint">
                      <ConnectionIcon connection={p.connection} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5 truncate font-medium">
                        {p.name}
                        {config.activePrinterId === p.id && <CircleCheck className="size-3.5 text-accent" />}
                      </span>
                      <span className="truncate text-[11px] text-faint">
                        {p.paper.name} · {p.dpi} dpi
                      </span>
                    </div>
                    <StatusDot tone={summary.tone} />
                  </button>
                </li>
              );
            })}
            {printers.length === 0 && (
              <li className="px-1 text-xs text-faint">Noch keine Drucker. Unten ein Gerät hinzufügen.</li>
            )}
          </ul>
        </Section>
        <DeviceFinder />
        <ModelLibrary />
      </aside>

      <section className="min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-8">
          {selected ? (
            <PrinterEditor printer={selected} />
          ) : (
            <div className="flex flex-col items-center gap-3 pt-24 text-center text-muted">
              <PrinterIcon className="size-8 text-faint" />
              Wähle links einen Drucker aus oder füge ein Gerät hinzu.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
