import { Link, useLocation } from "react-router";
import { Printer, Settings2 } from "lucide-react";

export function NotFound() {
  const location = useLocation();
  return (
    <div className="backdrop-grid flex h-full items-center justify-center p-8">
      <div className="flex flex-col items-center gap-6 text-center">
        {/* A label that came out blank: the 404 of a label printer. */}
        <div className="label-sheet relative flex h-56 w-40 -rotate-3 flex-col items-center justify-center gap-2 p-4">
          <span className="font-mono text-5xl font-bold tracking-tighter text-[#1d1c1a]">404</span>
          <span className="h-1.5 w-20 rounded bg-[#1d1c1a]/80" />
          <span className="h-1.5 w-14 rounded bg-[#1d1c1a]/40" />
          <div className="absolute inset-x-0 -bottom-3 flex justify-center gap-[3px]">
            {Array.from({ length: 22 }, (_, i) => (
              <span key={i} className="size-1.5 rotate-45 bg-sunken" />
            ))}
          </div>
        </div>
        <div className="flex max-w-md flex-col gap-2">
          <h1 className="text-xl font-semibold">Diese Seite gibt es nicht</h1>
          <p className="text-muted">
            Unter <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-xs">{location.pathname}</code> ist
            nichts – vermutlich ein veralteter Link. Hier geht es weiter:
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            to="/"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 font-medium text-on-accent hover:brightness-110"
          >
            <Printer className="size-4" /> Etiketten drucken
          </Link>
          <Link
            to="/drucker"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-panel px-4 font-medium hover:bg-sunken"
          >
            <Settings2 className="size-4" /> Drucker einrichten
          </Link>
        </div>
      </div>
    </div>
  );
}
