import { useEffect, useState } from "react";
import { Copy, Plus, ScrollText, Trash2 } from "lucide-react";

import { PaperFields } from "../components/PaperFields";
import { Button, Section } from "../components/ui";
import { useConfig } from "../lib/config";
import { newPaper, paperSummary } from "../lib/printers";
import type { PaperProfile } from "../lib/types";

function PaperEditor({ paper }: { paper: PaperProfile }) {
  const { config, printers, activePrinter, addPaper, updatePaper, removePaper, updatePrinter } = useConfig();
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setConfirmDelete(false), [paper.id]);

  const users = printers.filter((p) => p.paperId === paper.id);
  const replacement = config.papers.find((p) => p.id !== paper.id);
  const loadedInActive = activePrinter?.paperId === paper.id;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-lg font-semibold">{paper.name}</h2>
          <span className="text-xs text-muted">
            {users.length > 0 ? `Eingelegt in: ${users.map((p) => p.name).join(", ")}` : "In keinem Drucker eingelegt"}
          </span>
        </div>
        {activePrinter && !loadedInActive && (
          <Button size="sm" variant="primary" onClick={() => updatePrinter(activePrinter.id, { paperId: paper.id })}>
            In {activePrinter.name} einlegen
          </Button>
        )}
      </div>

      <Section title="Eigenschaften">
        <PaperFields paper={paper} onChange={(patch) => updatePaper(paper.id, patch)} />
      </Section>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
        <Button
          size="sm"
          icon={<Copy className="size-3.5" />}
          onClick={() => addPaper({ ...paper, id: crypto.randomUUID(), name: `${paper.name} (Kopie)` })}
        >
          Duplizieren
        </Button>
        <div className="flex-1" />
        {confirmDelete && replacement ? (
          <>
            <span className="text-xs text-muted">
              {users.length > 0 ? `Drucker wechseln auf „${replacement.name}“. ` : ""}Wirklich löschen?
            </span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Abbrechen
            </Button>
            <Button size="sm" variant="danger" onClick={() => removePaper(paper.id, replacement.id)}>
              Löschen
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            disabled={!replacement}
            title={replacement ? undefined : "Mindestens ein Papier muss bleiben"}
            onClick={() => setConfirmDelete(true)}
          >
            Löschen
          </Button>
        )}
      </div>
    </div>
  );
}

export function PapersPage() {
  const { config, printers, addPaper } = useConfig();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = config.papers.find((p) => p.id === selectedId) ?? config.papers[0] ?? null;

  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r border-line p-4">
        <Section
          title="Papierprofile"
          aside={
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-3.5" />}
              onClick={() => {
                const paper = newPaper({ name: "Neues Papier" });
                addPaper(paper);
                setSelectedId(paper.id);
              }}
            >
              Neu
            </Button>
          }
        >
          <ul className="flex flex-col gap-1">
            {config.papers.map((paper) => {
              const users = printers.filter((p) => p.paperId === paper.id);
              return (
                <li key={paper.id}>
                  <button
                    onClick={() => setSelectedId(paper.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                      paper.id === selected?.id ? "border-accent/50 bg-panel shadow-sm" : "border-transparent hover:bg-panel/60"
                    }`}
                  >
                    <ScrollText className="size-4 shrink-0 text-faint" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{paper.name}</span>
                      <span className="truncate text-[11px] text-faint">{paperSummary(paper)}</span>
                    </div>
                    {users.length > 0 && (
                      <span
                        className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
                        title={users.map((p) => p.name).join(", ")}
                      >
                        {users.length === 1 ? users[0].name : `${users.length} Drucker`}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
        <p className="px-1 text-[11px] leading-relaxed text-faint">
          Lege für jede Etikettenrolle ein Profil an. Beim Rollenwechsel genügt dann ein Klick oben rechts in der
          Kopfzeile.
        </p>
      </aside>

      <section className="min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-8">{selected && <PaperEditor paper={selected} />}</div>
      </section>
    </div>
  );
}
