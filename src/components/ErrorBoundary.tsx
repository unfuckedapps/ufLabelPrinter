import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { useRouteError, isRouteErrorResponse, Link } from "react-router";
import { ClipboardCopy, RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "./ui";

function describe(error: unknown): { message: string; details: string } {
  if (isRouteErrorResponse(error)) {
    return { message: `${error.status} ${error.statusText}`, details: JSON.stringify(error.data, null, 2) };
  }
  if (error instanceof Error) return { message: error.message, details: error.stack ?? error.message };
  if (typeof error === "string") return { message: error, details: error };
  return { message: "Unbekannter Fehler", details: JSON.stringify(error, null, 2) };
}

/** Points the user at the most likely fix for errors we have seen before. */
function hintFor(message: string): string | null {
  if (/pdf|InvalidPDF|password/i.test(message)) {
    return "Das Dokument konnte nicht gelesen werden. Ist die PDF beschädigt oder passwortgeschützt? Lade das Etikett ggf. neu herunter.";
  }
  if (/canvas|memory|allocation/i.test(message)) {
    return "Beim Rendern ist der Speicher ausgegangen. Sehr große Bilder vorher verkleinern oder weniger Dokumente gleichzeitig öffnen.";
  }
  if (/invoke|ipc|__TAURI/i.test(message)) {
    return "Die Verbindung zum App-Kern ist unterbrochen. Ein Neustart der App behebt das in der Regel.";
  }
  return null;
}

function ErrorScreen({ error, onReset }: { error: unknown; onReset?: () => void }) {
  const { message, details } = describe(error);
  const [copied, setCopied] = useState(false);
  const hint = hintFor(message);
  const report = [
    `Thermalprinter ${__APP_VERSION__}`,
    `Zeit: ${new Date().toISOString()}`,
    `Ort: ${window.location.hash || "/"}`,
    `System: ${navigator.userAgent}`,
    "",
    details,
  ].join("\n");

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex w-full max-w-2xl flex-col gap-5 rounded-xl border border-line bg-panel p-7 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-err/10 p-2.5 text-err">
            <TriangleAlert className="size-6" />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">Da ist etwas schiefgelaufen</h1>
            <p className="text-muted">
              Die Oberfläche ist auf einen unerwarteten Fehler gestoßen. Deine Druckereinstellungen sind gespeichert
              und gehen dabei nicht verloren.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-sunken p-3">
          <p className="font-mono text-xs font-semibold text-err select-text">{message}</p>
          {hint && <p className="mt-2 text-[12px] text-ink">{hint}</p>}
        </div>

        <details className="group">
          <summary className="cursor-pointer text-xs text-muted hover:text-ink">Technische Details</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-sunken p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted select-text">
            {report}
          </pre>
        </details>

        <div className="flex flex-wrap gap-2">
          {onReset && (
            <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={onReset}>
              Erneut versuchen
            </Button>
          )}
          <Button onClick={() => window.location.reload()}>App neu laden</Button>
          <Button
            variant="ghost"
            icon={<ClipboardCopy className="size-4" />}
            onClick={() => {
              void navigator.clipboard.writeText(report).then(() => setCopied(true));
            }}
          >
            {copied ? "Kopiert" : "Fehlerbericht kopieren"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Last line of defence around the whole app, including the providers. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Unbehandelter Fehler:", error, info.componentStack);
  }

  render() {
    if (this.state.error !== null) {
      return <ErrorScreen error={this.state.error} onReset={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

/** Errors thrown while rendering a route; keeps the header usable. */
export function RouteError() {
  const error = useRouteError();
  return (
    <div className="flex h-full flex-col">
      <ErrorScreen error={error} />
      <p className="pb-6 text-center text-xs text-muted">
        <Link to="/" className="text-accent hover:underline">
          Zurück zum Drucken
        </Link>
      </p>
    </div>
  );
}
