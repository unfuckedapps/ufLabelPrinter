import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { errorMessage, readDocument } from "./api";
import { loadSource, type LoadedSource } from "./render";
import { useToast } from "../components/Toasts";

export interface LabelDocument {
  id: string;
  name: string;
  path: string | null;
  source: LoadedSource;
  copies: number;
  /** Included when printing the whole list. */
  selected: boolean;
  printedAt: number | null;
}

interface DocumentsApi {
  docs: LabelDocument[];
  active: LabelDocument | null;
  activePage: number;
  setActive(id: string, page?: number): void;
  setActivePage(page: number): void;
  addPaths(paths: string[]): Promise<void>;
  update(id: string, patch: Partial<Pick<LabelDocument, "copies" | "selected">>): void;
  markPrinted(ids: string[]): void;
  remove(id: string): void;
  removePrinted(): void;
}

const DocumentsContext = createContext<DocumentsApi | null>(null);

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function DocumentsProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [docs, setDocs] = useState<LabelDocument[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState(0);
  const docsRef = useRef(docs);
  docsRef.current = docs;

  const setActive = useCallback((id: string, page = 0) => {
    setActiveId(id);
    setActivePage(page);
  }, []);

  const addPaths = useCallback(
    async (paths: string[]) => {
      let lastId: string | null = null;
      for (const path of paths) {
        const existing = docsRef.current.find((d) => d.path === path);
        if (existing) {
          lastId = existing.id;
          continue;
        }
        try {
          const source = await loadSource(await readDocument(path));
          const doc: LabelDocument = {
            id: crypto.randomUUID(),
            name: fileName(path),
            path,
            source,
            copies: 1,
            selected: true,
            printedAt: null,
          };
          docsRef.current = [...docsRef.current, doc];
          setDocs(docsRef.current);
          lastId = doc.id;
        } catch (err) {
          toast.error(`${fileName(path)} konnte nicht geöffnet werden: ${errorMessage(err)}`);
        }
      }
      if (lastId) setActive(lastId);
    },
    [setActive, toast],
  );

  const removeWhere = useCallback((predicate: (d: LabelDocument) => boolean) => {
    const removed = docsRef.current.filter(predicate);
    removed.forEach((d) => d.source.dispose());
    const remaining = docsRef.current.filter((d) => !predicate(d));
    docsRef.current = remaining;
    setDocs(remaining);
    setActiveId((current) =>
      current && remaining.some((d) => d.id === current) ? current : (remaining.at(-1)?.id ?? null),
    );
    setActivePage(0);
  }, []);

  const api = useMemo<DocumentsApi>(() => {
    const active = docs.find((d) => d.id === activeId) ?? null;
    return {
      docs,
      active,
      activePage: active ? Math.min(activePage, active.source.pageCount - 1) : 0,
      setActive,
      setActivePage,
      addPaths,
      update: (id, patch) => setDocs((all) => all.map((d) => (d.id === id ? { ...d, ...patch } : d))),
      markPrinted: (ids) => {
        const now = Date.now();
        // Printed labels are deselected so "print all" does not repeat them by accident.
        setDocs((all) =>
          all.map((d) => (ids.includes(d.id) ? { ...d, printedAt: now, selected: false } : d)),
        );
      },
      remove: (id) => removeWhere((d) => d.id === id),
      removePrinted: () => removeWhere((d) => d.printedAt !== null),
    };
  }, [docs, activeId, activePage, setActive, addPaths, removeWhere]);

  return <DocumentsContext.Provider value={api}>{children}</DocumentsContext.Provider>;
}

export function useDocuments(): DocumentsApi {
  const api = useContext(DocumentsContext);
  if (!api) throw new Error("useDocuments must be used inside <DocumentsProvider>");
  return api;
}
