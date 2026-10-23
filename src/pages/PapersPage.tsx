import { useEffect, useState } from "react";
import { Copy, Plus, ScrollText, Trash2 } from "lucide-react";

import { PaperFields } from "../components/PaperFields";
import { Button, Section } from "../components/ui";
import { useT } from "../i18n";
import { useConfig } from "../lib/config";
import { newPaper, paperSummary } from "../lib/printers";
import type { PaperProfile } from "../lib/types";

function PaperEditor({ paper }: { paper: PaperProfile }) {
  const { config, printers, activePrinter, addPaper, updatePaper, removePaper, updatePrinter } = useConfig();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const t = useT();
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
            {users.length > 0
              ? t("paper.loadedIn", { printers: users.map((p) => p.name).join(", ") })
              : t("paper.notLoaded")}
          </span>
        </div>
        {activePrinter && !loadedInActive && (
          <Button size="sm" variant="primary" onClick={() => updatePrinter(activePrinter.id, { paperId: paper.id })}>
            {t("paper.loadInto", { printer: activePrinter.name })}
          </Button>
        )}
      </div>

      <Section title={t("paper.properties")}>
        <PaperFields paper={paper} onChange={(patch) => updatePaper(paper.id, patch)} />
      </Section>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
        <Button
          size="sm"
          icon={<Copy className="size-3.5" />}
          onClick={() => addPaper({ ...paper, id: crypto.randomUUID(), name: t("paper.copyName", { name: paper.name }) })}
        >
          {t("paper.duplicate")}
        </Button>
        <div className="flex-1" />
        {confirmDelete && replacement ? (
          <>
            <span className="text-xs text-muted">
              {users.length > 0 ? `${t("paper.switchTo", { name: replacement.name })} ` : ""}
              {t("paper.reallyDelete")}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t("printers.editor.cancel")}
            </Button>
            <Button size="sm" variant="danger" onClick={() => removePaper(paper.id, replacement.id)}>
              {t("paper.delete")}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            disabled={!replacement}
            title={replacement ? undefined : t("paper.keepOne")}
            onClick={() => setConfirmDelete(true)}
          >
            {t("paper.delete")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function PapersPage() {
  const { config, printers, addPaper } = useConfig();
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = config.papers.find((p) => p.id === selectedId) ?? config.papers[0] ?? null;

  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r border-line p-4">
        <Section
          title={t("paper.title")}
          aside={
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-3.5" />}
              onClick={() => {
                const paper = newPaper({ name: t("paper.newName") });
                addPaper(paper);
                setSelectedId(paper.id);
              }}
            >
              {t("paper.new")}
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
                        {users.length === 1 ? users[0].name : t.plural("paper.printers", users.length)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
        <p className="px-1 text-[11px] leading-relaxed text-faint">
          {t("paper.hint")}
        </p>
      </aside>

      <section className="min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-8">{selected && <PaperEditor paper={selected} />}</div>
      </section>
    </div>
  );
}
