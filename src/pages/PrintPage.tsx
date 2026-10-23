import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Check,
  FileImage,
  FileText,
  FolderOpen,
  Minus,
  Plus,
  Printer,
  RotateCw,
  Scaling,
  Trash2,
  X,
} from "lucide-react";

import { LabelPreview } from "../components/LabelPreview";
import { pickFiles } from "../components/AppLayout";
import { useToast } from "../components/Toasts";
import { Button, NumberInput, Section, Segmented, Toggle } from "../components/ui";
import { errorMessage, printJob, type PrintPage as JobPage } from "../lib/api";
import { useConfig } from "../lib/config";
import { useDocuments, type LabelDocument } from "../lib/documents";
import { renderLabel } from "../lib/render";
import { useStatus } from "../lib/status";
import type { LayoutOptions, PrinterProfile } from "../lib/types";

function labelCount(docs: LabelDocument[]): number {
  return docs.reduce((sum, d) => sum + d.source.pageCount * d.copies, 0);
}

function plural(n: number): string {
  return n === 1 ? "1 Etikett" : `${n} Etiketten`;
}

function DocumentRow({ doc, active }: { doc: LabelDocument; active: boolean }) {
  const { setActive, update, remove } = useDocuments();
  const isPdf = doc.name.toLowerCase().endsWith(".pdf");
  const Icon = isPdf ? FileText : FileImage;

  return (
    <li
      onClick={() => setActive(doc.id)}
      className={`group flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition ${
        active ? "border-accent/50 bg-panel shadow-sm" : "border-transparent hover:bg-panel/60"
      }`}
    >
      <input
        type="checkbox"
        className="size-3.5 accent-[var(--accent)]"
        checked={doc.selected}
        title="Beim Drucken aller Etiketten berücksichtigen"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => update(doc.id, { selected: e.target.checked })}
      />
      <Icon className="size-4 shrink-0 text-faint" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium" title={doc.path ?? doc.name}>
          {doc.name}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-faint">
          {doc.source.pageCount} {doc.source.pageCount === 1 ? "Seite" : "Seiten"}
          {doc.printedAt && (
            <span className="flex items-center gap-0.5 text-ok">
              <Check className="size-3" />
              gedruckt {new Date(doc.printedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center rounded-md border border-line bg-canvas" onClick={(e) => e.stopPropagation()}>
        <button
          className="p-1 text-faint hover:text-ink disabled:opacity-30"
          disabled={doc.copies <= 1}
          onClick={() => update(doc.id, { copies: doc.copies - 1 })}
          aria-label="Weniger Kopien"
        >
          <Minus className="size-3" />
        </button>
        <span className="tabular w-5 text-center text-[11px] font-medium" title="Kopien">
          {doc.copies}
        </span>
        <button
          className="p-1 text-faint hover:text-ink"
          onClick={() => update(doc.id, { copies: Math.min(99, doc.copies + 1) })}
          aria-label="Mehr Kopien"
        >
          <Plus className="size-3" />
        </button>
      </div>
      <button
        className="rounded p-1 text-faint opacity-0 group-hover:opacity-100 hover:bg-sunken hover:text-err"
        onClick={(e) => {
          e.stopPropagation();
          remove(doc.id);
        }}
        aria-label="Entfernen"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

function LayoutPanel({ layout, setLayout }: { layout: LayoutOptions; setLayout: (p: Partial<LayoutOptions>) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <Section title="Größe">
        <Segmented
          value={layout.fit}
          onChange={(fit) => setLayout({ fit })}
          options={[
            { value: "contain", label: <><Scaling className="size-3.5" /> Einpassen</>, title: "Auf das Etikett skalieren" },
            { value: "actual", label: "100 %", title: "Originalgröße, Überstand wird abgeschnitten" },
          ]}
        />
        <Toggle
          checked={layout.trim}
          onChange={(trim) => setLayout({ trim })}
          label="Weiße Ränder abschneiden"
          hint="Nutzt die Etikettenfläche besser aus – Inhalt wird größer"
        />
        <label className="flex items-center justify-between gap-3">
          <span className="text-[13px]">Rand</span>
          <div className="w-24">
            <NumberInput value={layout.marginMm} onChange={(marginMm) => setLayout({ marginMm })} unit="mm" min={0} max={20} step={0.5} />
          </div>
        </label>
      </Section>

      <Section title="Drehung">
        <Segmented
          value={layout.rotation}
          onChange={(rotation) => setLayout({ rotation })}
          options={[
            { value: "auto", label: <><RotateCw className="size-3.5" /> Auto</>, title: "Dreht quer liegende Etiketten automatisch" },
            { value: 0, label: "0°" },
            { value: 90, label: "90°" },
            { value: 180, label: "180°" },
            { value: 270, label: "270°" },
          ]}
        />
      </Section>

      <Section
        title="Schwarzweiß"
        aside={<span className="tabular text-[11px] text-faint">{Math.round((layout.threshold / 255) * 100)} %</span>}
      >
        <label className="flex flex-col gap-1.5">
          <input
            type="range"
            min={40}
            max={230}
            value={layout.threshold}
            onChange={(e) => setLayout({ threshold: Number(e.target.value) })}
          />
          <span className="flex justify-between text-[11px] text-faint">
            <span>heller</span>
            <span>dunkler</span>
          </span>
        </label>
        <Toggle
          checked={layout.dither}
          onChange={(dither) => setLayout({ dither })}
          label="Graustufen rastern"
          hint="Für Fotos und Logos. Bei Versandetiketten aus lassen – Barcodes werden sonst unscharf."
        />
      </Section>
    </div>
  );
}

function EmptyState() {
  const { addPaths } = useDocuments();
  return (
    <div className="flex h-full items-center justify-center p-10">
      <button
        onClick={() => void pickFiles().then(addPaths)}
        className="group flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-line px-10 py-14 text-center transition hover:border-accent hover:bg-accent-soft/40"
      >
        <div className="flex h-24 w-16 flex-col gap-1.5 rounded-md bg-panel p-2 shadow-sm transition group-hover:-rotate-3">
          <span className="h-1.5 w-8 rounded bg-line" />
          <span className="h-1.5 w-10 rounded bg-line" />
          <span className="mt-auto h-6 rounded-sm bg-[repeating-linear-gradient(90deg,var(--ink)_0_2px,transparent_2px_4px,var(--ink)_4px_5px,transparent_5px_8px)] opacity-70" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-base font-semibold">Versandetikett hierher ziehen</span>
          <span className="text-muted">
            oder klicken zum Auswählen (⌘O) – PDF, PNG, JPG. Mehrere Dateien auf einmal gehen auch.
          </span>
        </div>
      </button>
    </div>
  );
}

export function PrintPage() {
  const { config, activePrinter, setLayout } = useConfig();
  const documents = useDocuments();
  const status = useStatus();
  const toast = useToast();
  const [printing, setPrinting] = useState<"all" | "current" | null>(null);

  const { docs, active, activePage } = documents;
  const selected = docs.filter((d) => d.selected);

  const print = useCallback(
    async (printer: PrinterProfile, targets: LabelDocument[], mode: "all" | "current") => {
      if (targets.length === 0) return;
      setPrinting(mode);
      status.setPrinting(printer.id, true);
      try {
        const pages: JobPage[] = [];
        for (const doc of targets) {
          for (let i = 0; i < doc.source.pageCount; i++) {
            const { bitmap } = await renderLabel(await doc.source.getPage(i), printer, config.layout);
            pages.push({ bitmap, copies: doc.copies });
          }
        }
        await printJob(printer, pages);
        documents.markPrinted(targets.map((d) => d.id));
        toast.success(`${plural(labelCount(targets))} an ${printer.name} gesendet`);
      } catch (err) {
        toast.error(`Druck fehlgeschlagen: ${errorMessage(err)}`);
      } finally {
        setPrinting(null);
        status.setPrinting(printer.id, false);
        if (printer.connection.type === "usb") void status.refresh(printer);
      }
    },
    [config.layout, documents, status, toast],
  );

  // ⌘P prints everything that is ticked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        if (activePrinter && !printing) void print(activePrinter, selected, "all");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePrinter, print, printing, selected]);

  const printedCount = docs.filter((d) => d.printedAt).length;

  return (
    <div className="grid h-full grid-cols-[minmax(240px,300px)_1fr_280px]">
      <aside className="flex min-h-0 flex-col border-r border-line">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-[11px] font-semibold tracking-wider text-faint uppercase">Dokumente</h2>
          <Button size="sm" variant="ghost" icon={<FolderOpen className="size-3.5" />} onClick={() => void pickFiles().then(documents.addPaths)}>
            Öffnen
          </Button>
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
          {docs.map((d) => (
            <DocumentRow key={d.id} doc={d} active={d.id === active?.id} />
          ))}
          {docs.length === 0 && (
            <li className="px-3 py-6 text-center text-xs leading-relaxed text-faint">
              Noch nichts geöffnet. Dateien einfach ins Fenster ziehen.
            </li>
          )}
        </ul>
        {printedCount > 0 && (
          <div className="border-t border-line p-2">
            <Button size="sm" variant="ghost" className="w-full" icon={<Trash2 className="size-3.5" />} onClick={documents.removePrinted}>
              Gedruckte entfernen ({printedCount})
            </Button>
          </div>
        )}
      </aside>

      <section className="backdrop-grid min-h-0 min-w-0">
        {!activePrinter ? (
          <div className="flex h-full items-center justify-center p-10 text-center">
            <div className="flex max-w-sm flex-col items-center gap-3">
              <Printer className="size-8 text-faint" />
              <p className="text-base font-semibold">Noch kein Drucker eingerichtet</p>
              <p className="text-muted">
                Schließe den Drucker per USB an oder kopple ihn per Bluetooth und füge ihn dann hinzu.
              </p>
              <Link to="/drucker" className="font-medium text-accent hover:underline">
                Drucker einrichten →
              </Link>
            </div>
          </div>
        ) : active ? (
          <LabelPreview
            doc={active}
            page={activePage}
            onPageChange={documents.setActivePage}
            printer={activePrinter}
            layout={config.layout}
          />
        ) : (
          <EmptyState />
        )}
      </section>

      <aside className="flex min-h-0 flex-col border-l border-line bg-panel/40">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <LayoutPanel layout={config.layout} setLayout={setLayout} />
        </div>
        <div className="flex flex-col gap-2 border-t border-line p-4">
          <Button
            variant="primary"
            size="lg"
            icon={<Printer className="size-4.5" />}
            busy={printing === "all"}
            disabled={!activePrinter || selected.length === 0 || printing !== null}
            onClick={() => activePrinter && void print(activePrinter, selected, "all")}
          >
            {selected.length === 0 ? "Nichts ausgewählt" : `${plural(labelCount(selected))} drucken`}
          </Button>
          {active && docs.length > 1 && (
            <Button
              size="md"
              busy={printing === "current"}
              disabled={!activePrinter || printing !== null}
              onClick={() => activePrinter && void print(activePrinter, [active], "current")}
            >
              Nur angezeigtes drucken
            </Button>
          )}
          <p className="text-center text-[11px] text-faint">
            {activePrinter ? `auf ${activePrinter.name} · ⌘P` : "Kein Drucker"}
          </p>
        </div>
      </aside>
    </div>
  );
}
