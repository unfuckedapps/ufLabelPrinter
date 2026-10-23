import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Bluetooth,
  BluetoothSearching,
  Cable,
  CircleCheck,
  Crosshair,
  FileText,
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
import { translator, useT } from "../i18n";
import { Button, Field, NumberInput, Section, Segmented, Select, StatusDot, TextInput, Toggle } from "../components/ui";
import { calibrate, errorMessage, feedLabel, listDevices, openLogDir, openModelsDir, printJob, scanBle } from "../lib/api";
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
import type {
  BleDevice,
  Connection,
  Devices,
  ModelRegistry,
  Printer,
  PrinterModel,
  PrinterProfile,
} from "../lib/types";

function ConnectionIcon({ connection, className = "size-4" }: { connection: Connection; className?: string }) {
  if (connection.type === "usb") return <Cable className={className} />;
  if (connection.type === "serial") return <Bluetooth className={className} />;
  if (connection.type === "ble") {
    return (
      <span className="relative inline-flex">
        <Bluetooth className={className} />
        <span className="absolute -right-2 -bottom-1 rounded-sm bg-accent px-0.5 text-[7px] leading-tight font-bold text-on-accent">
          LE
        </span>
      </span>
    );
  }
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

function candidates(devices: Devices, ble: BleDevice[], registry: ModelRegistry): Candidate[] {
  const find = (id: string | null) => registry.models.find((m) => m.id === id) ?? null;
  const resolve = (id: string | null, dpi: number) => ({
    model: find(id) ?? find(genericModelId(dpi)),
    recognised: find(id) !== null,
  });
  return [
    ...devices.usb.map((d) => ({
      key: `usb-${d.vendorId}-${d.productId}-${d.serial}`,
      name:
        d.cupsQueue?.replace(/_/g, " ") ??
        find(d.modelId)?.name ??
        d.product ??
        translator()("printers.add.usbPrinter"),
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
    ...ble.map((d) => ({
      key: `ble-${d.id}`,
      name: d.name,
      detail: `${translator()("connection.ble")}${d.rssi === null ? "" : ` · ${d.rssi} dBm`}`,
      connection: { type: "ble", id: d.id, name: d.name } as Connection,
      ...resolve(d.modelId, 203),
    })),
    ...devices.cups.map((q) => ({
      key: `cups-${q.name}`,
      name: q.name.replace(/_/g, " "),
      detail: `${translator()("printers.add.cupsQueue")} · ${q.deviceUri.split("?")[0]}`,
      connection: { type: "cups", queue: q.name } as Connection,
      ...resolve(null, q.dpi ?? 203),
    })),
  ];
}

function DeviceFinder() {
  const { config, models, createPrinter } = useConfig();
  const toast = useToast();
  const t = useT();
  const [devices, setDevices] = useState<Devices | null>(null);
  const [loading, setLoading] = useState(false);
  const [ble, setBle] = useState<BleDevice[]>([]);
  const [scanningBle, setScanningBle] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      setDevices(await listDevices());
    } catch (err) {
      toast.error(t("printers.add.scanFailed", { error: errorMessage(err) }));
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => void scan(), [scan]);

  // Not automatic: a BLE scan takes seconds and may ask for Bluetooth permission.
  const searchBle = async () => {
    setScanningBle(true);
    try {
      setBle(await scanBle());
    } catch (err) {
      toast.error(t("printers.add.bleFailed", { error: errorMessage(err) }));
    } finally {
      setScanningBle(false);
    }
  };

  const simplify = (name: string) => name.toLowerCase().replace(/[\s_-]/g, "");
  const bleNames = new Set(ble.map((d) => simplify(d.name)));
  const found = devices
    ? candidates(devices, ble, models).filter(
        (c) =>
          // USB printer-class devices are printers by definition; serial ports and CUPS
          // queues can be anything, so only recognised ones are offered by default.
          (showAll || c.connection.type === "usb" || c.recognised) &&
          // Dual-mode printers found via LE as well: LE is the reliable way on macOS.
          (showAll || c.connection.type !== "serial" || !bleNames.has(simplify(c.name))) &&
          !config.printers.some((p) => sameConnection(p.connection, c.connection)),
      )
    : [];

  return (
    <Section
      title={t("printers.add.title")}
      aside={
        <Button size="sm" variant="ghost" busy={loading} icon={<RefreshCw className="size-3.5" />} onClick={() => void scan()}>
          {t("printers.add.search")}
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
                {c.recognised && c.model ? `${t("printers.add.recognised", { model: modelLabel(c.model) })} · ` : ""}
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
                toast.success(t("printers.add.added", { name: c.name }));
              }}
            >
              {t("printers.add.add")}
            </Button>
          </li>
        ))}
        {devices && found.length === 0 && (
          <li className="px-1 text-xs leading-relaxed text-faint">
            {t("printers.add.none")}
          </li>
        )}
      </ul>
      <div className="flex flex-col gap-1.5">
        <Button
          size="sm"
          busy={scanningBle}
          icon={<BluetoothSearching className="size-3.5" />}
          onClick={() => void searchBle()}
        >
          {scanningBle ? t("printers.add.scanning") : t("printers.add.scanBle")}
        </Button>
        <p className="px-1 text-[11px] leading-snug text-faint">{t("printers.add.bleHint")}</p>
      </div>
      <Toggle
        checked={showAll}
        onChange={setShowAll}
        label={t("printers.add.showAll")}
        hint={t("printers.add.showAllHint")}
      />
    </Section>
  );
}

function ModelLibrary() {
  const { models, reloadModels } = useConfig();
  const toast = useToast();
  const t = useT();
  const custom = models.models.filter((m) => m.custom);

  return (
    <Section
      title={t("printers.models.title")}
      aside={
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => void reloadModels()}>
          {t("printers.models.reload")}
        </Button>
      }
    >
      <p className="text-[11px] leading-relaxed text-faint">
        {t("printers.models.intro")} <code className="font-mono">src-tauri/models/</code>.
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
        {t("printers.models.openFolder")}
      </Button>
    </Section>
  );
}

function PrinterEditor({ printer }: { printer: Printer }) {
  const { config, models, modelFor, updatePrinter, removePrinter, setActivePrinter } = useConfig();
  const status = useStatus();
  const toast = useToast();
  const t = useT();
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
            <Star className="size-3" /> {t("printers.editor.active")}
          </span>
        ) : (
          <Button size="sm" icon={<Star className="size-3.5" />} onClick={() => setActivePrinter(printer.id)}>
            {t("printers.editor.makeActive")}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-line bg-panel p-3">
        <StatusDot tone={entry.checking ? "busy" : summary.tone} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{entry.checking ? t("status.checking") : summary.text}</span>
          <span className="truncate text-[11px] text-faint select-text">
            {entry.error ??
              (entry.status?.model
                ? t("printers.editor.firmware", { model: entry.status.model, firmware: entry.status.firmware ?? "?" })
                : printer.connection.type === "cups"
                  ? t("printers.editor.cupsNoStatus")
                  : entry.status?.connected && !entry.status.responsive
                    ? t("printers.editor.noAnswer")
                    : t("printers.editor.notQueried"))}
          </span>
        </div>
        <Button size="sm" busy={entry.checking} icon={<RefreshCw className="size-3.5" />} onClick={() => void status.refresh(printer)}>
          {t("printers.editor.status")}
        </Button>
      </div>

      <Section title={t("printers.editor.general")}>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("printers.editor.name")}>
            <TextInput value={printer.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field
            label={t("printers.editor.model")}
            hint={
              model
                ? (model.notes ?? t("printers.editor.protocol", { protocol: model.protocol.toUpperCase() }))
                : t("printers.editor.modelMissing")
            }
          >
            <Select
              value={printer.modelId}
              onChange={(modelId) => {
                const next = models.models.find((m) => m.id === modelId);
                set({ modelId, ...(next ? { dpi: next.dpi } : {}) });
              }}
              options={[
                ...models.models.map((m) => ({ value: m.id, label: modelLabel(m) })),
                ...(model ? [] : [{ value: printer.modelId, label: t("printers.editor.missing", { id: printer.modelId }) }]),
              ]}
            />
          </Field>
          <Field label={t("printers.editor.resolution")} hint={t("printers.editor.resolutionHint")}>
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
        title={t("printers.editor.paper")}
        aside={
          <Link to="/paper" className="text-[11px] font-medium text-accent hover:underline">
            {t("printers.editor.managePaper")}
          </Link>
        }
      >
        <Field
          label={t("printers.editor.loadedPaper")}
          hint={
            tooWide
              ? t("printers.editor.tooWide", { width: formatMm(model!.maxWidthMm) })
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

      <Section title={t("printers.editor.printing")}>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label={
              <span className="flex justify-between">
                {t("printers.editor.density")}{" "}
                <span className="tabular text-faint">{printer.density ?? t("printers.editor.densityPrinter")}</span>
              </span>
            }
            hint={t("printers.editor.densityHint")}
          >
            <div className="flex h-8 items-center gap-2">
              <input
                type="checkbox"
                className="size-3.5 accent-[var(--accent)]"
                title={t("printers.editor.customDensity")}
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
            label={t("printers.editor.speed")}
            hint={t("printers.editor.speedHint")}
          >
            <Select
              value={printer.speed === null ? "default" : String(printer.speed)}
              onChange={(v) => set({ speed: v === "default" ? null : Number(v) })}
              options={[
                { value: "default", label: t("printers.editor.printerSetting") },
                ...speeds.map((s) => ({
                  value: String(s),
                  label: t(s <= 3 ? "printers.editor.gentler" : "printers.editor.speedOption", { speed: s }),
                })),
              ]}
            />
          </Field>
        </div>
        <Toggle
          checked={printer.rotate180}
          onChange={(rotate180) => set({ rotate180 })}
          label={t("printers.editor.rotate180")}
          hint={t("printers.editor.rotate180Hint")}
        />
        <Toggle
          checked={printer.tear}
          onChange={(tear) => set({ tear })}
          label={t("printers.editor.tear")}
          hint={t("printers.editor.tearHint")}
        />
      </Section>

      <Section title={t("printers.editor.fineTuning")}>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("printers.editor.offsetX")} hint={t("printers.editor.offsetXHint")}>
            <NumberInput value={printer.offsetXMm} onChange={(offsetXMm) => set({ offsetXMm })} unit="mm" min={-20} max={20} step={0.5} />
          </Field>
          <Field label={t("printers.editor.offsetY")} hint={t("printers.editor.offsetYHint")}>
            <NumberInput value={printer.offsetYMm} onChange={(offsetYMm) => set({ offsetYMm })} unit="mm" min={-20} max={20} step={0.5} />
          </Field>
        </div>
      </Section>

      <Section title={t("printers.editor.tools")}>
        <div className="flex flex-wrap gap-2">
          <Button
            busy={busy === "test"}
            disabled={busy !== null}
            icon={<Crosshair className="size-4" />}
            onClick={() =>
              void run(
                "test",
                () => printJob(printer, [{ bitmap: renderTestLabel(printer), copies: 1 }], crypto.randomUUID()),
                t("printers.editor.testSent"),
              )
            }
          >
            {t("printers.editor.testLabel")}
          </Button>
          <Button
            busy={busy === "feed"}
            disabled={busy !== null}
            icon={<MoveVertical className="size-4" />}
            onClick={() => void run("feed", () => feedLabel(printer), t("printers.editor.fed"))}
          >
            {t("printers.editor.feed")}
          </Button>
          {printer.mediaType !== "continuous" && (
            <Button
              busy={busy === "calibrate"}
              disabled={busy !== null}
              icon={<ScanLine className="size-4" />}
              title={t("printers.editor.calibrateTitle")}
              onClick={() => void run("calibrate", () => calibrate(printer), t("printers.editor.calibrating"))}
            >
              {t("printers.editor.calibrate")}
            </Button>
          )}
          <Button
            variant="ghost"
            icon={<FileText className="size-4" />}
            onClick={() => void openLogDir().catch((err) => toast.error(errorMessage(err)))}
          >
            {t("printers.editor.openLog")}
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-faint">
          {t("printers.editor.toolsHint")}
        </p>
      </Section>

      <div className="border-t border-line pt-5">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs text-muted">{t("printers.editor.confirmRemove", { name: printer.name })}</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t("printers.editor.cancel")}
            </Button>
            <Button size="sm" variant="danger" onClick={() => removePrinter(printer.id)}>
              {t("printers.editor.remove")}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
            {t("printers.editor.removePrinter")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function PrintersPage() {
  const { config, printers } = useConfig();
  const status = useStatus();
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    printers.find((p) => p.id === selectedId) ??
    printers.find((p) => p.id === config.activePrinterId) ??
    printers[0] ??
    null;

  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <aside className="flex min-h-0 flex-col gap-8 overflow-y-auto border-r border-line p-4">
        <Section title={t("printers.configured")}>
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
              <li className="px-1 text-xs text-faint">{t("printers.none")}</li>
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
              {t("printers.select")}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
